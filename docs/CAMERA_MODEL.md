# Camera Model Reference

> Mathematical specification for the photogrammetry coverage system.
> Source implementation: `src/core/math/CameraModel.ts`

---

## 1. Coordinate Conventions

| Quantity | Convention |
|---|---|
| World handedness | Right-handed (+Y up, Three.js default) |
| Camera forward axis | **−Z** (camera looks down −Z in local space) |
| Camera up axis | +Y |
| Pixel origin | Top-left corner `(0, 0)` |
| Pixel x | Increases rightward |
| Pixel y | Increases **downward** |
| Rotation storage | Euler XYZ, degrees (DAG) → radians (Three.js) |

This is Three.js's native convention. A camera at the origin looking forward has:

```
rotation = (0, 0, 0)
worldMatrix = I
camera space -Z = world -Z  → looks into the screen
```

---

## 2. Filmback and Sensor Size

A CameraNode stores:

| Attribute | Unit | Default |
|---|---|---|
| `focalLength` | mm | 35.0 |
| `horizontalFilmAperture` | **inches** | 1.417 (= 36.0 mm) |
| `verticalFilmAperture` | **inches** | 0.945 (= 24.0 mm) |
| `filmFit` | enum | Horizontal |

Conversion: `sensorWidthMm = horizontalFilmAperture * 25.4`

The **film aspect** ratio is:

$$A_\text{film} = \frac{W_\text{sensor, mm}}{H_\text{sensor, mm}}$$

The **viewport aspect** ratio is:

$$A_\text{vp} = \frac{W_\text{pixels}}{H_\text{pixels}}$$

---

## 3. Film-Fit Modes

Film-fit determines what happens when $A_\text{vp} \neq A_\text{film}$.

| Mode | Rule | Effective sensor dimensions used |
|---|---|---|
| **Horizontal** | Sensor width governs; height adapts | $W_\text{eff} = W_\text{sensor}$; $H_\text{eff} = W_\text{sensor} / A_\text{vp}$ |
| **Vertical** | Sensor height governs; width adapts | $H_\text{eff} = H_\text{sensor}$; $W_\text{eff} = H_\text{sensor} \cdot A_\text{vp}$ |
| **Fill** | Like Horizontal if $A_\text{vp} > A_\text{film}$, else Vertical | (cropping — no black bars) |
| **Overscan** | Like Vertical if $A_\text{vp} \geq A_\text{film}$, else Horizontal | (bars — all film visible) |

---

## 4. Intrinsic Matrix K

Given effective sensor dimensions $W_\text{eff}$ (mm) and $H_\text{eff}$ (mm):

$$f_x = f_\text{mm} \cdot \frac{W_\text{pixels}}{W_\text{eff, mm}}$$

$$f_y = f_\text{mm} \cdot \frac{H_\text{pixels}}{H_\text{eff, mm}}$$

$$c_x = \frac{W_\text{pixels}}{2}, \quad c_y = \frac{H_\text{pixels}}{2}$$

$$K = \begin{pmatrix} f_x & 0 & c_x \\ 0 & f_y & c_y \\ 0 & 0 & 1 \end{pmatrix}$$

For Horizontal fit (the default), $W_\text{eff} = W_\text{sensor}$, so:

$$f_x = f_\text{mm} \cdot \frac{W}{W_\text{sensor}} \qquad f_y = f_x$$

(square pixels when $A_\text{vp} = A_\text{film}$; otherwise $f_y \neq f_x$ due to aspect correction).

### Field of View from K

$$\text{FoV}_H = 2 \arctan\!\left(\frac{W}{2 f_x}\right), \qquad \text{FoV}_V = 2 \arctan\!\left(\frac{H}{2 f_y}\right)$$

---

## 5. Projection: World → Pixel

Full pipeline: $\mathbf{X}_w \in \mathbb{R}^3$ → pixel $(u, v)$

### Step 1 — World to camera space

$$\mathbf{X}_c = V \cdot \mathbf{X}_w, \qquad V = M_\text{world}^{-1}$$

where $M_\text{world}$ is the camera's $4\times 4$ world transform.

### Step 2 — Perspective division

Camera depth: $d = -(\mathbf{X}_c)_z \quad$ (positive in front of camera since camera looks $-Z$)

$$\tilde{x} = \frac{(\mathbf{X}_c)_x}{d}, \quad \tilde{y} = \frac{(\mathbf{X}_c)_y}{d}$$

### Step 3 — Apply K (with y flip: camera +Y up, pixel +y down)

$$u = f_x \cdot \tilde{x} + c_x$$
$$v = f_y \cdot (-\tilde{y}) + c_y$$

---

## 6. Back-Projection: Pixel → World Ray

Given pixel $(u, v)$:

### Step 1 — Pixel to camera-space direction

$$\mathbf{d}_c = \begin{pmatrix} (u - c_x) / f_x \\ -(v - c_y) / f_y \\ -1 \end{pmatrix}$$

(z = −1 because camera looks down −Z; y sign flips back from pixel convention)

### Step 2 — Camera to world

$$\mathbf{d}_w = R \cdot \mathbf{d}_c$$

where $R$ is the upper-left $3\times 3$ rotation block of $M_\text{world}$.

Camera origin in world space:

$$\mathbf{o}_w = \text{translation column of } M_\text{world}$$

The world-space ray: $\mathbf{r}(t) = \mathbf{o}_w + t \cdot \hat{\mathbf{d}}_w,\quad t > 0$

---

## 7. Angular Resolution and GSD

### Angular resolution (radians per pixel)

$$\Delta\theta = \frac{1}{f_x} \quad [\text{rad/pixel}]$$

A smaller $\Delta\theta$ means finer detail can be resolved.

### Ground Sampling Distance (GSD)

At perpendicular distance $d$ from the camera to a fronto-parallel surface:

$$\text{GSD} = \frac{d}{f_x} \quad [\text{scene-units / pixel}]$$

This is the approximate physical footprint of one pixel. Useful as a proxy for reconstruction resolution.

### Why sensor size matters

Two cameras with the same focal length but different sensor sizes will have different FoVs and GSD:

| Parameter | Sensor A (36×24 mm, full-frame) | Sensor B (15.6×8.7 mm, APS-C style crop) |
|---|---|---|
| Focal length | 50 mm | 50 mm |
| FoV_H | 39.6° | 17.3° |
| GSD at 10 m, 6K width | 1.2 mm | 0.52 mm |

A smaller sensor at the same focal length gives a narrower FoV but potentially finer GSD (the sensor area maps fewer scene units per pixel).

---

## 8. OpenGL Projection Matrix

For completeness, the full $4\times 4$ OpenGL projection matrix that incorporates the principal point:

$$P = \begin{pmatrix}
\frac{2n}{r-l} & 0 & \frac{r+l}{r-l} & 0 \\
0 & \frac{2n}{t-b} & \frac{t+b}{t-b} & 0 \\
0 & 0 & -\frac{f+n}{f-n} & -\frac{2fn}{f-n} \\
0 & 0 & -1 & 0
\end{pmatrix}$$

where:

$$l = -\frac{n \cdot c_x}{f_x},\quad r = \frac{n(W - c_x)}{f_x},\quad b = -\frac{n \cdot c_y}{f_y},\quad t = \frac{n(H - c_y)}{f_y}$$

---

## 9. Photogrammetry Quality Metrics

### Overlap fraction between cameras A and B

$$\text{overlap}_{AB} = \frac{|\mathcal{T}_A \cap \mathcal{T}_B|}{|\mathcal{T}_A \cup \mathcal{T}_B|}$$

where $\mathcal{T}_X$ is the set of visible triangle IDs from camera $X$.

### Baseline-to-depth ratio

For two cameras with centres $C_A, C_B$ observing a point $P$:

$$\text{B/D} = \frac{|C_B - C_A|}{(|P - C_A| + |P - C_B|)/2}$$

Recommended: $\text{B/D} \in [0.1, 0.6]$ for stable triangulation.

### Triangulation angle

$$\theta_t = \angle(\overrightarrow{C_A P},\, \overrightarrow{C_B P}) = \arccos\!\left(\frac{(P - C_A) \cdot (P - C_B)}{|P - C_A|\,|P - C_B|}\right)$$

Ideal: $\theta_t \approx 20\text{–}30°$. Penalise $\theta_t < 5°$ (near-degenerate baseline) or $\theta_t > 60°$.

### Incidence angle

$$\theta_i = \arccos(\hat{v} \cdot \hat{n})$$

where $\hat{v} = (C - P)/|C - P|$ is the viewing direction and $\hat{n}$ is the surface normal.  
Good: $\theta_i < 45°$. Poor: $\theta_i > 70°$ (grazing incidence).

### Per-triangle coverage quality score

$$Q = 0.30 \cdot s_v + 0.35 \cdot s_t + 0.25 \cdot s_i + 0.10 \cdot s_d$$

| Component | Formula | Notes |
|---|---|---|
| View count $s_v$ | $\min(n_\text{views}/n_\text{target},\,1)$ | $n_\text{target}=3$ by default |
| Triangulation $s_t$ | $\exp\!\left(-(\bar\theta_t - 25)^2 / 200\right)$ | Gaussian peaked at 25° |
| Incidence $s_i$ | $\max(0, \cos\theta_i^\text{best})$ | Best (minimum) incidence angle across views |
| Density $s_d$ | sampling density proxy | Normalised angular resolution |

Aggregation across views uses the **P25 robust percentile** to resist single bad-angle outliers inflating the score.

---

## 10. Sampling Strategy

| Resolution | Recommended grid | Rays / camera | Notes |
|---|---|---|---|
| 1080p (1920×1080) | 64 × 36 | ~2,304 | Fast; suitable for real-time feedback |
| 4K (3840×2160) | 128 × 72 | ~9,216 | Good accuracy |
| 8K (7680×4320) | 256 × 144 | ~36,864 | Production quality |

For 50 cameras at 8K: ~1.85 M rays — feasible in a Web Worker with BVH in <2 s.

Each cell of the $N \times M$ grid uses stratified jitter (uniform random within the cell) seeded with a deterministic XorShift32 PRNG for reproducibility.
