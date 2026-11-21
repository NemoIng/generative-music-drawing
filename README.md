# Harmonic Geometry: Generative Music Drawing

An interactive generative music drawing system that translates hand-drawn spline curves into spatial musical scores. Built with **Arc-Length Parameterization**, a **3-Band Piecewise Non-Linear Frequency Scale**, and **Dual-Bank Continuous Modal Pitch Interpolation**.

---

## Mathematical Foundations

### 1. Arc-Length Parameterization Lookup Table (LUT)
Bézier splines parameterized by naive time parameter $t \in [0, 1]$ accelerate in flat regions and decelerate in tight turns because the first derivative magnitude $\|B'(t)\|$ is non-uniform.

* **Composite Simpson's Quadrature:**
  $$\Delta s_{k, i} \approx \frac{t_{k, i} - t_{k, i-1}}{6} \left( \|B'_k(t_{k, i-1})\| + 4 \|B'_k(t_{\text{mid}})\| + \|B'_k(t_{k, i})\| \right)$$
* **Monotonic Cumulative LUT:**
  $$S[m] = \sum_{j=1}^m \Delta s_j, \quad S[0] = 0, \quad S[\text{end}] = L$$
* **Inversion & Position Evaluation:**
  1. Phase Wrapping: $s^* = (v \cdot \Delta t) \pmod L$ (for `restart` loops) or ping-pong bounds (for `bounce` curves).
  2. Binary Search: Locates $S[j] \le s^* < S[j + 1]$.
  3. Linear Interpolation: $\alpha = \frac{s^* - S[j]}{S[j + 1] - S[j]}$, $t^* = t_j + \alpha(t_{j + 1} - t_j)$.
  4. Newton-Raphson Refinement:
     $$t_{\text{refined}} = t^* - \frac{s_k(t^*) - (s^* - S_{\text{seg\_start}})}{\|B'_k(t^*)\|}$$
  5. Position & Tangent: Evaluates $B_k(t_{\text{refined}})$ to ensure constant-velocity traversal in pixels/second.

---

### 2. Coordinate-to-Pitch Scale Quantizer
Standard computer graphics places $(0, 0)$ at top-left, while musical frequency increases upwards.

* **Vertical Inversion & Active Margin:**
  With a 32 px top/bottom breathing margin ($H_{\text{active}} = \max(1, H - 64)$), vertical pixel $y$ maps to normalized coordinate $u \in [0, 1]$:
  $$u = \text{clamp}\left(1 - \frac{y - 32}{H_{\text{active}}}, 0, 1\right)$$
* **3-Band Piecewise Non-Linear Frequency Scale ($110\text{–}300\text{–}2500\text{–}8000\text{ Hz}$):**
  Vertical canvas height is allocated logarithmically across three perceptual bands ($u_{\text{low}} = 0.22$, $u_{\text{high}} = 0.92$):
  * **Low Bass Foundation ($110\text{–}300\text{ Hz}$, 22% height, $u \in [0, 0.22)$):**
    $$f(u) = 110 \cdot \left(\frac{300}{110}\right)^{u / 0.22}$$
  * **High-Precision Melodic Mid-Band ($300\text{–}2500\text{ Hz}$, 70% height, $u \in [0.22, 0.92]$):**
    $$f(u) = 300 \cdot \left(\frac{2500}{300}\right)^{(u - 0.22) / 0.70}$$
  * **Upper Sparkle & Chimes ($2500\text{–}8000\text{ Hz}$, 8% height, $u \in (0.92, 1]$):**
    $$f(u) = 2500 \cdot \left(\frac{8000}{2500}\right)^{(u - 0.92) / 0.08}$$
* **Continuous Scale Degree Mapping:**
  With active root frequency $f_{\text{root}}$ and $K$-note modal intervals $I[0 \dots K-1]$:
  $$\text{semi} = 12 \log_2\left(\frac{f(u)}{f_{\text{root}}}\right) \implies d_{\text{cont}} = m \cdot K + i + \text{frac}$$
* **Discrete Snapping (Dotted / Roll Strokes):**
  $$k = \text{round}(d_{\text{cont}}), \quad m = \lfloor k / K \rfloor, \quad r = k \pmod K$$
  $$\Delta_{\text{semitones}} = 12m + I[r], \quad f = f_{\text{root}} \cdot 2^{\Delta_{\text{semitones}} / 12}$$
* **Dual-Bank Continuous Modal Pitch Interpolation (Solid Drones):**
  Let $k_1 = \lfloor d_{\text{cont}} \rfloor$, $k_2 = k_1 + 1$, and $\gamma = d_{\text{cont}} - k_1$. Adjacent modal pitches $f_1$ and $f_2$ are routed across alternating even/odd oscillator **Bank A** and **Bank B** with smoothstep equal-power crossfading:
  $$t = \text{clamp}\left(\frac{\gamma - 0.15}{0.70}, 0, 1\right), \quad \text{blend} = t^2(3 - 2t)$$
  $$g_1 = \cos\left(\frac{\pi}{2}\,\text{blend}\right), \quad g_2 = \sin\left(\frac{\pi}{2}\,\text{blend}\right)$$
  This produces seamless, resonant harmonic overlaps across scale steps and smooth microtonal glides along curves.
* **Per-Line Tone Fluctuation:**
  An individual slider $f \in [0, 1]$ introduces subtle multi-frequency wander for drone voices and hit-by-hit micro-tuning jitter for pulsed notes.

---

## Stroke Textures & 7 Color-Sound Inks

Seven expressive instrument palettes (**Indigo** Bowed Strings & Cello, **Amber** Acoustic Kalimba & Wood, **Spruce** Glass Organ & Flute, **Violet** Music Box & Bells, **Rose** Acoustic Harp & Koto, **Yellow** Solar Acid & Sub-Bass, **Onyx** 808 Drum Machine) combine with three traversal textures:

1. **Solid Drone Strokes:**
   * Continuous dual-bank / dual-oscillator drone voice with sub-oscillator.
   * Resonant low-pass filter dynamically modulated by curve curvature $\kappa$ (tighter bends open higher harmonic resonance).
   * Dual-bank modal crossfading, portamento glides, and per-stroke tone fluctuation.
2. **Dotted Chime Strokes:**
   * Plucked acoustic / bell voice triggered when the playhead crosses dot intervals along arc length.
   * Snapped to discrete modal scale degrees.
3. **Roll / Ratchet Strokes:**
   * Rapid rhythmic multi-trigger bursts / resonant percussion along arc length.

---

## Key Features

* **Studio Deck & Zen Canvas Views (`V`):** Switch between the full **Studio Deck** (Layers mixer, Docked Line Inspector, Master FX, and Scene Arranger) and **Zen Canvas** (distraction-free full-bleed canvas with a glass pill dock and contextual floating pill).
* **Scene Arranger & Crossfade Morphing:** Capture movements as Scenes and play sequences with configurable **Morph Duration** (`2s–25s`) and transition blend styles (**Lush Overlap**, **Reverb Wash**, **Linear**).
* **Assisted Drawing (`A`):** Automatically places **2–5 harmonizing companion lines** in key per drawing gesture, with **Same Ink** or **Mixed Instruments** ensemble pairing.
* **Re-draw Mode (`R` or `Option + Drag`):** Replace a selected line's geometry directly on the canvas while keeping its instrument, volume, effects, timing, and voicing settings intact.
* **Live Play ("Musical Wand", `L`):** Click and drag for real-time expressive sound trails that evaporate over configurable **Trail Life**, with dedicated **Live Reverb**, **Live Volume**, **Sustain Tail**, and **Free Glide / Pitch Lock**.
* **MP3 Export (192 kbps in-browser via `@breezystack/lamejs`):** Export compositions either through **Simulate Time Period** (`5–600s`, faster-than-realtime simulation) or **Live Record**.
* **URL Sharing & Health Check (`/api/track`, `/api/health`):** Persist shared scores via serverless `/api/track` (Upstash / Vercel KV with automatic in-memory fallback and `#score=` URL hash fallback) and inspect readiness via `/api/health`.

---

## Development & Usage

### Install Dependencies
```bash
npm install
```

### Available Scripts
```bash
npm run dev        # Start Vite development server
npm run typecheck  # Run strict TypeScript type-checking (tsc --noEmit)
npm test           # Run Vitest unit tests (vitest run)
npm run build      # Type-check and build production bundle (tsc && vite build)
npm run preview    # Preview the built production bundle locally
```

### Environment Variables (Optional)
See [`.env.example`](.env.example) for optional serverless configuration (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `ALLOWED_ORIGINS`). If KV/Redis variables are omitted, `/api/track` falls back to in-memory storage and `/api/health` reports `"kvConfigured": false`.
