import './style.css';
import { ScaleQuantizer } from './audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from './audio/scales';
import { StrokeManager } from './engine/strokeManager';
import { CanvasRenderer } from './canvas/renderer';
import { InputHandler, InteractionMode } from './canvas/inputHandler';
import { StrokeStyle, TraversalMode } from './engine/types';
import { SOUND_PALETTES, SoundPaletteId } from './audio/soundPalettes';
import { soundEngine } from './audio/audioContext';
import { SplinePath, Point2D } from './math/types';

// DOM Elements
const canvasEl = document.getElementById('musicCanvas') as HTMLCanvasElement;
const toolModeButtons = document.querySelectorAll<HTMLButtonElement>('#toolModeControl .seg-btn');
const paletteSelect = document.getElementById('paletteSelect') as HTMLSelectElement;
const traversalButtons = document.querySelectorAll<HTMLButtonElement>('#traversalControl .seg-btn');
const scaleSelect = document.getElementById('scaleSelect') as HTMLSelectElement;
const rootSelect = document.getElementById('rootSelect') as HTMLSelectElement;
const strokeModeButtons = document.querySelectorAll<HTMLButtonElement>('#strokeModeControl .seg-btn');
const bpmSlider = document.getElementById('bpmSlider') as HTMLInputElement;
const bpmVal = document.getElementById('bpmVal') as HTMLSpanElement;
const deadbandSlider = document.getElementById('deadbandSlider') as HTMLInputElement;
const deadbandVal = document.getElementById('deadbandVal') as HTMLSpanElement;
const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
const playPauseBtn = document.getElementById('playPauseBtn') as HTMLButtonElement;
const playPauseIcon = document.getElementById('playPauseIcon') as HTMLSpanElement;
const playPauseText = document.getElementById('playPauseText') as HTMLSpanElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const infoBtn = document.getElementById('infoBtn') as HTMLButtonElement;
const infoModal = document.getElementById('infoModal') as HTMLDivElement;
const closeModalBtn = document.getElementById('closeModalBtn') as HTMLButtonElement;
const audioUnlockPrompt = document.getElementById('audioUnlockPrompt') as HTMLDivElement;
const statStrokes = document.getElementById('statStrokes') as HTMLSpanElement;
const statMode = document.getElementById('statMode') as HTMLSpanElement;
const statTempo = document.getElementById('statTempo') as HTMLSpanElement;
const statPalette = document.getElementById('statPalette') as HTMLSpanElement;
const statAudio = document.getElementById('statAudio') as HTMLSpanElement;
const contextHelp = document.getElementById('contextHelp') as HTMLSpanElement;

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

// Refined natural ink color palette for off-white canvas
const STYLE_COLORS: Record<StrokeStyle, string> = {
  solid: '#1e293b',   // Deep slate indigo
  dotted: '#c2410c',  // Warm terracotta
  striped: '#0f766e', // Botanical spruce
};

// Input Handling with Draw / Edit modes
const inputHandler = new InputHandler(canvasEl, {
  strokeManager,
  onStrokeComplete: (path: SplinePath) => {
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

    strokeManager.activateAudioVoices();
    updateStats();
  },
  onDrawChange: (points: Point2D[]) => {
    activeDrawingPoints = points;
  },
});

// Tool Mode Switching (Draw vs Select/Move)
function setToolMode(mode: InteractionMode): void {
  inputHandler.setMode(mode);
  toolModeButtons.forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-mode') === mode);
  });
  statMode.textContent = mode === 'edit' ? 'Select / Move' : 'Draw Mode';
}

toolModeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-mode') as InteractionMode;
    if (mode) setToolMode(mode);
  });
});

// Sound Palette Selection
paletteSelect.addEventListener('change', () => {
  const pId = paletteSelect.value as SoundPaletteId;
  const palette = SOUND_PALETTES[pId];
  if (palette) {
    strokeManager.setSoundPalette(palette);
    statPalette.textContent = palette.name;
  }
});

// Traversal Mode Switching (Restart vs Ping-Pong)
traversalButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    traversalButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.getAttribute('data-traversal') as TraversalMode;
    if (mode) {
      strokeManager.setTraversalMode(mode);
    }
  });
});

// Contextual Hover Descriptions
const DEFAULT_HELP = 'Hover over any setting for details • Space: Pause • ⌘Z: Undo • V: Select/Move • D: Draw';
const tooltipElements = document.querySelectorAll<HTMLElement>('[data-tooltip]');

tooltipElements.forEach((el) => {
  el.addEventListener('mouseenter', () => {
    const text = el.getAttribute('data-tooltip');
    if (text && contextHelp) {
      contextHelp.textContent = text;
      contextHelp.style.color = '#1c1917';
    }
  });

  el.addEventListener('mouseleave', () => {
    if (contextHelp) {
      contextHelp.textContent = DEFAULT_HELP;
      contextHelp.style.color = 'var(--text-muted)';
    }
  });
});

// Musical Scale and Root Listeners
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

// BPM Tempo Slider
bpmSlider.addEventListener('input', () => {
  const bpm = parseInt(bpmSlider.value, 10);
  bpmVal.textContent = `${bpm} BPM`;
  strokeManager.setBpm(bpm);
  statTempo.textContent = `${bpm} BPM`;
});

// Deadband Snapping Width Slider
deadbandSlider.addEventListener('input', () => {
  const val = parseFloat(deadbandSlider.value);
  deadbandVal.textContent = val.toFixed(2);
  quantizer.updateConfig({ deadbandWidth: val });
});

// Play / Pause Toggle
function togglePlayPause(): void {
  const isPaused = !strokeManager.paused;
  strokeManager.setPaused(isPaused);

  if (isPaused) {
    playPauseIcon.textContent = '▶';
    playPauseText.textContent = 'Play';
  } else {
    playPauseIcon.textContent = '⏸';
    playPauseText.textContent = 'Pause';
  }
}

playPauseBtn.addEventListener('click', togglePlayPause);

// Undo Action
undoBtn.addEventListener('click', () => {
  strokeManager.undo();
  updateStats();
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

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e: KeyboardEvent) => {
  // Ignore shortcuts if focusing a select or modal text
  const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
  if (targetTag === 'input' || targetTag === 'select' || targetTag === 'textarea') {
    return;
  }

  // 1. Spacebar: Play / Pause
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlayPause();
    return;
  }

  // 2. Undo / Redo: Cmd+Z, Ctrl+Z, Cmd+Shift+Z, Ctrl+Y
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      strokeManager.redo();
    } else {
      strokeManager.undo();
    }
    updateStats();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    strokeManager.redo();
    updateStats();
    return;
  }

  // 3. Delete / Backspace: delete selected stroke
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (strokeManager.selectedStrokeId) {
      e.preventDefault();
      strokeManager.deleteSelected();
      updateStats();
      return;
    }
  }

  // 4. Quick Mode toggles: D = Draw, V = Select/Edit
  if (e.key.toLowerCase() === 'd') {
    setToolMode('draw');
  } else if (e.key.toLowerCase() === 'v') {
    setToolMode('edit');
  }
});

// Audio Unlock on First Pointer Down
window.addEventListener('pointerdown', async () => {
  if (!soundEngine.isReady) {
    await soundEngine.init();
    strokeManager.activateAudioVoices();
    statAudio.textContent = 'Audio: Active';
    statAudio.classList.add('chip-ready');
    audioUnlockPrompt.classList.add('hidden');
  }
}, { once: false });

window.addEventListener('resize', () => {
  renderer.resize();
});

function updateStats(): void {
  const count = strokeManager.activeStrokes.length;
  statStrokes.textContent = `${count} ${count === 1 ? 'stroke' : 'strokes'}`;
}

// Animation & Sequencer Loop
let lastTimeMs = performance.now();

function animationLoop(nowMs: number): void {
  const dt = Math.min(0.08, (nowMs - lastTimeMs) / 1000);
  lastTimeMs = nowMs;

  // 1. Update constant-velocity playheads and audio
  strokeManager.update(dt, renderer.height, quantizer);

  // 2. Clear canvas to warm paper tone
  renderer.clear();

  // 3. Render modal scale guidelines
  renderer.drawGuidelines(quantizer.getGuidelines(renderer.height));

  // 4. Render active strokes & playheads
  for (const stroke of strokeManager.activeStrokes) {
    renderer.drawStroke(stroke);
    renderer.drawPlayhead(stroke, nowMs);
  }

  // 5. Render user's active in-flight gesture (in Draw mode)
  if (inputHandler.currentMode === 'draw' && activeDrawingPoints.length > 1) {
    renderer.drawActiveGesture(activeDrawingPoints, STYLE_COLORS[currentStyle]);
  }

  requestAnimationFrame(animationLoop);
}

// Start
renderer.resize();
requestAnimationFrame(animationLoop);
