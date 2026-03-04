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
  lodFactor:      number;   // 0.05–1.0
  streamingLOD:   boolean;  // spatial-grid streaming LOD
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
  streamingLOD:   false,
};

// ---------------------------------------------------------------------------
// SplatGrid — uniform 16³ spatial grid for streaming/spatial LOD.
//
// Built once in updateFromData.  Each frame, updateBudgets() computes a
// per-cell render quota that scales quadratically with the cell's apparent
// screen coverage: cells near the camera get full density; distant cells
// are thinned to a small representative fraction.
//
// During _applyOrder the back-to-front traversal respects each cell's
// budget: the first `budget[c]` splats from cell c are rendered, the rest
// are skipped.  Because we traverse back-to-front, the skipped splats are
// the ones that would be occluded anyway — correct blending is preserved.
// ---------------------------------------------------------------------------
class SplatGrid {
    static readonly RES = 16;  // cells per axis → 16³ = 4 096 cells

    /** Which grid cell splat i belongs to — index into cellCenter / budget / seen */
    readonly cellOf:     Int32Array;
    /** Total splat count in each cell — used as upper bound for budgets */
    readonly cellCount:  Int32Array;
    /** World-space centre of each cell (packed xyz): Float32Array[cell*3 .. +2] */
    readonly cellCenter: Float32Array;
    /** Per-frame render quota for each cell (how many splats to draw) */
    readonly budget:     Int32Array;
    /** Per-frame counter: splats drawn from each cell so far this frame */
    readonly seen:       Int32Array;

    private readonly _ncells: number;

    constructor(positions: Float32Array, n: number) {
        const RES = SplatGrid.RES;
        const NC  = RES * RES * RES;
        this._ncells    = NC;
        this.cellOf     = new Int32Array(n);
        this.cellCount  = new Int32Array(NC);
        this.cellCenter = new Float32Array(NC * 3);
        this.budget     = new Int32Array(NC);
        this.seen       = new Int32Array(NC);

        // 1. Compute AABB of the cloud
        let minX=Infinity,  minY=Infinity,  minZ=Infinity;
        let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
        for (let i = 0; i < n; i++) {
            const x=positions[3*i], y=positions[3*i+1], z=positions[3*i+2];
            if (x<minX) minX=x;  if (x>maxX) maxX=x;
            if (y<minY) minY=y;  if (y>maxY) maxY=y;
            if (z<minZ) minZ=z;  if (z>maxZ) maxZ=z;
        }

        // 2. Assign each splat to a cell
        const eps  = 1e-4; // tiny pad so boundary splats don't fall into index RES
        const invW = RES / (maxX - minX + eps);
        const invH = RES / (maxY - minY + eps);
        const invD = RES / (maxZ - minZ + eps);
        const cellW = (maxX - minX + eps) / RES;
        const cellH = (maxY - minY + eps) / RES;
        const cellD = (maxZ - minZ + eps) / RES;

        for (let i = 0; i < n; i++) {
            const cx = Math.min(RES-1, Math.floor((positions[3*i  ] - minX) * invW));
            const cy = Math.min(RES-1, Math.floor((positions[3*i+1] - minY) * invH));
            const cz = Math.min(RES-1, Math.floor((positions[3*i+2] - minZ) * invD));
            const c  = cx + cy * RES + cz * RES * RES;
            this.cellOf[i] = c;
            this.cellCount[c]++;
        }

        // 3. Cell centres (world space)
        for (let cz=0; cz<RES; cz++)
        for (let cy=0; cy<RES; cy++)
        for (let cx=0; cx<RES; cx++) {
            const c = cx + cy*RES + cz*RES*RES;
            this.cellCenter[3*c  ] = minX + (cx + 0.5) * cellW;
            this.cellCenter[3*c+1] = minY + (cy + 0.5) * cellH;
            this.cellCenter[3*c+2] = minZ + (cz + 0.5) * cellD;
        }
    }

    /**
     * Recompute per-cell render budgets for the current camera position.
     *
     * viewRow  — MV matrix row 2: translates world pos to camera-Z.
     * focal    — mean focal length in pixels: (fx + fy) / 2.
     *
     * Budget formula (quadratic screen-coverage falloff):
     *   screenPx  = focal / |viewZ_of_cell_centre|   (≈ cell half-width in px)
     *   fraction  = clamp(screenPx / TARGET_PX, MIN_FRAC, 1)²
     *   budget[c] = max(1, ceil(cellCount[c] * fraction))
     *
     * TARGET_PX = 128: cells subtending ≥ 128 px → full density.
     * MIN_FRAC  = 0.02: even the most distant cell renders at least 2% of its
     *                    splats so the cloud silhouette is always visible.
     */
    updateBudgets(viewRow: Float32Array, focal: number): void {
        const r0=viewRow[0], r1=viewRow[1], r2=viewRow[2], r3=viewRow[3];
        const nc  = this._ncells;
        const cen = this.cellCenter;
        const bud = this.budget;
        const cnt = this.cellCount;
        const TARGET_PX = 128;
        const MIN_FRAC  = 0.02;
        for (let c = 0; c < nc; c++) {
            if (cnt[c] === 0) { bud[c] = 0; continue; }
            const viewZ = Math.abs(
                r0*cen[3*c] + r1*cen[3*c+1] + r2*cen[3*c+2] + r3
            );
            const screenPx = focal / (viewZ < 0.01 ? 0.01 : viewZ);
            const f   = Math.min(1.0, screenPx / TARGET_PX);
            const frac = Math.max(MIN_FRAC, f * f);
            bud[c] = Math.max(1, Math.ceil(cnt[c] * frac));
        }
        this.seen.fill(0); // reset frame counters here for locality
    }
}

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
uniform float uLinearOutput;    // 1 = decode sRGB→linear before output (anaglyph composite mode)

out vec4 fragColor;

// Precise IEC 61966-2-1 sRGB→linear per component
float sRGBDecode(float c) {
    return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 4.0) discard;                  // clip to circle of radius 2

    float alpha = exp(-r2) * vColor.a;      // Gaussian falloff × splat opacity
    if (uAlphaThreshold > 0.0 && alpha < uAlphaThreshold) discard;

    // In normal rendering GS bypasses Three.js color management (RawShaderMaterial)
    // and outputs vColor.rgb directly. In anaglyph mode the composite shader applies
    // sRGB encoding once (linearToOutputTexel). Pre-decoding here cancels that out
    // so the final canvas value equals the original vColor.rgb.
    vec3 rgb = uLinearOutput > 0.5
        ? vec3(sRGBDecode(vColor.r), sRGBDecode(vColor.g), sRGBDecode(vColor.b))
        : vColor.rgb;
    fragColor = vec4(rgb, alpha);
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

    // Screen-space LOD helpers — updated every frame, used in _applyOrder
    private _maxScales:      Float32Array | null = null;  // max(sx,sy,sz) per splat, computed once
    private _currentFocal    = 500;                        // px, mean of fx/fy, updated in updateUniforms
    private _currentViewRow  = new Float32Array(4);        // MV row-2, updated in sort()

    // Streaming / spatial-LOD grid — built once on load, queried every frame
    private _grid: SplatGrid | null = null;

    // Async sort state
    private _worker:      Worker | null      = null;
    private _sortInFlight = false;
    private _gpuDirty     = false;
    private _readyOrder:  Uint32Array | null = null;
    private _lastViewRow  = new Float32Array(4);
    private readonly _mvMatrix = new THREE.Matrix4();

    // Optimisation options
    private _opts: SplatOpts = { ...DEFAULT_SPLAT_OPTS };

    // Crop box (model-space AABB) — splats outside this box are hidden
    private _cropMin: THREE.Vector3 | null = null;
    private _cropMax: THREE.Vector3 | null = null;

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
            uLinearOutput:     { value: 0.0 },
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
            // CustomBlending enforces SrcAlpha / ONE_MINUS_SRC_ALPHA regardless
            // of the renderer's premultipliedAlpha:true default. NormalBlending
            // with premultipliedAlpha uses ONE as the src factor, which adds the
            // full rgb at any alpha level and creates a halo on low-alpha edges.
            blending:           THREE.CustomBlending,
            blendEquation:      THREE.AddEquation,
            blendSrc:           THREE.SrcAlphaFactor,
            blendDst:           THREE.OneMinusSrcAlphaFactor,
            blendEquationAlpha: THREE.AddEquation,
            blendSrcAlpha:      THREE.OneFactor,
            blendDstAlpha:      THREE.OneMinusSrcAlphaFactor,
            glslVersion: THREE.GLSL3,
        });
    }

    /** Switch GS output to linear (sRGB-decoded) for the anaglyph composite pass. */
    public setLinearOutput(enabled: boolean): void {
        if (this._material.uniforms.uLinearOutput) {
            this._material.uniforms.uLinearOutput.value = enabled ? 1.0 : 0.0;
        }
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

        // Pre-compute per-splat max scale — used by the screen-space LOD filter.
        // We take the largest of the 3 scale components; that's the dominant footprint axis.
        const scl = this._scales;
        this._maxScales = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const sx = scl[3*i], sy = scl[3*i+1], sz = scl[3*i+2];
            this._maxScales[i] = sx > sy ? (sx > sz ? sx : sz) : (sy > sz ? sy : sz);
        }

        // Build spatial grid for streaming LOD (O(n), ~40 bytes/splat overhead)
        this._grid = new SplatGrid(this._positions, n);

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
        this._currentViewRow[0]=r0; this._currentViewRow[1]=r1;
        this._currentViewRow[2]=r2; this._currentViewRow[3]=r3;

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
    // Crop box — axis-aligned box in model (object) space.
    // Splats outside the box are culled in _applyOrder.
    // Calling either method forces a re-sort on the next frame.
    // -----------------------------------------------------------------------
    public setCropBox(min: THREE.Vector3, max: THREE.Vector3): void {
        this._cropMin = min.clone();
        this._cropMax = max.clone();
        this._lastViewRow.fill(0); // invalidate cached view row → re-sort next frame
    }

    public clearCropBox(): void {
        this._cropMin = null;
        this._cropMax = null;
        this._lastViewRow.fill(0);
    }

    // -----------------------------------------------------------------------
    // _applyOrder — single-pass: frustum-cull → screen-LOD → streaming-LOD → GPU
    //
    // "order" is back-to-front (order[0]=farthest).  All three filter stages
    // share one preallocated _tempOrder buffer; they all run in one loop so
    // cache pressure is minimised and no intermediate copies are needed.
    //
    // Filter semantics:
    //   frustumCull  — drops splats whose world position is outside the view frustum.
    //   lodFactor    — drops splats whose per-splat screen footprint < minPx.
    //                  lodFactor 1.0 → minPx=0 (show all); 0.05 → minPx≈3.8 px.
    //   streamingLOD — per-cell quadratic density falloff with camera distance.
    //                  Near cells → full density; far cells → 2 %+ of splats.
    //                  Maintains correct back-to-front blending in every cell.
    // -----------------------------------------------------------------------
    private _applyOrder(order: Uint32Array): void {
        const n = order.length;
        if (n === 0) { this._geometry.instanceCount = 0; return; }

        const needFrustum = this._opts.frustumCull;
        const needLOD     = this._opts.lodFactor < 1.0 && this._maxScales !== null;
        const needStream  = this._opts.streamingLOD && this._grid !== null;
        const needCrop    = this._cropMin !== null;

        let workOrder: Uint32Array = order;
        let workCount = n;

        if (needFrustum || needLOD || needStream || needCrop) {
            if (!this._tempOrder || this._tempOrder.length < n) {
                this._tempOrder = new Uint32Array(n);
            }
            const tmp = this._tempOrder;

            // Streaming LOD: compute per-cell budgets once (O(ncells) ≈ 4 096 iterations)
            if (needStream) this._grid!.updateBudgets(this._currentViewRow, this._currentFocal);

            const f  = needFrustum ? this._worldFrustum : null;
            const pt = needFrustum ? this._cullPt       : null;
            const mw = this.matrixWorld;

            const minPx = needLOD ? (1.0 - this._opts.lodFactor) * 4.0 : 0;
            const focal = this._currentFocal;
            const vr    = this._currentViewRow;
            const r0=vr[0], r1=vr[1], r2=vr[2], r3=vr[3];
            const pos   = this._positions;
            const ms    = this._maxScales!;
            const grid  = this._grid;

            // Cache crop bounds as plain scalars for hot-path performance
            const cMinX = needCrop ? this._cropMin!.x : 0;
            const cMinY = needCrop ? this._cropMin!.y : 0;
            const cMinZ = needCrop ? this._cropMin!.z : 0;
            const cMaxX = needCrop ? this._cropMax!.x : 0;
            const cMaxY = needCrop ? this._cropMax!.y : 0;
            const cMaxZ = needCrop ? this._cropMax!.z : 0;

            let w = 0;
            for (let j = 0; j < n; j++) {
                const i = order[j];
                const px=pos[3*i], py=pos[3*i+1], pz=pos[3*i+2];

                // ── 0. Crop box (model space) ────────────────────────────────
                if (needCrop) {
                    if (px < cMinX || px > cMaxX ||
                        py < cMinY || py > cMaxY ||
                        pz < cMinZ || pz > cMaxZ) continue;
                }

                // ── 1. Frustum cull ──────────────────────────────────────────
                if (needFrustum) {
                    pt!.set(px, py, pz).applyMatrix4(mw);
                    if (!f!.containsPoint(pt!)) continue;
                }

                // ── 2. Per-splat screen-space LOD ────────────────────────────
                if (needLOD) {
                    const viewZ = r0*px + r1*py + r2*pz + r3;
                    if (ms[i] * focal / Math.abs(viewZ) < minPx) continue;
                }

                // ── 3. Spatial streaming LOD — per-cell budget ───────────────
                // Budget scales as coverage²: near cells → full density,
                // far cells → fraction proportional to their screen footprint.
                if (needStream) {
                    const c = grid!.cellOf[i];
                    if (grid!.seen[c] >= grid!.budget[c]) continue;
                    grid!.seen[c]++;
                }

                tmp[w++] = i;
            }
            workOrder = tmp;
            workCount = w;
        }

        if (workCount === 0) { this._geometry.instanceCount = 0; return; }

        // ── 4. Upload ────────────────────────────────────────────────────────
        if (this._opts.gpuIndirect) {
            this._uploadOrderIndirect(workOrder, 0, workCount);
        } else {
            this._scatterDirect(workOrder, 0, workCount);
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
        // For a standard perspective camera with square pixels:
        //   fx_correct = (width/2) / tan(hFOV/2)
        //              = (height*aspect/2) / (tan(vFOV/2)*aspect)
        //              = (height/2) / tan(vFOV/2)
        //              = fy
        // Using fx = fy*aspect is wrong: it inflates the X semi-axis by `aspect`
        // in Jacobian pixel-space. The NDC conversion (*2/uViewport.x) only
        // partially cancels this, leaving splats stretched by `aspect` on screen.
        const fx = fy;

        // Store for screen-space LOD in _applyOrder
        this._currentFocal = fy;

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
        this._grid   = null;
        this._disposeTextures();
        this._geometry.dispose();
        this._material.dispose();
    }
}
