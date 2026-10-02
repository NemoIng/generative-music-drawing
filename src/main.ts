import './style.css';
import { ScaleQuantizer } from './audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from './audio/scales';
import { StrokeManager } from './engine/strokeManager';
import { CanvasRenderer } from './canvas/renderer';
import { InputHandler } from './canvas/inputHandler';
import { StrokeStyle } from './engine/types';
import { soundEngine } from './audio/audioContext';
import { SplinePath, Point2D } from './math/types';

// DOM Element References
const canvasEl = document.getElementById('musicCanvas') as HTMLCanvasElement;
const scaleSelect = document.getElementById('scaleSelect') as HTMLSelectElement;
const rootSelect = document.getElementById('rootSelect') as HTMLSelectElement;
const strokeModeButtons = document.querySelectorAll<HTMLButtonElement>('#strokeModeControl .segment');
const speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
const speedVal = document.getElementById('speedVal') as HTMLSpanElement;
const deadbandSlider = document.getElementById('deadbandSlider') as HTMLInputElement;
const deadbandVal = document.getElementById('deadbandVal') as HTMLSpanElement;
const playPauseBtn = document.getElementById('playPauseBtn') as HTMLButtonElement;
const playPauseIcon = document.getElementById('playPauseIcon') as HTMLSpanElement;
const playPauseText = document.getElementById('playPauseText') as HTMLSpanElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const infoBtn = document.getElementById('infoBtn') as HTMLButtonElement;
const infoModal = document.getElementById('infoModal') as HTMLDivElement;
const closeModalBtn = document.getElementById('closeModalBtn') as HTMLButtonElement;
const audioUnlockPrompt = document.getElementById('audioUnlockPrompt') as HTMLDivElement;
const statStrokes = document.getElementById('statStrokes') as HTMLDivElement;
const statAudio = document.getElementById('statAudio') as HTMLDivElement;

// Engine State
const quantizer = new ScaleQuantizer({
  scale: SCALES.dorian,
  root: ROOT_NOTES.D2,
  octaveSpan: 4,
  deadbandWidth: 0.25,
});

const strokeManager = new StrokeManager();
const renderer = new CanvasRenderer(canvasEl);

let currentStyle: StrokeStyle = 'solid';
let activeDrawingPoints: Point2D[] = [];

const STYLE_COLORS: Record<StrokeStyle, string> = {
  solid: '#00f2fe',
  dotted: '#ffb703',
  striped: '#f72585',
};

// Input Handling
const inputHandler = new InputHandler(canvasEl, {
  onStrokeComplete: (path: SplinePath) => {
    // Hide initial prompt on first stroke
    audioUnlockPrompt.classList.add('hidden');

    const color = STYLE_COLORS[currentStyle];
    strokeManager.addStroke(
      path,
      currentStyle,
      color,
      140,
      quantizer,
      renderer.height
    );

    // If audio engine just became ready, activate any pending voices
    strokeManager.activateAudioVoices();
    updateStats();
  },
  onDrawChange: (points: Point2D[]) => {
    activeDrawingPoints = points;
  },
});
void inputHandler;

// UI Event Listeners
scaleSelect.addEventListener('change', () => {
  const scale = SCALES[scaleSelect.value];
  if (scale) {
    quantizer.updateConfig({ scale });
  }
});

rootSelect.addEventListener('change', () => {
  const root = ROOT_NOTES[rootSelect.value];
  if (root) {
    quantizer.updateConfig({ root });
  }
});

strokeModeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    strokeModeButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const style = btn.getAttribute('data-style') as StrokeStyle;
    if (style) {
      currentStyle = style;
    }
  });
});

speedSlider.addEventListener('input', () => {
  const val = parseFloat(speedSlider.value);
  speedVal.textContent = `${val.toFixed(1)}x`;
  strokeManager.setVelocityMultiplier(val);
});

deadbandSlider.addEventListener('input', () => {
  const val = parseFloat(deadbandSlider.value);
  deadbandVal.textContent = val.toFixed(2);
  quantizer.updateConfig({ deadbandWidth: val });
});

playPauseBtn.addEventListener('click', () => {
  const isPaused = !strokeManager.paused;
  strokeManager.setPaused(isPaused);

  if (isPaused) {
    playPauseIcon.textContent = '▶';
    playPauseText.textContent = 'Play';
  } else {
    playPauseIcon.textContent = '⏸';
    playPauseText.textContent = 'Pause';
  }
});

clearBtn.addEventListener('click', () => {
  strokeManager.clearAll();
  updateStats();
});

infoBtn.addEventListener('click', () => {
  infoModal.classList.remove('hidden');
});

closeModalBtn.addEventListener('click', () => {
  infoModal.classList.add('hidden');
});

infoModal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
  infoModal.classList.add('hidden');
});

// Unlock audio on any document touch/click
window.addEventListener('pointerdown', async () => {
  if (!soundEngine.isReady) {
    await soundEngine.init();
    strokeManager.activateAudioVoices();
    statAudio.textContent = 'Audio: Active';
    statAudio.style.color = '#70a1ff';
    audioUnlockPrompt.classList.add('hidden');
  }
}, { once: false });

window.addEventListener('resize', () => {
  renderer.resize();
});

function updateStats(): void {
  statStrokes.textContent = `Strokes: ${strokeManager.activeStrokes.length}`;
}

// Main Animation & Render Loop
let lastTimeMs = performance.now();

function animationLoop(nowMs: number): void {
  const dt = Math.min(0.08, (nowMs - lastTimeMs) / 1000);
  lastTimeMs = nowMs;

  // 1. Update Engine (Constant Velocity & Pitch evaluation)
  strokeManager.update(dt, renderer.height, quantizer);

  // 2. Clear canvas
  renderer.clear();

  // 3. Render Pitch Grid Guidelines
  renderer.drawGuidelines(quantizer.getGuidelines(renderer.height));

  // 4. Render Active Strokes
  for (const stroke of strokeManager.activeStrokes) {
    renderer.drawStroke(stroke);
    renderer.drawPlayhead(stroke, nowMs);
  }

  // 5. Render In-Progress Drawing
  if (activeDrawingPoints.length > 1) {
    renderer.drawActiveGesture(activeDrawingPoints, STYLE_COLORS[currentStyle]);
  }

  requestAnimationFrame(animationLoop);
}

// Initial resize and start loop
renderer.resize();
requestAnimationFrame(animationLoop);
