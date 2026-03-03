/**
 * SplatMesh — native three.js Gaussian Splatting renderer.
 *
 * Acceleration tricks (mirroring gsplat):
 *  1. Web Worker  — sort runs off the main thread; no per-frame stall.
 *  2. Radix sort  — 4-pass 8-bit LSD radix sort O(4n) vs Array.sort O(n lg n).
 *                   Single-pass histogram: all 4 byte-levels counted in one scan.
 *  3. IEEE-754 key — all floats sortable as unsigned ints via bit-flip trick.
 *  4. Ping-pong   — Uint32Array transferred zero-copy main↔worker every frame.
 *  5. Throttle    — only one sort in-flight; keeps previous result until done.
 *  6. Lazy re-sort — skips if camera view-row hasn't changed.
 */

import * as THREE from 'three';
import type { SplatData } from 'gsplat';

// ---------------------------------------------------------------------------
// Optimisation options (mirrored from SplatOptSettings in buses.ts;
// kept as a local type to avoid a core→ui import cycle).
// ---------------------------------------------------------------------------
export interface SplatOpts {
  workerSort:     boolean;
  radixSort:      boolean;
  lazyResort:     boolean;
  throttle:       boolean;
  alphaThreshold: number;
  frustumCull:    boolean;
  gpuIndirect:    boolean;
  lodFactor:      number;   // 0.1–1.0
}

export const DEFAULT_SPLAT_OPTS: SplatOpts = {
  workerSort:     true,
  radixSort:      true,
  lazyResort:     true,
  throttle:       true,
  alphaThreshold: 0,
  frustumCull:    false,
  gpuIndirect:    false,
  lodFactor:      1.0,
};

// ---------------------------------------------------------------------------
// GLSL shaders
// ---------------------------------------------------------------------------

const vertexShaderDirect = /* glsl */ `precision highp float;
precision highp int;

// Per-vertex (quad corner)
in vec2 aCorner;          // ±2 in x and y

// Per-instance splat data
in vec3  aCenter;         // world-space position (already in model space)
in vec4  aRotation;       // unit quaternion XYZW (local splat orientation)
in vec3  aScale;          // linear scale (not log)
in vec4  aColor;          // RGBA [0,1]

// Uniforms updated every frame from ViewportManager
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uFocal;      // (fx, fy) in pixels
uniform vec2 uViewport;   // (width, height) in pixels

out vec2 vUv;
out vec4 vColor;

// ----- quaternion helpers -----

mat3 quatToMat(vec4 q) {
    // q = (x, y, z, w)
    float xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
    float xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
    float wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
    return mat3(
        1.0 - 2.0*(yy+zz),      2.0*(xy-wz),        2.0*(xz+wy),
              2.0*(xy+wz),  1.0 - 2.0*(xx+zz),       2.0*(yz-wx),
              2.0*(xz-wy),        2.0*(yz+wx),   1.0 - 2.0*(xx+yy)
    );
}

void main() {
    // ---- camera-space center ----
    vec4 worldPos4 = modelMatrix * vec4(aCenter, 1.0);
    vec4 camPos4   = viewMatrix  * worldPos4;
    vec3 cam = camPos4.xyz;

    // clip-space center for NDC computation
    vec4 clipPos = projectionMatrix * camPos4;

    // cull behind camera
    if (clipPos.w <= 0.0) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // behind clip
        return;
    }

    // ---- 3D covariance in camera space ----
    // Build combined rotation: cam-from-local = R_view3 * R_model3 * R_local
    mat3 R_local  = quatToMat(normalize(aRotation));
    mat3 M        = mat3(viewMatrix * modelMatrix) * R_local;
    // RS = M * diag(aScale) — each column of M scaled by corresponding scale
    mat3 RS = mat3(
        aScale.x * M[0],
        aScale.y * M[1],
        aScale.z * M[2]
    );
    // camera-space 3D covariance: Σ_cam = RS * RS^T
    mat3 Vrk = RS * transpose(RS);

    // ---- Jacobian of perspective projection (gsplat convention) ----
    // In GLSL column-major this is the TRANSPOSE of the math Jacobian,
    // so:  transpose(J) * Vrk * J  ==  J_math * Vrk * J_math^T  (correct EWA)
    float z  = cam.z;   // negative in three.js (looking along -Z)
    float z2 = z * z;
    mat3 J = mat3(
        -uFocal.x / z,                       0.0,  -(uFocal.x * cam.x) / z2,
         0.0,                          -uFocal.y / z,  -(uFocal.y * cam.y) / z2,
         0.0,                                0.0,                         0.0
    );

    // 2D screen-space covariance (in pixels²)
    mat3 cov3d = transpose(J) * Vrk * J;

    float A = cov3d[0][0] + 0.3;   // regularise
    float B = cov3d[0][1];
    float C = cov3d[1][1] + 0.3;

    float mid    = (A + C) * 0.5;
    float disc   = length(vec2((A - C) * 0.5, B));
    float lambda1 = mid + disc;
    float lambda2 = mid - disc;

    if (lambda2 < 0.0) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    // eigenvector for lambda1
    vec2 diag = normalize(vec2(B, lambda1 - A));

    // semi-axes in pixels (clamped to avoid giant splats far off-screen)
    vec2 majorAxis = min(sqrt(2.0 * lambda1), 1024.0) * diag;
    vec2 minorAxis = min(sqrt(2.0 * lambda2), 1024.0) * vec2(diag.y, -diag.x);

    // NDC center
    vec2 ndcCenter = clipPos.xy / clipPos.w;

    // Displace quad corner in NDC
    //   corners are ±2 → full Gaussian shown up to r=2 (exp(-4) ≈ 0)
    //   major/minorAxis are in pixels; 2.0/uViewport converts pixels → NDC
    vec2 disp = (aCorner.x * majorAxis + aCorner.y * minorAxis) * 2.0 / uViewport;

    // Write actual depth so depth test works against geometry
    float ndcZ = clipPos.z / clipPos.w;

    gl_Position = vec4(ndcCenter + disp, ndcZ, 1.0);

    vUv    = aCorner;
    vColor = aColor;
}
`;

// GPU-indirect variant: splat data lives in textures; only the sorted index list is
// uploaded per frame.  aOrderF = float-encoded splat index (cast to int in shader).
const vertexShaderIndirect = /* glsl */ `precision highp float;
precision highp int;
precision highp sampler2D;

in vec2  aCorner;   // ±2 quad corner
in float aOrderF;   // sorted splat index (float-encoded, cast to int in shader)

// Static splat data textures (RGBA32F, updated only once on load)
uniform highp sampler2D tCenter;    // .rgb = position xyz
uniform highp sampler2D tRotation;  // .xyzw = quaternion XYZW
uniform highp sampler2D tScale;     // .rgb = scale xyz
uniform highp sampler2D tColor;     // .rgba = colour [0,1]
uniform int  uTexWidth;             // texture row width (e.g. 2048)

// Per-frame camera uniforms
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uFocal;
uniform vec2 uViewport;

out vec2 vUv;
out vec4 vColor;

mat3 quatToMat(vec4 q) {
    float xx = q.x*q.x, yy = q.y*q.y, zz = q.z*q.z;
    float xy = q.x*q.y, xz = q.x*q.z, yz = q.y*q.z;
    float wx = q.w*q.x, wy = q.w*q.y, wz = q.w*q.z;
    return mat3(
        1.0-2.0*(yy+zz),   2.0*(xy-wz),   2.0*(xz+wy),
          2.0*(xy+wz), 1.0-2.0*(xx+zz),   2.0*(yz-wx),
          2.0*(xz-wy),   2.0*(yz+wx), 1.0-2.0*(xx+yy)
    );
}

void main() {
    int  splatIdx = int(aOrderF);
    ivec2 tc      = ivec2(splatIdx % uTexWidth, splatIdx / uTexWidth);

    vec3 aCenter   = texelFetch(tCenter,   tc, 0).rgb;
    vec4 aRotation = texelFetch(tRotation, tc, 0);
    vec3 aScale    = texelFetch(tScale,    tc, 0).rgb;
    vec4 aColor    = texelFetch(tColor,    tc, 0);

    vec4 worldPos4 = modelMatrix * vec4(aCenter, 1.0);
    vec4 camPos4   = viewMatrix  * worldPos4;
    vec3 cam = camPos4.xyz;
    vec4 clipPos = projectionMatrix * camPos4;
    if (clipPos.w <= 0.0) { gl_Position = vec4(0.0,0.0,2.0,1.0); return; }

    mat3 R_local = quatToMat(normalize(aRotation));
    mat3 M  = mat3(viewMatrix * modelMatrix) * R_local;
    mat3 RS = mat3(aScale.x*M[0], aScale.y*M[1], aScale.z*M[2]);
    mat3 Vrk = RS * transpose(RS);

    float z = cam.z, z2 = z*z;
    mat3 J = mat3(
        -uFocal.x/z,        0.0,  -(uFocal.x*cam.x)/z2,
         0.0,        -uFocal.y/z,  -(uFocal.y*cam.y)/z2,
         0.0,               0.0,                     0.0
    );
    mat3 cov3d = transpose(J) * Vrk * J;

    float A = cov3d[0][0]+0.3, B = cov3d[0][1], C = cov3d[1][1]+0.3;
    float mid = (A+C)*0.5;
    float disc = length(vec2((A-C)*0.5, B));
    float lambda1 = mid+disc, lambda2 = mid-disc;
    if (lambda2 < 0.0) { gl_Position = vec4(0.0,0.0,2.0,1.0); return; }

    vec2 diag = normalize(vec2(B, lambda1-A));
    vec2 majorAxis = min(sqrt(2.0*lambda1), 1024.0) * diag;
    vec2 minorAxis = min(sqrt(2.0*lambda2), 1024.0) * vec2(diag.y, -diag.x);

    vec2 ndcCenter = clipPos.xy / clipPos.w;
    vec2 disp = (aCorner.x*majorAxis + aCorner.y*minorAxis) * 2.0 / uViewport;
    gl_Position = vec4(ndcCenter + disp, clipPos.z/clipPos.w, 1.0);

    vUv    = aCorner;
    vColor = aColor;
}
`;

const fragmentShader = /* glsl */ `precision highp float;

in  vec2 vUv;
in  vec4 vColor;

uniform float uAlphaThreshold;  // 0 = disabled; discard below this

out vec4 fragColor;

void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 4.0) discard;                  // clip to circle of radius 2

    float alpha = exp(-r2) * vColor.a;      // Gaussian falloff × splat opacity
    if (uAlphaThreshold > 0.0 && alpha < uAlphaThreshold) discard;
    fragColor = vec4(vColor.rgb, alpha);          // non-premultiplied
}
`;

// ---------------------------------------------------------------------------
// Sort Worker — inlined as a Blob URL; no separate file needed.
//
// Protocol
//   main→worker  { type:'init', positions:ArrayBuffer }  (transferred once)
//   main→worker  { type:'sort', reclaimBuf?:ArrayBuffer } (every frame)
//   worker→main  { order:Uint32Array }                   (transferred back)
//   worker→main  { reclaim:ArrayBuffer }                 (throttled: buf returned)
//
// Algorithm: 4-pass 8-bit LSD radix sort on 32-bit depth keys.
//   Key(z): ascending key order == ascending float order == back-to-front.
//   For z<0 flip all bits; for z>=0 flip only sign bit (IEEE-754 trick).
// ---------------------------------------------------------------------------

/* eslint-disable */
const WORKER_SOURCE = [
  "'use strict';",
  'var _pos=null,_n=0,_keys=null,_o0=null,_o1=null,_hist=null;',
  'var _kb=new ArrayBuffer(4),_kf=new Float32Array(_kb),_ku=new Uint32Array(_kb);',
  'function floatKey(z){_kf[0]=z;var b=_ku[0];return(b^(((b>>31)|0x80000000)>>>0))>>>0;}',
  'function init(buf){_pos=new Float32Array(buf);_n=_pos.length/3;',
  '  _keys=new Uint32Array(_n);_o0=new Uint32Array(_n);',
  '  _o1=new Uint32Array(_n);_hist=new Int32Array(1024);}',
  'var _vr=[0,0,0,0];',
  'function radixSort(rb){',
  '  var n=_n,pos=_pos,keys=_keys,hist=_hist,i,idx,b;',
  '  var r0=_vr[0],r1=_vr[1],r2=_vr[2],r3=_vr[3];',
  '  var out=null;',
  '  if(rb){var t=new Uint32Array(rb);out=(t.length===n)?t:null;}',
  '  if(!out)out=new Uint32Array(n);',
  '  hist.fill(0);',
  '  for(i=0;i<n;i++){var z=r0*pos[3*i]+r1*pos[3*i+1]+r2*pos[3*i+2]+r3;var k=floatKey(z);keys[i]=k;',
  '    hist[(k)&255]++;hist[256+((k>>>8)&255)]++;',
  '    hist[512+((k>>>16)&255)]++;hist[768+((k>>>24)&255)]++;}',
  '  for(var p=0;p<4;p++){var sum=0,base=p*256;',
  '    for(b=0;b<256;b++){var c=hist[base+b];hist[base+b]=sum;sum+=c;}}',
  '  for(i=0;i<n;i++)out[i]=i;',
  '  for(i=0;i<n;i++){idx=out[i];b=keys[idx]&255;         _o1[hist[b]++]=idx;}',
  '  for(i=0;i<n;i++){idx=_o1[i]; b=(keys[idx]>>>8)&255;  out[hist[256+b]++]=idx;}',
  '  for(i=0;i<n;i++){idx=out[i]; b=(keys[idx]>>>16)&255; _o1[hist[512+b]++]=idx;}',
  '  for(i=0;i<n;i++){idx=_o1[i]; b=(keys[idx]>>>24)&255; out[hist[768+b]++]=idx;}',
  '  return out;}',
  'var _inFlight=false,_dirty=false,_pendingVr=null;',
  'function doSort(rb){_inFlight=true;',
  '  if(_pendingVr){_vr[0]=_pendingVr[0];_vr[1]=_pendingVr[1];_vr[2]=_pendingVr[2];_vr[3]=_pendingVr[3];_pendingVr=null;}',
  '  try{var order=radixSort(rb);self.postMessage({order:order},[order.buffer]);}',
  '  catch(e){self.postMessage({order:new Uint32Array(0)});}',
  '  _inFlight=false;if(_dirty){_dirty=false;doSort(null);}}',
  'self.onmessage=function(e){var d=e.data;',
  "  if(d.type==='init'){init(d.positions);doSort(null);return;}",
  "  if(d.type==='sort'){var rb=d.reclaimBuf||null;var vr=d.viewRow||null;",
  '    if(vr)_pendingVr=vr;',
  '    if(_inFlight){_dirty=true;if(rb)self.postMessage({reclaim:rb},[rb]);return;}',
  '    doSort(rb);}};',
].join('\n');
/* eslint-enable */

let _workerBlobUrl: string | null = null;
function getWorkerUrl(): string {
    if (!_workerBlobUrl) {
        const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
        _workerBlobUrl = URL.createObjectURL(blob);
    }
    return _workerBlobUrl;
}

// ---------------------------------------------------------------------------

export class SplatMesh extends THREE.Object3D {
    private _geometry!: THREE.InstancedBufferGeometry;
    private _material!: THREE.RawShaderMaterial;
    private _mesh!: THREE.Mesh;

    private _count       = 0;
    private _positions!: Float32Array;
    private _rotations!: Float32Array;
    private _scales!:    Float32Array;
    private _colors!:    Float32Array;

    // Direct-mode instanced attributes (scatter per frame)
    private _abCenter!:   THREE.InstancedBufferAttribute;
    private _abRotation!: THREE.InstancedBufferAttribute;
    private _abScale!:    THREE.InstancedBufferAttribute;
    private _abColor!:    THREE.InstancedBufferAttribute;

    // GPU-indirect mode (texture data + per-frame order indices only)
    private _abOrder:    THREE.InstancedBufferAttribute | null = null;
    private _tCenter:    THREE.DataTexture | null = null;
    private _tRotation:  THREE.DataTexture | null = null;
    private _tScale:     THREE.DataTexture | null = null;
    private _tColor:     THREE.DataTexture | null = null;
    private _texWidth  = 2048;

    // Frustum culling helpers (re-used each frame to avoid GC pressure)
    private readonly _worldFrustum = new THREE.Frustum();
    private readonly _frustumPVM   = new THREE.Matrix4();
    private readonly _cullPt       = new THREE.Vector3();
    private _tempOrder: Uint32Array | null = null;

    // Async sort state
    private _worker:      Worker | null      = null;
    private _sortInFlight = false;
    private _gpuDirty     = false;
    private _readyOrder:  Uint32Array | null = null;
    private _lastViewRow  = new Float32Array(4);
    private readonly _mvMatrix = new THREE.Matrix4();

    // Optimisation options
    private _opts: SplatOpts = { ...DEFAULT_SPLAT_OPTS };

    constructor() {
        super();
        this._buildGeometry();
        this._buildMaterial();
        this._mesh = new THREE.Mesh(this._geometry, this._material);
        this._mesh.frustumCulled = false;
        this._mesh.raycast = () => {}; // no position attribute — disable raycasting
        this.add(this._mesh);
    }

    // -----------------------------------------------------------------------

    private _buildGeometry(): void {
        const geo = new THREE.InstancedBufferGeometry();
        geo.setAttribute('aCorner', new THREE.BufferAttribute(
            new Float32Array([-2,-2, 2,-2, 2,2, -2,2]), 2,
        ));
        geo.setIndex([0,1,2, 0,2,3]);
        this._geometry = geo;
    }

    private _buildMaterial(indirect = false): void {
        const baseUniforms: Record<string, { value: unknown }> = {
            modelMatrix:       { value: new THREE.Matrix4() },
            viewMatrix:        { value: new THREE.Matrix4() },
            projectionMatrix:  { value: new THREE.Matrix4() },
            uFocal:            { value: new THREE.Vector2(500, 500) },
            uViewport:         { value: new THREE.Vector2(1, 1) },
            uAlphaThreshold:   { value: this._opts.alphaThreshold },
        };
        if (indirect) {
            Object.assign(baseUniforms, {
                tCenter:   { value: this._tCenter },
                tRotation: { value: this._tRotation },
                tScale:    { value: this._tScale },
                tColor:    { value: this._tColor },
                uTexWidth: { value: this._texWidth },
            });
        }
        this._material = new THREE.RawShaderMaterial({
            vertexShader: indirect ? vertexShaderIndirect : vertexShaderDirect,
            fragmentShader,
            uniforms: baseUniforms,
            depthTest:   true,
            depthWrite:  false,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.NormalBlending,
            glslVersion: THREE.GLSL3,
        });
    }

    // -----------------------------------------------------------------------
    // Called once after file is decoded
    // -----------------------------------------------------------------------
    updateFromData(data: SplatData): void {
        const n = data.vertexCount;
        this._count = n;

        this._positions = new Float32Array(data.positions);
        this._rotations = new Float32Array(data.rotations);
        this._scales    = new Float32Array(data.scales);

        const colorsU8 = data.colors;
        this._colors = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            this._colors[4*i+0] = colorsU8[4*i+0] / 255;
            this._colors[4*i+1] = colorsU8[4*i+1] / 255;
            this._colors[4*i+2] = colorsU8[4*i+2] / 255;
            this._colors[4*i+3] = colorsU8[4*i+3] / 255;
        }

        if (this._opts.gpuIndirect) {
            this._enterIndirectMode();
        } else {
            this._enterDirectMode();
        }

        // Send a copy of positions to the worker (we keep the original here)
        if (this._opts.workerSort) {
            this._startWorker(new Float32Array(this._positions).buffer);
        }
    }

    // -----------------------------------------------------------------------

    private _startWorker(positionsBuf: ArrayBuffer): void {
        this._worker?.terminate();
        this._sortInFlight = true; // worker will sort immediately on init

        const w = new Worker(getWorkerUrl());
        this._worker = w;

        w.onmessage = (e: MessageEvent) => {
            if (e.data.order) {
                this._readyOrder   = e.data.order as Uint32Array;
                this._sortInFlight = false;
                this._gpuDirty     = true;
            } else if (e.data.reclaim) {
                // Throttled — worker returns the buffer; reclaim it
                const buf = e.data.reclaim as ArrayBuffer;
                if (buf.byteLength > 0) this._readyOrder = new Uint32Array(buf);
                this._sortInFlight = false;
            }
        };

        w.postMessage({ type: 'init', positions: positionsBuf }, [positionsBuf]);
    }

    // -----------------------------------------------------------------------
    // Mode setup helpers
    // -----------------------------------------------------------------------

    private _enterDirectMode(): void {
        const n = this._count;
        this._abCenter   = new THREE.InstancedBufferAttribute(new Float32Array(n*3), 3);
        this._abRotation = new THREE.InstancedBufferAttribute(new Float32Array(n*4), 4);
        this._abScale    = new THREE.InstancedBufferAttribute(new Float32Array(n*3), 3);
        this._abColor    = new THREE.InstancedBufferAttribute(new Float32Array(n*4), 4);
        this._abCenter.setUsage(THREE.DynamicDrawUsage);
        this._abRotation.setUsage(THREE.DynamicDrawUsage);
        this._abScale.setUsage(THREE.DynamicDrawUsage);
        this._abColor.setUsage(THREE.DynamicDrawUsage);

        this._geometry.deleteAttribute('aOrderF');
        this._geometry.setAttribute('aCenter',   this._abCenter);
        this._geometry.setAttribute('aRotation', this._abRotation);
        this._geometry.setAttribute('aScale',    this._abScale);
        this._geometry.setAttribute('aColor',    this._abColor);
        this._geometry.instanceCount = n;

        this._disposeTextures();
        this._abOrder = null;

        this._material.dispose();
        this._buildMaterial(false);
        this._mesh.material = this._material;
    }

    private _enterIndirectMode(): void {
        const n = this._count;
        this._buildTextures();

        this._abOrder = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        this._abOrder.setUsage(THREE.DynamicDrawUsage);

        this._geometry.deleteAttribute('aCenter');
        this._geometry.deleteAttribute('aRotation');
        this._geometry.deleteAttribute('aScale');
        this._geometry.deleteAttribute('aColor');
        this._geometry.setAttribute('aOrderF', this._abOrder);
        this._geometry.instanceCount = n;

        this._material.dispose();
        this._buildMaterial(true);
        this._mesh.material = this._material;

        // Force re-apply on next sort result
        this._gpuDirty = true;
    }

    private _buildTextures(): void {
        const n  = this._count;
        const tw = Math.min(n, 2048);
        const th = Math.ceil(n / tw);
        this._texWidth = tw;
        const size = tw * th;

        const posData = new Float32Array(size * 4);
        const rotData = new Float32Array(size * 4);
        const sclData = new Float32Array(size * 4);
        const colData = new Float32Array(size * 4);
        const pos = this._positions, rot = this._rotations;
        const scl = this._scales,    col = this._colors;

        for (let i = 0; i < n; i++) {
            posData[4*i]   = pos[3*i];   posData[4*i+1] = pos[3*i+1]; posData[4*i+2] = pos[3*i+2];
            rotData[4*i]   = rot[4*i];   rotData[4*i+1] = rot[4*i+1]; rotData[4*i+2] = rot[4*i+2]; rotData[4*i+3] = rot[4*i+3];
            sclData[4*i]   = scl[3*i];   sclData[4*i+1] = scl[3*i+1]; sclData[4*i+2] = scl[3*i+2];
            colData[4*i]   = col[4*i];   colData[4*i+1] = col[4*i+1]; colData[4*i+2] = col[4*i+2]; colData[4*i+3] = col[4*i+3];
        }

        const mkTex = (data: Float32Array): THREE.DataTexture => {
            const t = new THREE.DataTexture(data, tw, th, THREE.RGBAFormat, THREE.FloatType);
            t.magFilter = t.minFilter = THREE.NearestFilter;
            t.generateMipmaps = false;
            t.needsUpdate = true;
            return t;
        };

        this._disposeTextures();
        this._tCenter   = mkTex(posData);
        this._tRotation = mkTex(rotData);
        this._tScale    = mkTex(sclData);
        this._tColor    = mkTex(colData);
    }

    private _disposeTextures(): void {
        this._tCenter?.dispose();   this._tCenter   = null;
        this._tRotation?.dispose(); this._tRotation = null;
        this._tScale?.dispose();    this._tScale    = null;
        this._tColor?.dispose();    this._tColor    = null;
    }

    // -----------------------------------------------------------------------
    // Per-frame entry point — apply result + dispatch next sort.
    // Called from ViewportManager._updateSplats() before the render pass.
    // -----------------------------------------------------------------------
    sort(camera: THREE.Camera): void {
        if (this._count === 0) return;

        // 1. Apply last completed worker result to GPU buffers
        if (this._gpuDirty && this._readyOrder) {
            this._applyOrder(this._readyOrder);
            this._gpuDirty = false;
        }

        // 2. Compute row-2 of model-view matrix (the depth axis)
        this._mvMatrix.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld);
        const el = this._mvMatrix.elements; // column-major
        const r0=el[2], r1=el[6], r2=el[10], r3=el[14];

        // 3. Lazy skip — camera hasn't moved enough
        const lr = this._lastViewRow;
        if (this._opts.lazyResort) {
            if (Math.abs(r0-lr[0])<1e-5 && Math.abs(r1-lr[1])<1e-5 &&
                Math.abs(r2-lr[2])<1e-5 && Math.abs(r3-lr[3])<1e-5) return;
        }

        // Update world-space frustum planes for culling
        if (this._opts.frustumCull) {
            this._frustumPVM.multiplyMatrices(
                (camera as THREE.PerspectiveCamera).projectionMatrix,
                camera.matrixWorldInverse,
            );
            this._worldFrustum.setFromProjectionMatrix(this._frustumPVM);
        }

        lr[0]=r0; lr[1]=r1; lr[2]=r2; lr[3]=r3;

        // 4a. Sync path (workerSort disabled)
        if (!this._opts.workerSort || !this._worker) {
            this._sortSync(r0, r1, r2, r3);
            return;
        }

        // 4b. Worker path — throttle
        if (this._opts.throttle && this._sortInFlight) return;

        this._sortInFlight = true;

        // 5. Ping-pong: transfer the last result buffer back to worker (zero-copy)
        const reclaimBuf = this._readyOrder?.buffer;
        this._readyOrder = null;

        const msg: Record<string, unknown> = { type: 'sort', viewRow: [r0, r1, r2, r3] };
        const transfers: Transferable[] = [];
        if (reclaimBuf && reclaimBuf.byteLength > 0) {
            msg.reclaimBuf = reclaimBuf;
            transfers.push(reclaimBuf);
        }
        this._worker.postMessage(msg, transfers);
    }

    // -----------------------------------------------------------------------
    // Synchronous sort fallback (workerSort = false)
    // -----------------------------------------------------------------------
    private _sortSync(r0: number, r1: number, r2: number, r3: number): void {
        const n   = this._count;
        const pos = this._positions;
        const indices: number[] = new Array(n);
        for (let i = 0; i < n; i++) indices[i] = i;
        // Ascending z = back-to-front (camera looks along -Z → more negative = farther)
        indices.sort((a, b) =>
            (r0*pos[3*a] + r1*pos[3*a+1] + r2*pos[3*a+2] + r3) -
            (r0*pos[3*b] + r1*pos[3*b+1] + r2*pos[3*b+2] + r3)
        );
        this._applyOrder(new Uint32Array(indices));
    }

    // -----------------------------------------------------------------------
    // Apply/update optimisation options at runtime.
    // -----------------------------------------------------------------------
    setOptions(opts: SplatOpts): void {
        const wasWorker   = this._opts.workerSort;
        const wasIndirect = this._opts.gpuIndirect;
        this._opts = { ...opts };

        // Alpha threshold uniform
        this._material.uniforms.uAlphaThreshold.value = opts.alphaThreshold;

        // GPU indirect mode switch (rebuilds geometry layout + material + textures)
        if (opts.gpuIndirect !== wasIndirect && this._count > 0) {
            if (opts.gpuIndirect) {
                this._enterIndirectMode();
            } else {
                this._enterDirectMode();
                // Force a re-sort so direct buffers get filled
                this._lastViewRow.fill(0);
            }
        }

        // Update texture uniform references if we just entered indirect mode
        if (opts.gpuIndirect) {
            const u = this._material.uniforms;
            if (u.tCenter)   u.tCenter.value   = this._tCenter;
            if (u.tRotation) u.tRotation.value = this._tRotation;
            if (u.tScale)    u.tScale.value     = this._tScale;
            if (u.tColor)    u.tColor.value     = this._tColor;
            if (u.uTexWidth) u.uTexWidth.value  = this._texWidth;
        }

        // Worker ↔ sync switch
        if (wasWorker && !opts.workerSort && this._worker) {
            this._worker.terminate();
            this._worker = null;
            this._sortInFlight = false;
        }
        if (!wasWorker && opts.workerSort && this._count > 0) {
            this._startWorker(new Float32Array(this._positions).buffer);
        }
    }

    // -----------------------------------------------------------------------
    // _applyOrder: frustum-cull → LOD-slice → upload to GPU (direct or indirect)
    // "order" is back-to-front: order[0]=farthest, order[n-1]=nearest.
    // -----------------------------------------------------------------------
    private _applyOrder(order: Uint32Array): void {
        const n = order.length;
        if (n === 0) { this._geometry.instanceCount = 0; return; }

        let workOrder: Uint32Array = order;
        let workCount = n;

        // 1. Frustum culling — build filtered list (reuse _tempOrder buffer)
        if (this._opts.frustumCull) {
            if (!this._tempOrder || this._tempOrder.length < n) {
                this._tempOrder = new Uint32Array(n);
            }
            let w = 0;
            const f  = this._worldFrustum;
            const pt = this._cullPt;
            const mw = this.matrixWorld;
            const pos = this._positions;
            for (let j = 0; j < n; j++) {
                const i = order[j];
                pt.set(pos[3*i], pos[3*i+1], pos[3*i+2]);
                pt.applyMatrix4(mw);
                if (f.containsPoint(pt)) this._tempOrder[w++] = i;
            }
            workOrder = this._tempOrder;
            workCount = w;
        }

        // 2. LOD — keep the nearest `lodFactor` fraction (end of back-to-front array)
        let startIdx = 0;
        let count    = workCount;
        if (this._opts.lodFactor < 1.0) {
            count    = Math.max(1, Math.ceil(workCount * this._opts.lodFactor));
            startIdx = workCount - count; // skip farthest, keep nearest
        }

        // 3. Upload
        if (this._opts.gpuIndirect) {
            this._uploadOrderIndirect(workOrder, startIdx, count);
        } else {
            this._scatterDirect(workOrder, startIdx, count);
        }
    }

    private _scatterDirect(order: Uint32Array, start: number, count: number): void {
        const pos = this._positions, rot = this._rotations;
        const scl = this._scales,    col = this._colors;
        const bc  = this._abCenter.array   as Float32Array;
        const br  = this._abRotation.array as Float32Array;
        const bs  = this._abScale.array    as Float32Array;
        const bg  = this._abColor.array    as Float32Array;
        for (let j = 0; j < count; j++) {
            const i = order[start + j];
            bc[3*j]=pos[3*i]; bc[3*j+1]=pos[3*i+1]; bc[3*j+2]=pos[3*i+2];
            br[4*j]=rot[4*i]; br[4*j+1]=rot[4*i+1]; br[4*j+2]=rot[4*i+2]; br[4*j+3]=rot[4*i+3];
            bs[3*j]=scl[3*i]; bs[3*j+1]=scl[3*i+1]; bs[3*j+2]=scl[3*i+2];
            bg[4*j]=col[4*i]; bg[4*j+1]=col[4*i+1]; bg[4*j+2]=col[4*i+2]; bg[4*j+3]=col[4*i+3];
        }
        this._abCenter.needsUpdate = this._abRotation.needsUpdate =
            this._abScale.needsUpdate = this._abColor.needsUpdate = true;
        this._geometry.instanceCount = count;
    }

    private _uploadOrderIndirect(order: Uint32Array, start: number, count: number): void {
        if (!this._abOrder) return;
        const ao = this._abOrder.array as Float32Array;
        for (let j = 0; j < count; j++) ao[j] = order[start + j];
        this._abOrder.needsUpdate = true;
        this._geometry.instanceCount = count;
    }

    // -----------------------------------------------------------------------

    updateUniforms(
        camera: THREE.PerspectiveCamera,
        width: number,
        height: number,
    ): void {
        const fovRad = THREE.MathUtils.degToRad(camera.fov);
        const fy = (height / 2) / Math.tan(fovRad / 2);
        const fx = fy * camera.aspect;

        const u = this._material.uniforms;
        u.modelMatrix.value.copy(this.matrixWorld);
        u.viewMatrix.value.copy(camera.matrixWorldInverse);
        u.projectionMatrix.value.copy(camera.projectionMatrix);
        u.uFocal.value.set(fx, fy);
        u.uViewport.value.set(width, height);
    }

    // -----------------------------------------------------------------------

    override dispose(): void {
        this._worker?.terminate();
        this._worker = null;
        this._disposeTextures();
        this._geometry.dispose();
        this._material.dispose();
    }
}
