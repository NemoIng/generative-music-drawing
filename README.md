# Harmonic Geometry: Generative Music Drawing

An interactive generative music drawing system that translates hand-drawn spline curves into spatial musical scores. Built with **Arc-Length Parameterization** and **Modal Scale Quantization with Deadband Hysteresis**.

---

## Mathematical Foundations

### 1. Arc-Length Parameterization Lookup Table (LUT)
Bézier splines parameterized by naive time parameter $t \in [0, 1]$ accelerate in flat regions and decelerate in tight turns because the first derivative magnitude $\|B'(t)\|$ is non-uniform.

* **Composite Simpson's Quadrature:**
  $$\Delta s_{k, i} \approx \frac{t_{k, i} - t_{k, i-1}}{6} \left( \|B'_k(t_{k, i-1})\| + 4 \|B'_k(t_{\text{mid}})\| + \|B'_k(t_{k, i})\| \right)$$
* **Monotonic Cumulative LUT:**
  $$S[m] = \sum_{j=1}^m \Delta s_j, \quad S[0] = 0, \quad S[\text{end}] = L$$
* **Inversion & Position Evaluation:**
  1. Phase Wrapping: $s^* = (v \cdot \Delta t) \pmod L$ (for closed loops) or ping-pong bounds (for open curves).
  2. Binary Search: Locates $S[j] \le s^* < S[j + 1]$.
  3. Linear Interpolation: $\alpha = \frac{s^* - S[j]}{S[j + 1] - S[j]}$, $t^* = t_j + \alpha(t_{j + 1} - t_j)$.
  4. Newton-Raphson Refinement:
     $$t_{\text{refined}} = t^* - \frac{s_k(t^*) - (s^* - S_{\text{seg\_start}})}{\|B'_k(t^*)\|}$$
  5. Position & Tangent: Evaluates $B_k(t_{\text{refined}})$ to ensure constant-velocity traversal in pixels/second.

---

### 2. Coordinate-to-Pitch Scale Quantizer
Standard computer graphics has $(0, 0)$ top-left, while musical frequency increases upwards.

* **Inversion & Normalization:**
  $$u = \text{clamp}\left(1 - \frac{y}{H}, 0, 1\right), \quad d_{\text{cont}} = u \cdot (N_{\text{notes}} - 1)$$
* **Discrete Snapping (Dotted / Striped Strokes):**
  $$k = \text{round}(d_{\text{cont}}), \quad m = \lfloor k / K \rfloor, \quad r = k \pmod K$$
  $$\Delta_{\text{semitones}} = 12m + I[r], \quad f = f_{\text{root}} \cdot 2^{\Delta_{\text{semitones}} / 12}$$
* **Continuous Modal Pitch Interpolation (Solid Drones):**
  With continuous degree $d_{\text{cont}}$, let $k_1 = \lfloor d_{\text{cont}} \rfloor$, $k_2 = k_1 + 1$, and $\gamma = d_{\text{cont}} - k_1$:
  $$\Delta_{\text{semitones}} = (1 - \gamma)\,\text{semi}(k_1) + \gamma\,\text{semi}(k_2), \quad f = f_{\text{root}} \cdot 2^{\Delta_{\text{semitones}} / 12}$$
  Provides pristine, continuous microtonal glides across vertical curves matching hand-drawn contours.
* **Per-Line Tone Fluctuation:**
  An individual slider $f \in [0, 1]$ introduces subtle, organic multi-frequency wander around the line for drone voices and hit-by-hit micro-tuning jitter for pulsed notes.

---

## Stroke Textures & Voice Synthesis

1. **Solid Drone Strokes:**
   * Continuous dual-oscillator drone voice (detuned sawtooth + triangle + sub-oscillator).
   * Resonant low-pass filter dynamically modulated by curve curvature $\kappa$ (tighter bends open higher harmonic resonance).
   * Smooth modal portamento glides and per-stroke tone fluctuation wander.
2. **Dotted Strokes:**
   * Acoustic chime / plucked string voice.
   * Triggered when the playhead traverses dot boundaries along arc length.
   * Snapped to discrete modal scale intervals.
3. **Striped Strokes:**
   * Rhythmic pulse bursts / resonant FM percussion.
   * Higher trigger frequency along arc length.

---

## Development & Usage

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

### Run Unit Tests
```bash
npm test
```

### Build Production Bundle
```bash
npm run build
```
