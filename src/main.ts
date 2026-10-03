import './style.css';
import { ScaleQuantizer } from './audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from './audio/scales';
import { StrokeManager } from './engine/strokeManager';
import { CanvasRenderer } from './canvas/renderer';
import { InputHandler, InteractionMode, DrawShape } from './canvas/inputHandler';
import { StrokeStyle, TraversalMode, XAxisModulationMode, LoopQuantizeMode } from './engine/types';
import { INSTRUMENTS, DEFAULT_INSTRUMENT, getInstrument } from './audio/instruments';
import { TEMPLATES, buildTemplateStrokes } from './audio/templates';
import { soundEngine } from './audio/audioContext';
import { SplinePath, Point2D } from './math/types';

// DOM Elements
const canvasEl = document.getElementById('musicCanvas') as HTMLCanvasElement;
const templateSelect = document.getElementById('templateSelect') as HTMLSelectElement;
const toolModeButtons = document.querySelectorAll<HTMLButtonElement>('#toolModeControl .seg-btn');
const shapeButtons = document.querySelectorAll<HTMLButtonElement>('#shapeControl .seg-btn');
const snapPitchBtn = document.getElementById('snapPitchBtn') as HTMLButtonElement;
const swatchButtons = document.querySelectorAll<HTMLButtonElement>('#instrumentPalette .swatch-btn');
const xAxisSelect = document.getElementById('xAxisSelect') as HTMLSelectElement;
const quantizeSelect = document.getElementById('quantizeSelect') as HTMLSelectElement;
const traversalButtons = document.querySelectorAll<HTMLButtonElement>('#traversalControl .seg-btn');
const scaleSelect = document.getElementById('scaleSelect') as HTMLSelectElement;
const rootSelect = document.getElementById('rootSelect') as HTMLSelectElement;
const strokeModeButtons = document.querySelectorAll<HTMLButtonElement>('#strokeModeControl .seg-btn');
const bpmSlider = document.getElementById('bpmSlider') as HTMLInputElement;
const bpmVal = document.getElementById('bpmVal') as HTMLSpanElement;
const deadbandSlider = document.getElementById('deadbandSlider') as HTMLInputElement;
const deadbandVal = document.getElementById('deadbandVal') as HTMLSpanElement;
const trackActionsGroup = document.getElementById('trackActionsGroup') as HTMLDivElement;
const trackLabel = document.getElementById('trackLabel') as HTMLSpanElement;
const trackVolSlider = document.getElementById('trackVolSlider') as HTMLInputElement;
const trackVolVal = document.getElementById('trackVolVal') as HTMLSpanElement;
const waveSineBtn = document.getElementById('waveSineBtn') as HTMLButtonElement;
const waveAmpSlider = document.getElementById('waveAmpSlider') as HTMLInputElement;
const waveAmpVal = document.getElementById('waveAmpVal') as HTMLSpanElement;
const wavePeriodSlider = document.getElementById('wavePeriodSlider') as HTMLInputElement;
const wavePeriodVal = document.getElementById('wavePeriodVal') as HTMLSpanElement;
const muteBtn = document.getElementById('muteBtn') as HTMLButtonElement;
const soloBtn = document.getElementById('soloBtn') as HTMLButtonElement;
const deleteTrackBtn = document.getElementById('deleteTrackBtn') as HTMLButtonElement;
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
const statInstrument = document.getElementById('statInstrument') as HTMLSpanElement;
const statLoopSync = document.getElementById('statLoopSync') as HTMLSpanElement;
const statPitchSnap = document.getElementById('statPitchSnap') as HTMLSpanElement;
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
let currentInstrumentId: string = DEFAULT_INSTRUMENT.id;
let activeDrawingPoints: Point2D[] = [];

// Input Handling with Draw / Edit modes, straight bars, and pitch snapping
const inputHandler = new InputHandler(canvasEl, {
  strokeManager,
  getQuantizer: () => quantizer,
  onStrokeComplete: (path: SplinePath) => {
    audioUnlockPrompt.classList.add('hidden');

    strokeManager.addStroke(
      path,
      currentStyle,
      currentInstrumentId,
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
  onSelectStroke: () => {
    updateTrackActionsVisibility();
  },
});

// Tool Mode Switching (Draw vs Select/Move)
function setToolMode(mode: InteractionMode): void {
  inputHandler.setMode(mode);
  toolModeButtons.forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-mode') === mode);
  });
  statMode.textContent = mode === 'edit' ? 'Select Mode' : 'Draw Mode';
  updateTrackActionsVisibility();
}

toolModeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-mode') as InteractionMode;
    if (mode) setToolMode(mode);
  });
});

// Drawing Shape Switching (Curve vs Straight Note Bar)
shapeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    shapeButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const shape = btn.getAttribute('data-shape') as DrawShape;
    if (shape) {
      inputHandler.setDrawShape(shape);
    }
  });
});

// Magnetic Pitch Snap Toggle
snapPitchBtn.addEventListener('click', () => {
  const willSnap = !inputHandler.isPitchSnapped;
  inputHandler.setSnapPitch(willSnap);
  snapPitchBtn.classList.toggle('active', willSnap);
  snapPitchBtn.textContent = willSnap ? 'Snap ON' : 'Snap Off';
  statPitchSnap.textContent = willSnap ? 'Snap ON' : 'Snap Off';
  statPitchSnap.style.color = willSnap ? '#2563eb' : 'inherit';
});

// Starter Groove Template Loader
templateSelect.addEventListener('change', async () => {
  const tId = templateSelect.value;
  if (!tId) return;

  const template = TEMPLATES[tId];
  if (!template) return;

  if (!soundEngine.isReady) {
    await soundEngine.init();
    statAudio.textContent = 'Audio: Active';
    statAudio.classList.add('chip-ready');
  }

  audioUnlockPrompt.classList.add('hidden');

  // Update scale, root, and tempo to template recommendations
  if (SCALES[template.scaleId]) {
    quantizer.updateConfig({ scale: SCALES[template.scaleId] });
    scaleSelect.value = template.scaleId;
  }
  if (ROOT_NOTES[template.rootId]) {
    quantizer.updateConfig({ root: ROOT_NOTES[template.rootId] });
    rootSelect.value = template.rootId;
  }
  strokeManager.setBpm(template.bpm);
  bpmSlider.value = template.bpm.toString();
  bpmVal.textContent = `${template.bpm} BPM`;
  statTempo.textContent = `${template.bpm} BPM`;

  // Clear existing and load template strokes
  strokeManager.clearAll();
  const strokes = buildTemplateStrokes(tId, renderer.width, renderer.height, quantizer);

  for (const s of strokes) {
    strokeManager.addStroke(
      s.path,
      s.style,
      s.instrumentId,
      140,
      quantizer,
      renderer.height
    );
  }

  strokeManager.activateAudioVoices();
  updateStats();
});

// Color-Sound Instrument Swatch Selection
function selectInstrument(instrumentId: string): void {
  const inst = getInstrument(instrumentId);
  currentInstrumentId = inst.id;

  swatchButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-instrument') === inst.id);
  });

  statInstrument.textContent = `${inst.icon} ${inst.name}`;

  // In Edit Mode: if a stroke is selected, re-voice that stroke immediately!
  if (inputHandler.currentMode === 'edit' && strokeManager.selectedStrokeId) {
    strokeManager.revoiceStroke(strokeManager.selectedStrokeId, inst.id);
  }
}

swatchButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const instId = btn.getAttribute('data-instrument');
    if (instId) selectInstrument(instId);
  });
});

// X-Axis Modulation Mode
xAxisSelect.addEventListener('change', () => {
  const mode = xAxisSelect.value as XAxisModulationMode;
  strokeManager.setXAxisModulationMode(mode);
});

// Loop Measure Quantize
quantizeSelect.addEventListener('change', () => {
  const mode = quantizeSelect.value as LoopQuantizeMode;
  strokeManager.setLoopQuantizeMode(mode);
  const labels: Record<LoopQuantizeMode, string> = {
    '1bar': '1 Bar Sync',
    '2bars': '2 Bars Sync',
    '4bars': '4 Bars Sync',
    'freeform': 'Freeform',
  };
  statLoopSync.textContent = labels[mode] || 'Sync';
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
const DEFAULT_HELP = 'Hover over any setting for details • Space: Pause • ⌘Z: Undo • Shift: Straight Note • M: Mute • S: Solo • 1-6: Inks';
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

// Track Inspector Volume / Wave Reshape / Mute / Solo / Delete Controls
function updateTrackActionsVisibility(): void {
  const selectedId = strokeManager.selectedStrokeId;
  if (inputHandler.currentMode === 'edit' && selectedId) {
    trackActionsGroup.style.display = 'flex';
    const stroke = strokeManager.activeStrokes.find((s) => s.id === selectedId);
    if (stroke) {
      const inst = getInstrument(stroke.instrumentId);
      trackLabel.textContent = `${inst.name}`;
      const vol = typeof stroke.volume === 'number' ? stroke.volume : 1.0;
      trackVolSlider.value = Math.round(vol * 100).toString();
      trackVolVal.textContent = `${Math.round(vol * 100)}%`;

      // Wave parameters sync
      if (stroke.waveParams) {
        waveSineBtn.classList.toggle('active', stroke.waveParams.amplitude > 0);
        waveAmpSlider.value = stroke.waveParams.amplitude.toString();
        waveAmpVal.textContent = `${Math.round(stroke.waveParams.amplitude)}px`;
        wavePeriodSlider.value = stroke.waveParams.periods.toString();
        wavePeriodVal.textContent = `${stroke.waveParams.periods.toFixed(1)}x`;
      } else {
        waveSineBtn.classList.remove('active');
        waveAmpSlider.value = '0';
        waveAmpVal.textContent = '0px';
        wavePeriodSlider.value = '2';
        wavePeriodVal.textContent = '2.0x';
      }

      muteBtn.classList.toggle('active-mute', !!stroke.muted);
      muteBtn.textContent = stroke.muted ? 'Unmute' : 'Mute';
      soloBtn.classList.toggle('active-solo', !!stroke.soloed);
      soloBtn.textContent = stroke.soloed ? 'Unsolo' : 'Solo';
    }
  } else {
    trackActionsGroup.style.display = 'none';
  }
}

// Volume Slider Event Listeners
trackVolSlider.addEventListener('input', () => {
  if (strokeManager.selectedStrokeId) {
    const vol = parseFloat(trackVolSlider.value) / 100;
    trackVolVal.textContent = `${Math.round(vol * 100)}%`;
    strokeManager.setStrokeVolume(strokeManager.selectedStrokeId, vol, false);
  }
});

trackVolSlider.addEventListener('change', () => {
  if (strokeManager.selectedStrokeId) {
    const vol = parseFloat(trackVolSlider.value) / 100;
    strokeManager.setStrokeVolume(strokeManager.selectedStrokeId, vol, true);
  }
});

// Wave Restructuring Event Listeners
waveSineBtn.addEventListener('click', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (!selectedId) return;

  const stroke = strokeManager.activeStrokes.find((s) => s.id === selectedId);
  if (!stroke) return;

  const isCurrentlyWavy = stroke.waveParams && stroke.waveParams.amplitude > 0;
  const targetAmp = isCurrentlyWavy ? 0 : 35;
  const targetPeriods = stroke.waveParams ? stroke.waveParams.periods : 2.0;

  strokeManager.restructureStrokeWave(selectedId, targetAmp, targetPeriods, true);
  updateTrackActionsVisibility();
});

waveAmpSlider.addEventListener('input', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (selectedId) {
    const amp = parseFloat(waveAmpSlider.value);
    const periods = parseFloat(wavePeriodSlider.value);
    waveAmpVal.textContent = `${Math.round(amp)}px`;
    waveSineBtn.classList.toggle('active', amp > 0);
    strokeManager.restructureStrokeWave(selectedId, amp, periods, false);
  }
});

waveAmpSlider.addEventListener('change', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (selectedId) {
    const amp = parseFloat(waveAmpSlider.value);
    const periods = parseFloat(wavePeriodSlider.value);
    strokeManager.restructureStrokeWave(selectedId, amp, periods, true);
  }
});

wavePeriodSlider.addEventListener('input', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (selectedId) {
    const amp = parseFloat(waveAmpSlider.value);
    const periods = parseFloat(wavePeriodSlider.value);
    wavePeriodVal.textContent = `${periods.toFixed(1)}x`;
    strokeManager.restructureStrokeWave(selectedId, amp, periods, false);
  }
});

wavePeriodSlider.addEventListener('change', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (selectedId) {
    const amp = parseFloat(waveAmpSlider.value);
    const periods = parseFloat(wavePeriodSlider.value);
    strokeManager.restructureStrokeWave(selectedId, amp, periods, true);
  }
});

deleteTrackBtn.addEventListener('click', () => {
  if (strokeManager.selectedStrokeId) {
    strokeManager.deleteSelected();
    updateStats();
    updateTrackActionsVisibility();
  }
});

muteBtn.addEventListener('click', () => {
  if (strokeManager.selectedStrokeId) {
    strokeManager.toggleMute(strokeManager.selectedStrokeId);
    updateTrackActionsVisibility();
  }
});

soloBtn.addEventListener('click', () => {
  if (strokeManager.selectedStrokeId) {
    strokeManager.toggleSolo(strokeManager.selectedStrokeId);
    updateTrackActionsVisibility();
  }
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
  updateTrackActionsVisibility();
});

clearBtn.addEventListener('click', () => {
  strokeManager.clearAll();
  templateSelect.value = '';
  updateStats();
  updateTrackActionsVisibility();
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
    updateTrackActionsVisibility();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    strokeManager.redo();
    updateStats();
    updateTrackActionsVisibility();
    return;
  }

  // 3. Delete / Backspace: delete selected stroke
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (strokeManager.selectedStrokeId) {
      e.preventDefault();
      strokeManager.deleteSelected();
      updateStats();
      updateTrackActionsVisibility();
      return;
    }
  }

  // 4. Quick Mode toggles: D = Draw, V = Select/Edit
  if (e.key.toLowerCase() === 'd') {
    setToolMode('draw');
  } else if (e.key.toLowerCase() === 'v') {
    setToolMode('edit');
  }

  // 5. Mute / Solo shortcuts: M = Mute, S = Solo
  if (e.key.toLowerCase() === 'm' && strokeManager.selectedStrokeId) {
    strokeManager.toggleMute(strokeManager.selectedStrokeId);
    updateTrackActionsVisibility();
  } else if (e.key.toLowerCase() === 's' && strokeManager.selectedStrokeId) {
    strokeManager.toggleSolo(strokeManager.selectedStrokeId);
    updateTrackActionsVisibility();
  }

  // 6. Number Keys 1 - 6: Quick select instruments
  const instKeys = ['1', '2', '3', '4', '5', '6'];
  const instIds = Object.keys(INSTRUMENTS);
  const keyIdx = instKeys.indexOf(e.key);
  if (keyIdx !== -1 && instIds[keyIdx]) {
    selectInstrument(instIds[keyIdx]);
  }

  // 7. Volume adjustment for selected stroke: [ or Down = -5%, ] or Up = +5%
  if (strokeManager.selectedStrokeId && (e.key === '[' || e.key === ']' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const stroke = strokeManager.activeStrokes.find((s) => s.id === strokeManager.selectedStrokeId);
    if (stroke) {
      e.preventDefault();
      const currentVol = stroke.volume ?? 1.0;
      const delta = (e.key === ']' || e.key === 'ArrowUp') ? 0.05 : -0.05;
      const nextVol = Math.max(0, Math.min(1, Math.round((currentVol + delta) * 100) / 100));
      strokeManager.setStrokeVolume(stroke.id, nextVol, true);
      updateTrackActionsVisibility();
    }
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
  setTimeout(updateTrackActionsVisibility, 50);
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

  // 1. Update constant-velocity playheads, Y pitch, X stereo modulation, and measure progress
  strokeManager.update(dt, renderer.width, renderer.height, quantizer);

  // 2. Clear canvas to warm paper tone
  renderer.clear();

  // 3. Render modal scale guidelines (Root and 5th highlighted)
  renderer.drawGuidelines(quantizer.getGuidelines(renderer.height));

  // 4. Render 4-beat visual measure tracker along the top
  renderer.drawBeatTracker(strokeManager.measureProgress, strokeManager.measureBeatIndex);

  // 5. Render active strokes & playheads (grey out non-soloed tracks when solo is active)
  const hasSolo = strokeManager.hasSoloedStrokes;
  for (const stroke of strokeManager.activeStrokes) {
    renderer.drawStroke(stroke, hasSolo);
    renderer.drawPlayhead(stroke, nowMs, hasSolo);
  }

  // 6. Render user's active in-flight gesture (in Draw mode)
  if (inputHandler.currentMode === 'draw' && activeDrawingPoints.length > 1) {
    renderer.drawActiveGesture(activeDrawingPoints, getInstrument(currentInstrumentId).color);
  }

  requestAnimationFrame(animationLoop);
}

// Start
renderer.resize();
requestAnimationFrame(animationLoop);
