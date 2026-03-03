/**
 * SplatMesh — native three.js Gaussian Splatting renderer.
 *
 * Renders 3D Gaussian splats as a THREE.Mesh using an InstancedBufferGeometry
 * and a RawShaderMaterial with GLSL3 shaders that share the WebGL2 depth buffer
 * with the rest of the three.js scene. This allows proper depth compositing
 * between geometry and splats.
 *
 * Sorting: front-to-back (ascending cam-space Z).
 * Blending: premultiplied front-to-back (src=ONE_MINUS_DST_ALPHA, dst=ONE).
 */

import * as THREE from 'three';
import type { SplatData } from 'gsplat';

// ---------------------------------------------------------------------------
// GLSL shaders
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `precision highp float;
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
         uFocal.x / z,                       0.0,  -(uFocal.x * cam.x) / z2,
         0.0,                          -uFocal.y / z,  (uFocal.y * cam.y) / z2,
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

const fragmentShader = /* glsl */ `precision highp float;

in  vec2 vUv;
in  vec4 vColor;

out vec4 fragColor;

void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 4.0) discard;                  // clip to circle of radius 2

    float alpha = exp(-r2) * vColor.a;      // Gaussian falloff × splat opacity
    fragColor = vec4(vColor.rgb, alpha);          // non-premultiplied
}
`;

// ---------------------------------------------------------------------------

export class SplatMesh extends THREE.Object3D {
    private _geometry!: THREE.InstancedBufferGeometry;
    private _material!: THREE.RawShaderMaterial;
    private _mesh!: THREE.Mesh;

    // instanced attribute buffers (typed-array views, re-uploaded each sort)
    private _count       = 0;
    private _positions!: Float32Array;   // original (unsorted)
    private _rotations!: Float32Array;
    private _scales!:    Float32Array;
    private _colors!:    Float32Array;

    // GPU instanced buffers
    private _abCenter!:   THREE.InstancedBufferAttribute;
    private _abRotation!: THREE.InstancedBufferAttribute;
    private _abScale!:    THREE.InstancedBufferAttribute;
    private _abColor!:    THREE.InstancedBufferAttribute;

    constructor() {
        super();
        this._buildGeometry();
        this._buildMaterial();
        this._mesh = new THREE.Mesh(this._geometry, this._material);
        this._mesh.frustumCulled = false;   // we manage visibility ourselves
        this.add(this._mesh);
    }

    // -----------------------------------------------------------------------
    // Build base quad geometry
    // -----------------------------------------------------------------------
    private _buildGeometry(): void {
        const geo = new THREE.InstancedBufferGeometry();

        // Unit quad corners ±2 (two triangles)
        const corners = new Float32Array([
            -2, -2,
             2, -2,
             2,  2,
            -2,  2,
        ]);
        const indices = [0, 1, 2,  0, 2, 3];

        geo.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
        geo.setIndex(indices);

        // Instanced attributes will be set in updateFromData / after first sort
        this._geometry = geo;
    }

    // -----------------------------------------------------------------------
    // Build material
    // -----------------------------------------------------------------------
    private _buildMaterial(): void {
        this._material = new THREE.RawShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                modelMatrix:      { value: new THREE.Matrix4() },
                viewMatrix:       { value: new THREE.Matrix4() },
                projectionMatrix: { value: new THREE.Matrix4() },
                uFocal:           { value: new THREE.Vector2(500, 500) },
                uViewport:        { value: new THREE.Vector2(1, 1) },
            },
            depthTest:  true,
            depthWrite: false,       // don't write depth so splats don't self-occlude
            transparent: true,
            side: THREE.DoubleSide,
            // Standard back-to-front alpha blending — works against any solid background.
            // (ONE_MINUS_DST_ALPHA/ONE only works when the framebuffer alpha is 0,
            //  but three.js fills the background at alpha=1.)
            blending: THREE.NormalBlending,
            glslVersion: THREE.GLSL3,
        });
    }

    // -----------------------------------------------------------------------
    // Load splat data from a gsplat SplatData object
    // -----------------------------------------------------------------------
    updateFromData(data: SplatData): void {
        const n = data.vertexCount;
        this._count = n;

        // Make local copies so we can sort without mutating SplatData
        this._positions = new Float32Array(data.positions);
        this._rotations = new Float32Array(data.rotations);
        this._scales    = new Float32Array(data.scales);

        // Colors: SplatData.colors is Uint8Array [0,255], normalise to [0,1]
        const colorsU8 = data.colors;
        this._colors = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            this._colors[4*i+0] = colorsU8[4*i+0] / 255;
            this._colors[4*i+1] = colorsU8[4*i+1] / 255;
            this._colors[4*i+2] = colorsU8[4*i+2] / 255;
            this._colors[4*i+3] = colorsU8[4*i+3] / 255;
        }

        // Allocate GPU instanced buffers (worst-case size, updated in sort)
        this._abCenter   = new THREE.InstancedBufferAttribute(new Float32Array(n*3), 3);
        this._abRotation = new THREE.InstancedBufferAttribute(new Float32Array(n*4), 4);
        this._abScale    = new THREE.InstancedBufferAttribute(new Float32Array(n*3), 3);
        this._abColor    = new THREE.InstancedBufferAttribute(new Float32Array(n*4), 4);

        this._abCenter.setUsage(THREE.DynamicDrawUsage);
        this._abRotation.setUsage(THREE.DynamicDrawUsage);
        this._abScale.setUsage(THREE.DynamicDrawUsage);
        this._abColor.setUsage(THREE.DynamicDrawUsage);

        this._geometry.setAttribute('aCenter',   this._abCenter);
        this._geometry.setAttribute('aRotation', this._abRotation);
        this._geometry.setAttribute('aScale',    this._abScale);
        this._geometry.setAttribute('aColor',    this._abColor);
        this._geometry.instanceCount = n;
    }

    // -----------------------------------------------------------------------
    // Sort splats by camera-space depth and upload sorted buffers to GPU.
    // Call once per frame before rendering.
    // -----------------------------------------------------------------------
    sort(camera: THREE.Camera): void {
        if (this._count === 0) return;

        const n      = this._count;
        const pos    = this._positions;  // [x0,y0,z0, x1,y1,z1, ...]
        const mvMat  = new THREE.Matrix4().multiplyMatrices(
            camera.matrixWorldInverse,
            this.matrixWorld,
        );

        // Compute camera-space Z for each splat
        const depths = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const wx = pos[3*i],   wy = pos[3*i+1], wz = pos[3*i+2];
            // Row 2 of 4x4 matrix (column-major: elements [2], [6], [10], [14])
            depths[i] = mvMat.elements[2]*wx + mvMat.elements[6]*wy
                      + mvMat.elements[10]*wz + mvMat.elements[14];
        }

        // Sort front-to-back: ascending depth (depth is negative in three.js,
        // so most negative = furthest, least negative = closest).
        // We want front-to-back for ONE_MINUS_DST_ALPHA blending.
        const order = Array.from({ length: n }, (_, i) => i);
        order.sort((a, b) => depths[a] - depths[b]);  // ascending = back-to-front for three.js -Z convention

        // Write sorted data into the instanced buffers
        const bc = this._abCenter.array   as Float32Array;
        const br = this._abRotation.array as Float32Array;
        const bs = this._abScale.array    as Float32Array;
        const bg = this._abColor.array    as Float32Array;

        const rot = this._rotations;
        const scl = this._scales;
        const col = this._colors;

        for (let j = 0; j < n; j++) {
            const i = order[j];
            bc[3*j]=pos[3*i]; bc[3*j+1]=pos[3*i+1]; bc[3*j+2]=pos[3*i+2];
            br[4*j]=rot[4*i]; br[4*j+1]=rot[4*i+1]; br[4*j+2]=rot[4*i+2]; br[4*j+3]=rot[4*i+3];
            bs[3*j]=scl[3*i]; bs[3*j+1]=scl[3*i+1]; bs[3*j+2]=scl[3*i+2];
            bg[4*j]=col[4*i]; bg[4*j+1]=col[4*i+1]; bg[4*j+2]=col[4*i+2]; bg[4*j+3]=col[4*i+3];
        }

        this._abCenter.needsUpdate   = true;
        this._abRotation.needsUpdate = true;
        this._abScale.needsUpdate    = true;
        this._abColor.needsUpdate    = true;
    }

    // -----------------------------------------------------------------------
    // Update per-frame uniforms (call from ViewportManager each frame)
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
    // Dispose GPU resources
    // -----------------------------------------------------------------------
    override dispose(): void {
        this._geometry.dispose();
        this._material.dispose();
    }
}
