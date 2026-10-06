import './style.css';
import { ScaleQuantizer } from './audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from './audio/scales';
import { StrokeManager, getNextVersionName } from './engine/strokeManager';
import { CanvasRenderer } from './canvas/renderer';
import { InputHandler, DrawShape } from './canvas/inputHandler';
import { StrokeStyle, TraversalMode, HarmonizerMode, BreathingMode, XAxisModulationMode, LoopQuantizeMode, WaveShapeType, SavedComposition } from './engine/types';
import { INSTRUMENTS, DEFAULT_INSTRUMENT, getInstrument, getInstrumentColor } from './audio/instruments';
import { TEMPLATES, buildTemplateStrokes } from './audio/templates';
import { soundEngine } from './audio/audioContext';
import { SplinePath, Point2D } from './math/types';

// DOM Elements
const canvasEl = document.getElementById('musicCanvas') as HTMLCanvasElement;
const templateSelect = document.getElementById('templateSelect') as HTMLSelectElement;
const saveTemplateBtn = document.getElementById('saveTemplateBtn') as HTMLButtonElement;
const loadTemplateFileBtn = document.getElementById('loadTemplateFileBtn') as HTMLButtonElement;
const loadFileInput = document.getElementById('loadFileInput') as HTMLInputElement;
const savedTemplatesGroup = document.getElementById('savedTemplatesGroup') as HTMLOptGroupElement;
const savePresetModal = document.getElementById('savePresetModal') as HTMLElement;
const closeSavePresetModalBtn = document.getElementById('closeSavePresetModalBtn') as HTMLButtonElement;
const savePresetNameInput = document.getElementById('savePresetNameInput') as HTMLInputElement;
const overwritePresetBtn = document.getElementById('overwritePresetBtn') as HTMLButtonElement;
const saveNewVersionBtn = document.getElementById('saveNewVersionBtn') as HTMLButtonElement;
const saveCustomNameBtn = document.getElementById('saveCustomNameBtn') as HTMLButtonElement;
const saveExportJsonCheck = document.getElementById('saveExportJsonCheck') as HTMLInputElement;

let currentLoadedPresetName: string | null = 'Deep Cosmic Drone';
const shapeButtons = document.querySelectorAll<HTMLButtonElement>('#shapeControl .seg-btn');
const autoSmoothBtn = document.getElementById('autoSmoothBtn') as HTMLButtonElement;
const snapPitchBtn = document.getElementById('snapPitchBtn') as HTMLButtonElement;
const swatchButtons = document.querySelectorAll<HTMLButtonElement>('#instrumentPalette .swatch-btn');
const xAxisSelect = document.getElementById('xAxisSelect') as HTMLSelectElement;
const trackTraversalButtons = document.querySelectorAll<HTMLButtonElement>('#trackTraversalControl .seg-btn');
const scaleSelect = document.getElementById('scaleSelect') as HTMLSelectElement;
const rootSelect = document.getElementById('rootSelect') as HTMLSelectElement;
const generalSyncSelect = document.getElementById('generalSyncSelect') as HTMLSelectElement;
const appModeButtons = document.querySelectorAll<HTMLButtonElement>('#appModeControl .seg-btn');
const strokeModeButtons = document.querySelectorAll<HTMLButtonElement>('#strokeModeControl .seg-btn');
const bpmSlider = document.getElementById('bpmSlider') as HTMLInputElement;
const bpmVal = document.getElementById('bpmVal') as HTMLSpanElement;
const spaceSlider = document.getElementById('spaceSlider') as HTMLInputElement;
const spaceVal = document.getElementById('spaceVal') as HTMLSpanElement;
const octavesSlider = document.getElementById('octavesSlider') as HTMLInputElement;
const octavesVal = document.getElementById('octavesVal') as HTMLSpanElement;
const trackInspectorBar = document.getElementById('trackInspectorBar') as HTMLElement;
const trackBadgeDot = document.getElementById('trackBadgeDot') as HTMLElement;
const trackLabel = document.getElementById('trackLabel') as HTMLSpanElement;
const trackVolSlider = document.getElementById('trackVolSlider') as HTMLInputElement;
const trackVolVal = document.getElementById('trackVolVal') as HTMLSpanElement;
const trackReverbSlider = document.getElementById('trackReverbSlider') as HTMLInputElement | null;
const trackReverbVal = document.getElementById('trackReverbVal') as HTMLSpanElement | null;
const trackFluctuationSlider = document.getElementById('trackFluctuationSlider') as HTMLInputElement | null;
const trackFluctuationVal = document.getElementById('trackFluctuationVal') as HTMLSpanElement | null;
const waveShapeSelect = document.getElementById('waveShapeSelect') as HTMLSelectElement;
const waveSineBtn = document.getElementById('waveSineBtn') as HTMLButtonElement;
const waveAmpSlider = document.getElementById('waveAmpSlider') as HTMLInputElement;
const waveAmpVal = document.getElementById('waveAmpVal') as HTMLSpanElement;
const wavePeriodSlider = document.getElementById('wavePeriodSlider') as HTMLInputElement;
const wavePeriodVal = document.getElementById('wavePeriodVal') as HTMLSpanElement;
const muteBtn = document.getElementById('muteBtn') as HTMLButtonElement;
const soloBtn = document.getElementById('soloBtn') as HTMLButtonElement;
const duplicateTrackBtn = document.getElementById('duplicateTrackBtn') as HTMLButtonElement | null;
const deleteTrackBtn = document.getElementById('deleteTrackBtn') as HTMLButtonElement;
const deselectTrackBtn = document.getElementById('deselectTrackBtn') as HTMLButtonElement;
const trackTextureButtons = document.querySelectorAll<HTMLButtonElement>('#trackTextureControl .seg-btn');
const speedModeSpeedBtn = document.getElementById('speedModeSpeedBtn') as HTMLButtonElement | null;
const speedModeTimerBtn = document.getElementById('speedModeTimerBtn') as HTMLButtonElement | null;
const speedModeBarsBtn = document.getElementById('speedModeBarsBtn') as HTMLButtonElement | null;
const trackSpeedControls = document.getElementById('trackSpeedControls') as HTMLElement | null;
const trackBarsControls = document.getElementById('trackBarsControls') as HTMLElement | null;
const trackSpeedSlider = document.getElementById('trackSpeedSlider') as HTMLInputElement | null;
const trackSpeedVal = document.getElementById('trackSpeedVal') as HTMLSpanElement | null;
const speedPills = document.querySelectorAll<HTMLButtonElement>('#speedPresetPills .speed-pill');
const trackSyncSelect = document.getElementById('trackSyncSelect') as HTMLSelectElement | null;
const durationPills = document.querySelectorAll<HTMLButtonElement>('#durationPresetPills .speed-pill');
const resyncBtn = document.getElementById('resyncBtn') as HTMLButtonElement;
const randomizePlayheadsBtn = document.getElementById('randomizePlayheadsBtn') as HTMLButtonElement;
const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
const playPauseBtn = document.getElementById('playPauseBtn') as HTMLButtonElement;
const playPauseIcon = document.getElementById('playPauseIcon') as HTMLSpanElement;
const playPauseText = document.getElementById('playPauseText') as HTMLSpanElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const fullscreenBtn = document.getElementById('fullscreenBtn') as HTMLButtonElement;
const themeToggleBtn = document.getElementById('themeToggleBtn') as HTMLButtonElement;
const themeIcon = document.getElementById('themeIcon') as HTMLSpanElement;
const themeText = document.getElementById('themeText') as HTMLSpanElement;
const drawerToggleBtn = document.getElementById('drawerToggleBtn') as HTMLButtonElement;
const drawerToggleArrow = document.getElementById('drawerToggleArrow') as HTMLSpanElement;
const advancedDrawer = document.getElementById('advancedDrawer') as HTMLDivElement;
const drawerCloseBtn = document.getElementById('drawerCloseBtn') as HTMLButtonElement | null;
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
const trackDurationGroup = document.getElementById('trackDurationGroup') as HTMLElement;
const trackDurationSlider = document.getElementById('trackDurationSlider') as HTMLInputElement;
const trackDurationVal = document.getElementById('trackDurationVal') as HTMLSpanElement;
const defaultHarmonizerSelect = document.getElementById('defaultHarmonizerSelect') as HTMLSelectElement | null;
const trackHarmonizerControl = document.getElementById('trackHarmonizerControl') as HTMLElement | null;
const trackHarmonizerSelect = document.getElementById('trackHarmonizerSelect') as HTMLSelectElement | null;
const breathingSelect = document.getElementById('breathingSelect') as HTMLSelectElement | null;

// Pitch Navigator Controls
const pitchNavigator = document.getElementById('pitchNavigator') as HTMLElement;
const pitchScrollUpBtn = document.getElementById('pitchScrollUpBtn') as HTMLButtonElement;
const pitchScrollDownBtn = document.getElementById('pitchScrollDownBtn') as HTMLButtonElement;
const pitchResetBtn = document.getElementById('pitchResetBtn') as HTMLButtonElement;
const pitchTrack = document.getElementById('pitchTrack') as HTMLElement;
const pitchThumb = document.getElementById('pitchThumb') as HTMLElement;
const pitchThumbLabel = document.getElementById('pitchThumbLabel') as HTMLSpanElement;

// Live Performance Controls inside Drawer
const liveControlsGroup = document.getElementById('liveControlsGroup') as HTMLElement | null;
const liveReverbSlider = document.getElementById('liveReverbSlider') as HTMLInputElement | null;
const liveReverbVal = document.getElementById('liveReverbVal') as HTMLSpanElement | null;
const liveVolSlider = document.getElementById('liveVolSlider') as HTMLInputElement | null;
const liveVolVal = document.getElementById('liveVolVal') as HTMLSpanElement | null;
const liveSustainSlider = document.getElementById('liveSustainSlider') as HTMLInputElement | null;
const liveSustainVal = document.getElementById('liveSustainVal') as HTMLSpanElement | null;
const liveSnapBtn = document.getElementById('liveSnapBtn') as HTMLButtonElement | null;
const liveTrailSlider = document.getElementById('liveTrailSlider') as HTMLInputElement | null;
const liveTrailVal = document.getElementById('liveTrailVal') as HTMLSpanElement | null;
const drawOnlyControls = document.querySelectorAll<HTMLElement>('.draw-only-control');

// Engine State
const quantizer = new ScaleQuantizer({
  scale: SCALES.dorian,
  root: ROOT_NOTES.D3,
  octaveSpan: 4,
});
quantizer.setScrollEnabled(true);

const strokeManager = new StrokeManager();
const renderer = new CanvasRenderer(canvasEl);

let currentStyle: StrokeStyle = 'solid';
let currentInstrumentId: string = DEFAULT_INSTRUMENT.id;
let activeDrawingPoints: Point2D[] = [];

// Input Handling with Draw / Edit modes, straight bars, and pitch snapping
const inputHandler = new InputHandler(canvasEl, {
  strokeManager,
  getQuantizer: () => quantizer,
  getCurrentInstrument: () => currentInstrumentId,
  getCurrentStyle: () => currentStyle,
  getXAxisModulation: () => (xAxisSelect ? xAxisSelect.value : 'panAndTone'),
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
  onSelectStroke: (strokeId: string | null) => {
    updateTrackActionsVisibility();
    if (inputHandler.appMode === 'draw' && statMode) {
      statMode.textContent = strokeId ? 'Line Selected (Edit)' : 'Draw / Click to Select';
      statMode.style.color = strokeId ? '#2563eb' : 'inherit';
    }
  },
});

// Interaction Mode Switching (Draw Score vs Live Play with Dynamic Reverb & Controls)
function setAppMode(mode: 'draw' | 'live'): void {
  inputHandler.setAppMode(mode);
  appModeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-app-mode') === mode);
  });
  if (statMode) {
    const revPct = Math.round(inputHandler.liveReverbSend * 100);
    statMode.textContent = mode === 'live' ? `Live Play (${revPct}% Reverb)` : 'Draw / Click to Select';
    statMode.style.color = mode === 'live' ? '#2563eb' : 'inherit';
  }

  // In Live mode, highlight live performance controls
  if (liveControlsGroup) {
    liveControlsGroup.style.display = mode === 'live' ? 'flex' : 'none';
  }
  // Keep drawing controls accessible so user can adjust shape, smoothing, or grid defaults anytime
  drawOnlyControls.forEach((el) => {
    el.style.display = '';
  });
  updateTrackActionsVisibility();
}

appModeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-app-mode') as 'draw' | 'live';
    if (mode) setAppMode(mode);
  });
});

// Live Performance Controls Listeners
liveReverbSlider?.addEventListener('input', () => {
  const pct = parseInt(liveReverbSlider.value, 10);
  if (liveReverbVal) liveReverbVal.textContent = `${pct}%`;
  inputHandler.setLiveReverb(pct / 100);
  if (inputHandler.appMode === 'live' && statMode) {
    statMode.textContent = `Live Play (${pct}% Reverb)`;
  }
});

liveVolSlider?.addEventListener('input', () => {
  const pct = parseInt(liveVolSlider.value, 10);
  if (liveVolVal) liveVolVal.textContent = `${pct}%`;
  inputHandler.setLiveVolume(pct / 100);
});

liveSustainSlider?.addEventListener('input', () => {
  const sec = parseFloat(liveSustainSlider.value);
  if (liveSustainVal) liveSustainVal.textContent = `${sec.toFixed(2)}s`;
  inputHandler.setLiveReleaseTime(sec);
});

liveSnapBtn?.addEventListener('click', () => {
  const nextSnap = !inputHandler.isLiveSnapToScale;
  inputHandler.setLiveSnapToScale(nextSnap);
  liveSnapBtn.classList.toggle('active', nextSnap);
  liveSnapBtn.textContent = nextSnap ? 'Scale Lock ON' : 'Free Glide';
});

liveTrailSlider?.addEventListener('input', () => {
  const sec = parseFloat(liveTrailSlider.value);
  if (liveTrailVal) liveTrailVal.textContent = `${sec.toFixed(1)}s`;
  inputHandler.setLiveTrailLifetime(sec * 1000);
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

// Auto-Smooth Toggle
autoSmoothBtn.addEventListener('click', () => {
  const willSmooth = !inputHandler.isAutoSmooth;
  inputHandler.setAutoSmooth(willSmooth);
  autoSmoothBtn.classList.toggle('active', willSmooth);
  autoSmoothBtn.textContent = willSmooth ? 'Smooth On' : 'Smooth Off';
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

// Interactive Frequency Range Navigator (8-octave vertical scroll)
function updatePitchNavigator(): void {
  if (!pitchTrack || !pitchThumb || !pitchThumbLabel) return;
  const viewportH = renderer.height;
  if (viewportH <= 0) return;

  const worldH = quantizer.getWorldHeight(viewportH);
  const maxScroll = quantizer.getMaxScrollY(viewportH);
  const scrollY = quantizer.scrollY;

  const thumbHeightPct = Math.max(12, Math.min(100, (viewportH / worldH) * 100));
  const maxTopPct = 100 - thumbHeightPct;
  const topPct = maxScroll > 0 ? (scrollY / maxScroll) * maxTopPct : 0;

  pitchThumb.style.top = `${topPct}%`;
  pitchThumb.style.height = `${thumbHeightPct}%`;

  const info = quantizer.getFrequencyRangeInfo(viewportH, scrollY);
  pitchThumbLabel.textContent = `${info.bottomNote}–${info.topNote}`;
  pitchThumb.title = `Visible Window: ${info.bottomNote} (${Math.round(info.bottomFreq)} Hz) to ${info.topNote} (${Math.round(info.topFreq)} Hz). Drag or scroll to navigate frequency spectrum.`;

  if (strokeManager.selectedStrokeId) {
    updateTrackActionsVisibility();
  }
}

let navScrollTimeout: ReturnType<typeof setTimeout> | null = null;
function flashNavigatorOnScroll(): void {
  if (!pitchNavigator) return;
  pitchNavigator.classList.add('is-scrolling');
  if (navScrollTimeout) clearTimeout(navScrollTimeout);
  navScrollTimeout = setTimeout(() => {
    pitchNavigator.classList.remove('is-scrolling');
  }, 1200);
}

// 1. Mouse Wheel / Trackpad Scroll on canvas and navigator
canvasEl.addEventListener('wheel', (e: WheelEvent) => {
  e.preventDefault();
  quantizer.scrollBy(e.deltaY, renderer.height);
  updatePitchNavigator();
  flashNavigatorOnScroll();
}, { passive: false });

pitchNavigator?.addEventListener('wheel', (e: WheelEvent) => {
  e.preventDefault();
  quantizer.scrollBy(e.deltaY, renderer.height);
  updatePitchNavigator();
  flashNavigatorOnScroll();
}, { passive: false });

// 2. Navigator Buttons: Up (higher freq), Down (lower freq), Reset (mid register)
pitchScrollUpBtn?.addEventListener('click', () => {
  quantizer.scrollBy(-quantizer.getPxPerOctave(renderer.height), renderer.height);
  updatePitchNavigator();
  flashNavigatorOnScroll();
});

pitchScrollDownBtn?.addEventListener('click', () => {
  quantizer.scrollBy(quantizer.getPxPerOctave(renderer.height), renderer.height);
  updatePitchNavigator();
  flashNavigatorOnScroll();
});

pitchResetBtn?.addEventListener('click', () => {
  quantizer.resetScrollToDefault(renderer.height);
  updatePitchNavigator();
  flashNavigatorOnScroll();
});

// 3. Click directly on track to jump view
pitchTrack?.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.target === pitchThumb || pitchThumb.contains(e.target as Node)) return;
  const trackRect = pitchTrack.getBoundingClientRect();
  const clickY = e.clientY - trackRect.top;
  const clickRatio = Math.max(0, Math.min(1, clickY / trackRect.height));
  const targetScrollRatio = clickRatio - (renderer.height / quantizer.getWorldHeight(renderer.height)) / 2;
  const targetScrollY = targetScrollRatio * quantizer.getWorldHeight(renderer.height);
  quantizer.scrollY = quantizer.clampScrollY(targetScrollY, renderer.height);
  updatePitchNavigator();
  flashNavigatorOnScroll();
});

// 4. Drag Thumb
let isDraggingThumb = false;
let dragStartY = 0;
let dragStartScrollY = 0;

pitchThumb?.addEventListener('pointerdown', (e: PointerEvent) => {
  e.preventDefault();
  e.stopPropagation();
  isDraggingThumb = true;
  pitchNavigator?.classList.add('is-dragging');
  dragStartY = e.clientY;
  dragStartScrollY = quantizer.scrollY;
  pitchThumb.setPointerCapture(e.pointerId);
});

pitchThumb?.addEventListener('pointermove', (e: PointerEvent) => {
  if (!isDraggingThumb) return;
  const trackRect = pitchTrack.getBoundingClientRect();
  const thumbRect = pitchThumb.getBoundingClientRect();
  const travelPx = trackRect.height - thumbRect.height;
  if (travelPx <= 0) return;

  const deltaClientY = e.clientY - dragStartY;
  const deltaScroll = (deltaClientY / travelPx) * quantizer.getMaxScrollY(renderer.height);
  quantizer.scrollY = quantizer.clampScrollY(dragStartScrollY + deltaScroll, renderer.height);
  updatePitchNavigator();
});

const stopThumbDrag = (e: PointerEvent) => {
  if (isDraggingThumb) {
    isDraggingThumb = false;
    pitchNavigator?.classList.remove('is-dragging');
    try {
      pitchThumb.releasePointerCapture(e.pointerId);
    } catch {}
  }
};
pitchThumb?.addEventListener('pointerup', stopThumbDrag);
pitchThumb?.addEventListener('pointercancel', stopThumbDrag);

// Custom Saved Grooves Management
function getSavedCompositions(): Record<string, SavedComposition> {
  try {
    const raw = localStorage.getItem('harmonic_saved_grooves');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function refreshSavedTemplatesDropdown(): void {
  if (!savedTemplatesGroup) return;
  const saved = getSavedCompositions();
  const names = Object.keys(saved);
  savedTemplatesGroup.innerHTML = '';
  if (names.length === 0) {
    savedTemplatesGroup.style.display = 'none';
  } else {
    savedTemplatesGroup.style.display = '';
    names.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = `custom:${name}`;
      opt.textContent = name;
      savedTemplatesGroup.appendChild(opt);
    });
  }
}

async function loadComposition(comp: SavedComposition): Promise<void> {
  if (!soundEngine.isReady) {
    await soundEngine.init();
    statAudio.textContent = 'Audio: Active';
    statAudio.classList.add('chip-ready');
  }
  audioUnlockPrompt.classList.add('hidden');

  if (comp.scaleId && SCALES[comp.scaleId]) {
    quantizer.updateConfig({ scale: SCALES[comp.scaleId] });
    scaleSelect.value = comp.scaleId;
  }
  if (comp.rootId && ROOT_NOTES[comp.rootId]) {
    quantizer.updateConfig({ root: ROOT_NOTES[comp.rootId] });
    rootSelect.value = comp.rootId;
  }
  if (comp.bpm) {
    strokeManager.setBpm(comp.bpm);
    bpmSlider.value = comp.bpm.toString();
    bpmVal.textContent = `${comp.bpm} BPM`;
    statTempo.textContent = `${comp.bpm} BPM`;
  }
  if (comp.spaceReverb !== undefined) {
    const spacePct = Math.round(comp.spaceReverb * 100);
    spaceSlider.value = spacePct.toString();
    spaceVal.textContent = `${spacePct}%`;
    soundEngine.setReverbMix(comp.spaceReverb);
  }
  if (comp.octaveSpan !== undefined) {
    octavesSlider.value = comp.octaveSpan.toString();
    octavesVal.textContent = `${comp.octaveSpan} Oct`;
    quantizer.updateConfig({ octaveSpan: comp.octaveSpan });
  }
  if (comp.breathingMode && breathingSelect) {
    breathingSelect.value = comp.breathingMode;
    strokeManager.setBreathingMode(comp.breathingMode);
  }

  if (typeof comp.scrollY === 'number') {
    quantizer.scrollY = quantizer.clampScrollY(comp.scrollY, renderer.height);
  } else {
    // If older file didn't store scrollY, strokes are in [0, H] screen space.
    // Offset melodic strokes to defaultScrollY so they align with default middle register.
    const defaultScroll = quantizer.resetScrollToDefault(renderer.height);
    for (const s of comp.strokes) {
      if (s.instrumentId !== 'onyx') {
        for (const seg of s.path.segments) {
          seg.p0.y += defaultScroll;
          seg.p1.y += defaultScroll;
          seg.p2.y += defaultScroll;
          seg.p3.y += defaultScroll;
        }
      }
    }
  }
  updatePitchNavigator();

  strokeManager.importComposition(comp, quantizer, renderer.height);
  currentLoadedPresetName = comp.name || 'Custom Preset';
  updateStats();
  updateTrackActionsVisibility();
}

// Initial populate of saved templates
refreshSavedTemplatesDropdown();

function updateSaveModalButtonLabels(enteredName: string): void {
  const store = getSavedCompositions();
  const clean = enteredName.trim() || 'Preset';
  const nextVer = getNextVersionName(clean, store);

  if (overwritePresetBtn) {
    overwritePresetBtn.textContent = `Overwrite "${clean}"`;
  }
  if (saveNewVersionBtn) {
    saveNewVersionBtn.textContent = `Save as New Version ("${nextVer}")`;
  }
  if (saveCustomNameBtn) {
    saveCustomNameBtn.textContent = `Save with Entered Name`;
  }
}

function openSavePresetModal(): void {
  if (strokeManager.activeStrokes.length === 0) {
    alert('Draw or create some musical lines first before saving a preset.');
    return;
  }
  const activeName = currentLoadedPresetName || `Groove ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (savePresetNameInput) {
    savePresetNameInput.value = activeName;
  }
  updateSaveModalButtonLabels(activeName);
  if (savePresetModal) {
    savePresetModal.classList.remove('hidden');
    savePresetNameInput?.focus();
    savePresetNameInput?.select();
  }
}

function closeSavePresetModal(): void {
  if (savePresetModal) {
    savePresetModal.classList.add('hidden');
  }
}

function executeSavePreset(nameToSave: string, downloadJson: boolean): void {
  const cleanName = nameToSave.trim();
  if (!cleanName) return;

  const comp = strokeManager.exportComposition(cleanName, scaleSelect.value, rootSelect.value);
  comp.spaceReverb = parseFloat(spaceSlider.value) / 100;
  comp.octaveSpan = parseInt(octavesSlider.value, 10);
  comp.scrollY = quantizer.scrollY;

  // 1. Save to browser storage
  const saved = getSavedCompositions();
  saved[cleanName] = comp;
  localStorage.setItem('harmonic_saved_grooves', JSON.stringify(saved));
  refreshSavedTemplatesDropdown();

  templateSelect.value = `custom:${cleanName}`;
  currentLoadedPresetName = cleanName;

  // 2. Download JSON file if requested
  if (downloadJson) {
    const blob = new Blob([JSON.stringify(comp, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  closeSavePresetModal();
  statMode.textContent = `Preset Saved: ${cleanName}`;
}

// Save Preset Button opens modal
saveTemplateBtn?.addEventListener('click', () => {
  openSavePresetModal();
});

overwritePresetBtn?.addEventListener('click', () => {
  const targetName = savePresetNameInput?.value.trim() || currentLoadedPresetName || 'Preset';
  executeSavePreset(targetName, saveExportJsonCheck?.checked ?? false);
});

saveNewVersionBtn?.addEventListener('click', () => {
  const targetName = savePresetNameInput?.value.trim() || currentLoadedPresetName || 'Preset';
  const saved = getSavedCompositions();
  const nextVer = getNextVersionName(targetName, saved);
  executeSavePreset(nextVer, saveExportJsonCheck?.checked ?? false);
});

saveCustomNameBtn?.addEventListener('click', () => {
  const targetName = savePresetNameInput?.value.trim() || currentLoadedPresetName || 'Preset';
  executeSavePreset(targetName, saveExportJsonCheck?.checked ?? false);
});

closeSavePresetModalBtn?.addEventListener('click', closeSavePresetModal);
savePresetModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeSavePresetModal);

savePresetNameInput?.addEventListener('input', () => {
  updateSaveModalButtonLabels(savePresetNameInput.value);
});

savePresetNameInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    executeSavePreset(savePresetNameInput.value, saveExportJsonCheck?.checked ?? false);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSavePresetModal();
  }
});

// Load Groove File Button
loadTemplateFileBtn?.addEventListener('click', () => {
  loadFileInput?.click();
});

loadFileInput?.addEventListener('change', async () => {
  const file = loadFileInput.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const comp = JSON.parse(text) as SavedComposition;
    if (!comp.strokes || !Array.isArray(comp.strokes)) {
      alert('Invalid template file format: missing strokes array.');
      return;
    }
    const compName = comp.name || file.name.replace(/\.json$/i, '');
    comp.name = compName;
    const saved = getSavedCompositions();
    saved[compName] = comp;
    localStorage.setItem('harmonic_saved_grooves', JSON.stringify(saved));
    refreshSavedTemplatesDropdown();
    templateSelect.value = `custom:${compName}`;
    await loadComposition(comp);
  } catch (err) {
    console.error('Failed to parse groove template file:', err);
    alert('Could not parse template JSON file.');
  } finally {
    loadFileInput.value = '';
  }
});

// Starter Groove Template Loader
async function loadTemplate(tId: string, initAudio = true): Promise<void> {
  const template = TEMPLATES[tId];
  if (!template) return;

  currentLoadedPresetName = template.name;
  templateSelect.value = tId;

  if (initAudio && !soundEngine.isReady) {
    await soundEngine.init();
    statAudio.textContent = 'Audio: Active';
    statAudio.classList.add('chip-ready');
    audioUnlockPrompt.classList.add('hidden');
  }

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

  // Apply template effect settings
  if (template.spaceReverb !== undefined) {
    const spacePct = Math.round(template.spaceReverb * 100);
    spaceSlider.value = spacePct.toString();
    spaceVal.textContent = `${spacePct}%`;
    soundEngine.setReverbMix(template.spaceReverb);
  }
  if (template.octaveSpan !== undefined) {
    octavesSlider.value = template.octaveSpan.toString();
    octavesVal.textContent = `${template.octaveSpan} Oct`;
    quantizer.updateConfig({ octaveSpan: template.octaveSpan });
  }
  if (template.xAxisModulation) {
    xAxisSelect.value = template.xAxisModulation;
    strokeManager.setXAxisModulationMode(template.xAxisModulation);
  }
  if (template.breathingMode && breathingSelect) {
    breathingSelect.value = template.breathingMode;
    strokeManager.setBreathingMode(template.breathingMode);
  } else if (breathingSelect) {
    breathingSelect.value = 'gentle';
    strokeManager.setBreathingMode('gentle');
  }

  // Clear existing and reset scroll to default middle register
  strokeManager.clearAll();
  const defaultScroll = quantizer.resetScrollToDefault(renderer.height);
  updatePitchNavigator();

  const strokes = buildTemplateStrokes(tId, renderer.width, renderer.height, quantizer);

  for (const s of strokes) {
    if (s.instrumentId !== 'onyx') {
      for (const seg of s.path.segments) {
        seg.p0.y += defaultScroll;
        seg.p1.y += defaultScroll;
        seg.p2.y += defaultScroll;
        seg.p3.y += defaultScroll;
      }
    }
    strokeManager.addStroke(
      s.path,
      s.style,
      s.instrumentId,
      140,
      quantizer,
      renderer.height,
      s.volume ?? 1.0,
      s.loopQuantize,
      s.traversal,
      s.duration,
      s.speedMultiplier,
      s.speedMode,
      s.reverb,
      s.fluctuation,
      s.timingMode,
      s.harmonizer
    );
  }

  strokeManager.resyncAllPlayheads();
  if (soundEngine.isReady) {
    strokeManager.activateAudioVoices();
  }
  updateStats();
  updateTrackActionsVisibility();
}

templateSelect.addEventListener('change', async () => {
  const tId = templateSelect.value;
  if (!tId) return;

  // Check if it's a custom saved groove
  if (tId.startsWith('custom:')) {
    const name = tId.replace('custom:', '');
    currentLoadedPresetName = name;
    const saved = getSavedCompositions();
    if (saved[name]) {
      await loadComposition(saved[name]);
    }
    return;
  }

  await loadTemplate(tId, true);
});

// Color-Sound Instrument Swatch Selection
function selectInstrument(instrumentId: string): void {
  const inst = getInstrument(instrumentId);
  currentInstrumentId = inst.id;

  swatchButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-instrument') === inst.id);
  });

  statInstrument.textContent = `${inst.icon} ${inst.name}`;

  // When selecting drums, automatically switch to dotted texture
  if (inst.id === 'onyx') {
    currentStyle = 'dotted';
    strokeModeButtons.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-style') === 'dotted');
    });
  }

  // If a stroke is selected, re-voice that stroke immediately!
  if (strokeManager.selectedStrokeId) {
    strokeManager.revoiceStroke(strokeManager.selectedStrokeId, inst.id);
    if (inst.id === 'onyx') {
      strokeManager.setStrokeStyle(strokeManager.selectedStrokeId, 'dotted');
      updateTrackActionsVisibility();
    }
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

// Global Floating Tooltip Popover & Contextual Hover Descriptions
const DEFAULT_HELP = 'Hover over any setting for details • Space: Pause • ⌘Z: Undo • ⌘C/⌘V: Copy/Paste • R: Sync • Shift+R: Randomize • T: Dark/Light • M: Mute • S: Solo • 1-7: Inks';
const floatingTooltip = document.getElementById('floatingTooltip') as HTMLDivElement | null;

function showTooltip(el: HTMLElement) {
  const text = el.getAttribute('data-tooltip');
  if (!text) return;

  if (contextHelp) {
    contextHelp.textContent = text;
    contextHelp.style.color = 'var(--text-primary)';
  }

  if (floatingTooltip) {
    floatingTooltip.textContent = text;
    floatingTooltip.classList.add('visible');

    // Measure after setting text content
    const rect = el.getBoundingClientRect();
    const tipWidth = floatingTooltip.offsetWidth || 220;
    const tipHeight = floatingTooltip.offsetHeight || 36;

    // Center horizontally on target element, clamping within viewport margins
    let left = rect.left + rect.width / 2 - tipWidth / 2;
    left = Math.max(10, Math.min(window.innerWidth - tipWidth - 10, left));

    // Place below element by default; if overflowing bottom of viewport, flip above
    let top = rect.bottom + 6;
    if (top + tipHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - tipHeight - 6);
    }

    floatingTooltip.style.left = `${Math.round(left)}px`;
    floatingTooltip.style.top = `${Math.round(top)}px`;
  }
}

function hideTooltip() {
  if (contextHelp) {
    contextHelp.textContent = DEFAULT_HELP;
    contextHelp.style.color = 'var(--text-muted)';
  }
  if (floatingTooltip) {
    floatingTooltip.classList.remove('visible');
  }
}

// Delegated hover listener to seamlessly support all elements (including dynamically created ones)
document.addEventListener('mouseover', (e) => {
  const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null;
  if (target) {
    showTooltip(target);
  }
});

document.addEventListener('mouseout', (e) => {
  const target = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null;
  if (target) {
    const related = (e.relatedTarget as HTMLElement)?.closest?.('[data-tooltip]');
    if (!related || related !== target) {
      hideTooltip();
    }
  }
});

// Musical Scale and Root Listeners
scaleSelect.addEventListener('change', () => {
  const scale = SCALES[scaleSelect.value];
  if (scale) {
    quantizer.updateConfig({ scale });
    updatePitchNavigator();
  }
});

rootSelect.addEventListener('change', () => {
  const root = ROOT_NOTES[rootSelect.value];
  if (root) {
    quantizer.updateConfig({ root });
    updatePitchNavigator();
  }
});

strokeModeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    strokeModeButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const style = btn.getAttribute('data-style') as StrokeStyle;
    if (style) {
      currentStyle = style;
      // If a stroke is selected, update that stroke's texture immediately!
      if (strokeManager.selectedStrokeId) {
        strokeManager.setStrokeStyle(strokeManager.selectedStrokeId, style);
        updateTrackActionsVisibility();
      }
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

// Space (Master Reverb Room Depth) Slider
spaceSlider?.addEventListener('input', () => {
  const val = parseInt(spaceSlider.value, 10);
  spaceVal.textContent = `${val}%`;
  soundEngine.setReverbMix(val / 100);
});

// Canvas Pitch Octaves Range Slider (Rescaling melodic strokes so musical pitch and sound remain unchanged)
octavesSlider?.addEventListener('input', () => {
  const newOct = parseInt(octavesSlider.value, 10);
  const oldOct = quantizer.getConfig().octaveSpan;
  if (!newOct || !oldOct || newOct === oldOct) return;
  octavesVal.textContent = `${newOct} Oct`;

  const scaleFactor = oldOct / newOct;

  // 1. Rescale all melodic strokes Y coordinates so musical pitch stays identical
  strokeManager.scaleMelodicStrokesY(scaleFactor);

  // 2. Adjust active in-flight gesture points if any
  if (activeDrawingPoints.length > 0 && currentInstrumentId !== 'onyx') {
    for (const pt of activeDrawingPoints) {
      pt.y *= scaleFactor;
    }
  }

  // 3. Anchor viewport scroll around the screen center
  const viewportH = renderer.height;
  const centerScreenY = viewportH * 0.5;
  const oldWorldCenterY = quantizer.scrollY + centerScreenY;
  const newWorldCenterY = oldWorldCenterY * scaleFactor;

  // 4. Update quantizer octaveSpan
  quantizer.updateConfig({ octaveSpan: newOct });

  // 5. Update quantizer scrollY clamped to valid bounds
  quantizer.scrollY = quantizer.clampScrollY(newWorldCenterY - centerScreenY, viewportH);

  updatePitchNavigator();
  updateStats();
  if (strokeManager.selectedStrokeId) {
    updateTrackActionsVisibility();
  }
});

function formatDurationSec(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// Track Inspector Volume / Timing / Traversal / Wave Reshape / Mute / Solo / Delete Controls
function updateTrackActionsVisibility(): void {
  const selectedId = strokeManager.selectedStrokeId;
  if (selectedId) {
    statMode.textContent = 'Line Selected';
    trackInspectorBar.style.display = 'flex';
    trackInspectorBar.classList.remove('hidden');
    const stroke = strokeManager.activeStrokes.find((s) => s.id === selectedId);
    if (stroke) {
      // Dynamic inspector positioning:
      // When a line is drawn high on screen (screenMinY < 170px), flip inspector to bottom of canvas
      // so it never obscures the drawn notes.
      let minY = Infinity;
      for (const seg of stroke.path.segments) {
        minY = Math.min(minY, seg.p0.y, seg.p1.y, seg.p2.y, seg.p3.y);
      }
      const screenMinY = stroke.instrumentId === 'onyx' ? minY : quantizer.worldToScreenY(minY, renderer.height);

      // Always clear inline top/bottom so CSS handles smooth positioning
      trackInspectorBar.style.top = '';
      trackInspectorBar.style.bottom = '';

      if (isFinite(screenMinY) && screenMinY < 170) {
        trackInspectorBar.classList.add('inspector-bottom');
      } else {
        trackInspectorBar.classList.remove('inspector-bottom');
      }

      // If the right Controls popover is open, offset the inspector bar to remain centered in open canvas
      const isDrawerOpen = advancedDrawer && advancedDrawer.style.display !== 'none';
      if (isDrawerOpen) {
        trackInspectorBar.classList.add('inspector-with-drawer');
      } else {
        trackInspectorBar.classList.remove('inspector-with-drawer');
      }

      const inst = getInstrument(stroke.instrumentId);
      trackLabel.textContent = `${inst.name}`;
      const badgeColor = getInstrumentColor(inst, renderer.isDarkMode);
      trackBadgeDot.style.background = badgeColor;
      trackBadgeDot.style.boxShadow = `0 0 8px ${badgeColor}80`;

      const vol = typeof stroke.volume === 'number' ? stroke.volume : 1.0;
      trackVolSlider.value = Math.round(vol * 100).toString();
      trackVolVal.textContent = `${Math.round(vol * 100)}%`;

      const rev = typeof stroke.reverb === 'number' ? stroke.reverb : 0.4;
      if (trackReverbSlider && trackReverbVal) {
        trackReverbSlider.value = Math.round(rev * 100).toString();
        trackReverbVal.textContent = `${Math.round(rev * 100)}%`;
      }

      const fluc = typeof stroke.fluctuation === 'number' ? stroke.fluctuation : strokeManager.defaultStrokeFluctuation;
      if (trackFluctuationSlider && trackFluctuationVal) {
        trackFluctuationSlider.value = fluc.toFixed(2);
        trackFluctuationVal.textContent = fluc.toFixed(2);
      }

      // Wave parameters sync
      if (stroke.waveParams) {
        waveSineBtn.classList.toggle('active', stroke.waveParams.amplitude > 0);
        waveShapeSelect.value = stroke.waveParams.shapeType ?? 'sine';
        waveAmpSlider.value = stroke.waveParams.amplitude.toString();
        waveAmpVal.textContent = `${Math.round(stroke.waveParams.amplitude)}px`;
        wavePeriodSlider.value = stroke.waveParams.periods.toString();
        wavePeriodVal.textContent = `${stroke.waveParams.periods.toFixed(1)}x`;
      } else {
        waveSineBtn.classList.remove('active');
        waveShapeSelect.value = 'sine';
        waveAmpSlider.value = '0';
        waveAmpVal.textContent = '0px';
        wavePeriodSlider.value = '2';
        wavePeriodVal.textContent = '2.0x';
      }

      // Texture buttons sync
      trackTextureButtons.forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-track-style') === stroke.style);
      });

      // Speed / Timing Mode sync
      const strokeTiming = stroke.timingMode ?? (stroke.speedMode === 'timer' ? 'timer' : 'speed');
      const strokeSpeed = stroke.speedMultiplier ?? 1.0;
      const strokeDur = Math.round(stroke.duration ?? 30);

      speedModeSpeedBtn?.classList.toggle('active', strokeTiming === 'speed');
      speedModeTimerBtn?.classList.toggle('active', strokeTiming === 'timer');
      if (speedModeBarsBtn) speedModeBarsBtn.classList.toggle('active', stroke.speedMode === 'bars');

      if (trackSpeedControls) trackSpeedControls.style.display = strokeTiming === 'speed' ? 'flex' : 'none';
      if (trackDurationGroup) trackDurationGroup.style.display = strokeTiming === 'timer' ? 'flex' : 'none';
      if (trackBarsControls) trackBarsControls.style.display = stroke.speedMode === 'bars' ? 'block' : 'none';

      if (trackSpeedSlider && trackSpeedVal) {
        trackSpeedSlider.value = strokeSpeed.toFixed(2);
        trackSpeedVal.textContent = `${strokeSpeed.toFixed(2)}x`;
      }

      speedPills.forEach((pill) => {
        const pSpeed = parseFloat(pill.getAttribute('data-speed') || '1.0');
        pill.classList.toggle('active', strokeTiming === 'speed' && Math.abs(pSpeed - strokeSpeed) < 0.04);
      });

      if (trackDurationSlider && trackDurationVal) {
        trackDurationSlider.value = strokeDur.toString();
        trackDurationVal.textContent = formatDurationSec(strokeDur);
      }

      durationPills.forEach((pill) => {
        const pDur = parseInt(pill.getAttribute('data-duration') || '30', 10);
        pill.classList.toggle('active', strokeTiming === 'timer' && pDur === strokeDur);
      });

      if (trackSyncSelect) {
        trackSyncSelect.value = stroke.loopQuantize ?? '2bars';
      }

      // Traversal buttons sync (Restart vs Bounce)
      const currentTrav = (stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong') ? 'bounce' : 'restart';
      trackTraversalButtons.forEach((b) => {
        const tMode = b.getAttribute('data-track-traversal');
        b.classList.toggle('active', tMode === currentTrav);
      });

      // Harmonizer voicing sync (Onyx percussion strokes don't use diatonic voicings)
      if (trackHarmonizerControl && trackHarmonizerSelect) {
        if (stroke.instrumentId === 'onyx') {
          trackHarmonizerControl.style.display = 'none';
        } else {
          trackHarmonizerControl.style.display = 'flex';
          trackHarmonizerSelect.value = stroke.harmonizer ?? 'single';
        }
      }

      // Also sync top bar texture to reflect selected track
      strokeModeButtons.forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-style') === stroke.style);
      });

      // Update statLoopSync chip in status bar
      const timingLabel = strokeTiming === 'timer'
        ? `Timer ${formatDurationSec(strokeDur)}`
        : `${strokeSpeed.toFixed(2)}x Speed`;
      const travName = currentTrav === 'bounce' ? 'Bounce ⇄' : 'Restart ↻';
      statLoopSync.textContent = `${timingLabel} • ${travName}`;

      muteBtn.classList.toggle('active-mute', !!stroke.muted);
      muteBtn.textContent = stroke.muted ? 'Unmute' : 'Mute';
      soloBtn.classList.toggle('active-solo', !!stroke.soloed);
      soloBtn.textContent = stroke.soloed ? 'Unsolo' : 'Solo';
    }
  } else {
    statMode.textContent = inputHandler.appMode === 'live' ? 'Live Play' : 'Draw / Click to Select';
    trackInspectorBar.style.display = 'none';
    trackInspectorBar.classList.remove('inspector-bottom');
    trackInspectorBar.classList.remove('inspector-with-drawer');
    trackInspectorBar.classList.add('hidden');
    trackInspectorBar.style.top = '';
    trackInspectorBar.style.bottom = '';
    // Restore top bar to global current style
    strokeModeButtons.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-style') === currentStyle);
    });
    const defSpeedMode = strokeManager.defaultSpeedModeSetting;
    if (defSpeedMode === 'bars') {
      const defSync = strokeManager.defaultLoopQuantizeMode;
      const defSyncLabel = defSync === '1bar' ? '1 Bar'
        : (defSync === '2bars' ? '2 Bars'
        : (defSync === '4bars' ? '4 Bars'
        : (defSync === '8bars' ? '8 Bars' : 'Freeform')));
      statLoopSync.textContent = `Default: ${defSyncLabel}`;
    } else {
      statLoopSync.textContent = `Default: ${strokeManager.defaultSpeed.toFixed(2)}x Speed`;
    }
  }
}

deselectTrackBtn?.addEventListener('click', () => {
  strokeManager.selectStroke(null);
  updateTrackActionsVisibility();
});

// Track Inspector Texture Event Listeners
trackTextureButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const selectedId = strokeManager.selectedStrokeId;
    if (!selectedId) return;
    const style = btn.getAttribute('data-track-style') as StrokeStyle;
    if (style) {
      strokeManager.setStrokeStyle(selectedId, style);
      currentStyle = style;
      updateTrackActionsVisibility();
    }
  });
});

// Speed / Timer Mode Buttons (Speed vs Timer)
speedModeSpeedBtn?.addEventListener('click', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (!selectedId) return;
  strokeManager.setStrokeTimingMode(selectedId, 'speed', renderer.width);
  updateTrackActionsVisibility();
});

speedModeTimerBtn?.addEventListener('click', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (!selectedId) return;
  strokeManager.setStrokeTimingMode(selectedId, 'timer', renderer.width);
  updateTrackActionsVisibility();
});

speedModeBarsBtn?.addEventListener('click', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (!selectedId) return;
  strokeManager.setStrokeSpeedMode(selectedId, 'bars');
  updateTrackActionsVisibility();
});

// Track Inspector Speed Slider Event Listeners
trackSpeedSlider?.addEventListener('input', () => {
  if (strokeManager.selectedStrokeId) {
    const spd = parseFloat(trackSpeedSlider.value);
    if (trackSpeedVal) trackSpeedVal.textContent = `${spd.toFixed(2)}x`;
    strokeManager.setStrokeSpeed(strokeManager.selectedStrokeId, spd, false);
    speedPills.forEach((pill) => {
      const pSpeed = parseFloat(pill.getAttribute('data-speed') || '1.0');
      pill.classList.toggle('active', Math.abs(pSpeed - spd) < 0.04);
    });
  }
});

trackSpeedSlider?.addEventListener('change', () => {
  if (strokeManager.selectedStrokeId) {
    const spd = parseFloat(trackSpeedSlider.value);
    strokeManager.setStrokeSpeed(strokeManager.selectedStrokeId, spd, true);
    updateTrackActionsVisibility();
  }
});

// Speed Preset Pills Event Listeners (¼x, ½x, 1x, 2x)
speedPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const selectedId = strokeManager.selectedStrokeId;
    if (!selectedId) return;
    const spd = parseFloat(pill.getAttribute('data-speed') || '1.0');
    strokeManager.setStrokeSpeed(selectedId, spd, true);
    updateTrackActionsVisibility();
  });
});

// Duration Preset Pills (10s, 30s, 1m, 2m)
durationPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const selectedId = strokeManager.selectedStrokeId;
    if (!selectedId) return;
    const dur = parseInt(pill.getAttribute('data-duration') || '30', 10);
    strokeManager.setStrokeDuration(selectedId, dur, true);
    updateTrackActionsVisibility();
  });
});

// General Timing Default (Sets default speed/timer for future drawn lines)
generalSyncSelect?.addEventListener('change', () => {
  const val = generalSyncSelect.value;
  if (val.startsWith('speed:')) {
    const mult = parseFloat(val.replace('speed:', ''));
    strokeManager.setDefaultSpeedMode('speed');
    strokeManager.setDefaultSpeedMultiplier(mult);
    if (!strokeManager.selectedStrokeId) {
      statLoopSync.textContent = `Default: ${mult}x Speed`;
    }
  } else if (val.startsWith('timer:')) {
    const dur = parseInt(val.replace('timer:', ''), 10);
    strokeManager.setDefaultSpeedMode('timer');
    strokeManager.setDefaultDuration(dur);
    if (!strokeManager.selectedStrokeId) {
      statLoopSync.textContent = `Default: ${formatDurationSec(dur)} Timer`;
    }
  } else if (val.startsWith('bars:')) {
    const mode = val.replace('bars:', '') as LoopQuantizeMode;
    strokeManager.setDefaultSpeedMode('bars');
    strokeManager.setLoopQuantizeMode(mode);
    if (!strokeManager.selectedStrokeId) {
      const defSyncLabel = mode === '1bar' ? '1 Bar'
        : (mode === '2bars' ? '2 Bars'
        : (mode === '4bars' ? '4 Bars'
        : (mode === '8bars' ? '8 Bars' : 'Freeform')));
      statLoopSync.textContent = `Default: ${defSyncLabel}`;
    }
  }
});

// Track Inspector Loop Sync Event Listener
trackSyncSelect?.addEventListener('change', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (!selectedId || !trackSyncSelect) return;
  const mode = trackSyncSelect.value as LoopQuantizeMode;
  if (mode) {
    strokeManager.setStrokeLoopQuantize(selectedId, mode);
    updateTrackActionsVisibility();
  }
});

// Track Inspector Traversal Event Listeners
trackTraversalButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const selectedId = strokeManager.selectedStrokeId;
    if (!selectedId) return;
    const mode = btn.getAttribute('data-track-traversal') as TraversalMode;
    if (mode) {
      strokeManager.setStrokeTraversal(selectedId, mode);
      updateTrackActionsVisibility();
    }
  });
});

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

// Reverb Slider Event Listeners
trackReverbSlider?.addEventListener('input', () => {
  if (strokeManager.selectedStrokeId && trackReverbSlider && trackReverbVal) {
    const rev = parseFloat(trackReverbSlider.value) / 100;
    trackReverbVal.textContent = `${Math.round(rev * 100)}%`;
    strokeManager.setStrokeReverb(strokeManager.selectedStrokeId, rev, false);
  }
});

trackReverbSlider?.addEventListener('change', () => {
  if (strokeManager.selectedStrokeId && trackReverbSlider) {
    const rev = parseFloat(trackReverbSlider.value) / 100;
    strokeManager.setStrokeReverb(strokeManager.selectedStrokeId, rev, true);
  }
});

// Tone Fluctuation Slider Event Listeners
trackFluctuationSlider?.addEventListener('input', () => {
  if (strokeManager.selectedStrokeId && trackFluctuationSlider && trackFluctuationVal) {
    const fluc = parseFloat(trackFluctuationSlider.value);
    trackFluctuationVal.textContent = fluc.toFixed(2);
    strokeManager.setStrokeFluctuation(strokeManager.selectedStrokeId, fluc, false);
  }
});

trackFluctuationSlider?.addEventListener('change', () => {
  if (strokeManager.selectedStrokeId && trackFluctuationSlider) {
    const fluc = parseFloat(trackFluctuationSlider.value);
    strokeManager.setStrokeFluctuation(strokeManager.selectedStrokeId, fluc, true);
  }
});

// Duration Slider Event Listeners
trackDurationSlider?.addEventListener('input', () => {
  if (strokeManager.selectedStrokeId) {
    const dur = parseInt(trackDurationSlider.value, 10);
    trackDurationVal.textContent = formatDurationSec(dur);
    strokeManager.setStrokeDuration(strokeManager.selectedStrokeId, dur, false);
    durationPills.forEach((pill) => {
      const pDur = parseInt(pill.getAttribute('data-duration') || '30', 10);
      pill.classList.toggle('active', pDur === dur);
    });
  }
});

trackDurationSlider?.addEventListener('change', () => {
  if (strokeManager.selectedStrokeId) {
    const dur = parseInt(trackDurationSlider.value, 10);
    strokeManager.setStrokeDuration(strokeManager.selectedStrokeId, dur, true);
    updateTrackActionsVisibility();
  }
});

// Wave Restructuring Event Listeners
waveShapeSelect.addEventListener('change', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (!selectedId) return;

  const stroke = strokeManager.activeStrokes.find((s) => s.id === selectedId);
  if (!stroke) return;

  const shape = waveShapeSelect.value as WaveShapeType;
  const currentAmp = stroke.waveParams && stroke.waveParams.amplitude > 0 ? stroke.waveParams.amplitude : 35;
  const currentPeriods = stroke.waveParams ? stroke.waveParams.periods : 2.0;

  strokeManager.restructureStrokeWave(selectedId, currentAmp, currentPeriods, shape, true);
  updateTrackActionsVisibility();
});

waveSineBtn.addEventListener('click', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (!selectedId) return;

  const stroke = strokeManager.activeStrokes.find((s) => s.id === selectedId);
  if (!stroke) return;

  const shape = (waveShapeSelect.value as WaveShapeType) || 'sine';
  const isCurrentlyWavy = stroke.waveParams && stroke.waveParams.amplitude > 0;
  const targetAmp = isCurrentlyWavy ? 0 : 35;
  const targetPeriods = stroke.waveParams ? stroke.waveParams.periods : 2.0;

  strokeManager.restructureStrokeWave(selectedId, targetAmp, targetPeriods, shape, true);
  updateTrackActionsVisibility();
});

waveAmpSlider.addEventListener('input', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (selectedId) {
    const amp = parseFloat(waveAmpSlider.value);
    const periods = parseFloat(wavePeriodSlider.value);
    const shape = (waveShapeSelect.value as WaveShapeType) || 'sine';
    waveAmpVal.textContent = `${Math.round(amp)}px`;
    waveSineBtn.classList.toggle('active', amp > 0);
    strokeManager.restructureStrokeWave(selectedId, amp, periods, shape, false);
  }
});

waveAmpSlider.addEventListener('change', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (selectedId) {
    const amp = parseFloat(waveAmpSlider.value);
    const periods = parseFloat(wavePeriodSlider.value);
    const shape = (waveShapeSelect.value as WaveShapeType) || 'sine';
    strokeManager.restructureStrokeWave(selectedId, amp, periods, shape, true);
  }
});

wavePeriodSlider.addEventListener('input', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (selectedId) {
    const amp = parseFloat(waveAmpSlider.value);
    const periods = parseFloat(wavePeriodSlider.value);
    const shape = (waveShapeSelect.value as WaveShapeType) || 'sine';
    wavePeriodVal.textContent = `${periods.toFixed(1)}x`;
    strokeManager.restructureStrokeWave(selectedId, amp, periods, shape, false);
  }
});

wavePeriodSlider.addEventListener('change', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (selectedId) {
    const amp = parseFloat(waveAmpSlider.value);
    const periods = parseFloat(wavePeriodSlider.value);
    const shape = (waveShapeSelect.value as WaveShapeType) || 'sine';
    strokeManager.restructureStrokeWave(selectedId, amp, periods, shape, true);
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

duplicateTrackBtn?.addEventListener('click', () => {
  if (strokeManager.selectedStrokeId) {
    const newStroke = strokeManager.duplicateSelected(quantizer, renderer.height);
    if (newStroke) {
      if (soundEngine.isReady) {
        strokeManager.activateAudioVoices();
      }
      updateStats();
      updateTrackActionsVisibility();
    }
  }
});

// Play / Pause Toggle
function togglePlayPause(): void {
  const isPaused = !strokeManager.paused;
  strokeManager.setPaused(isPaused);

  if (isPaused) {
    if (playPauseIcon) playPauseIcon.textContent = '';
    playPauseText.textContent = 'Play';
  } else {
    if (playPauseIcon) playPauseIcon.textContent = '';
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

// Master Playhead Synchronization & Randomization
resyncBtn?.addEventListener('click', () => {
  strokeManager.resyncAllPlayheads();
});

randomizePlayheadsBtn?.addEventListener('click', () => {
  strokeManager.randomizeAllPlayheads();
});

// Dark / Light Theme Mode
function setTheme(dark: boolean): void {
  document.body.classList.toggle('dark-mode', dark);
  renderer.setDarkMode(dark);
  if (themeIcon) {
    themeIcon.textContent = '';
  }
  if (themeText) {
    themeText.textContent = dark ? 'Light' : 'Dark';
  }
  const onyxBtn = document.querySelector<HTMLButtonElement>('.swatch-btn[data-instrument="onyx"]');
  if (onyxBtn) {
    onyxBtn.style.setProperty('--swatch-c', dark ? '#f4f4f5' : '#18181b');
  }
  localStorage.setItem('harmonic_theme', dark ? 'dark' : 'light');
  updateTrackActionsVisibility();
}

// Initial theme state from localStorage
const savedTheme = localStorage.getItem('harmonic_theme');
if (savedTheme === 'dark') {
  setTheme(true);
} else {
  setTheme(false);
}

themeToggleBtn?.addEventListener('click', () => {
  const isDark = document.body.classList.contains('dark-mode');
  setTheme(!isDark);
});

// Controls Popover Sidebar Toggle (Anchored on Right Side - Zero Canvas Resize, Zero Overlap)
function setDrawerOpen(open: boolean): void {
  advancedDrawer.style.display = open ? 'block' : 'none';
  if (drawerToggleArrow) drawerToggleArrow.textContent = '';
  drawerToggleBtn?.classList.toggle('active', open);
  updateTrackActionsVisibility();
}

drawerToggleBtn?.addEventListener('click', (e: MouseEvent) => {
  e.stopPropagation();
  const isOpen = advancedDrawer.style.display !== 'none';
  setDrawerOpen(!isOpen);
});

drawerCloseBtn?.addEventListener('click', (e: MouseEvent) => {
  e.stopPropagation();
  setDrawerOpen(false);
});

// Click outside popover to close (standard popover behavior)
document.addEventListener('pointerdown', (e: PointerEvent) => {
  if (advancedDrawer && advancedDrawer.style.display !== 'none') {
    const target = e.target as HTMLElement | null;
    if (target && !advancedDrawer.contains(target) && !drawerToggleBtn?.contains(target)) {
      setDrawerOpen(false);
    }
  }
});

// Fullscreen Mode Toggle
function toggleFullscreen(): void {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

let prevCanvasWidth = 0;
let prevCanvasHeight = 0;

function handleResize(): void {
  const oldW = prevCanvasWidth;
  const oldH = prevCanvasHeight;
  renderer.resize();
  const newW = renderer.width;
  const newH = renderer.height;

  if (oldW > 0 && oldH > 0 && newW > 0 && newH > 0 && (oldW !== newW || oldH !== newH)) {
    const scaleX = newW / oldW;
    const scaleY = newH / oldH;
    strokeManager.scaleStrokes(scaleX, scaleY);
    if (quantizer.isScrollEnabled) {
      quantizer.scrollY *= scaleY;
    }
  }
  prevCanvasWidth = newW;
  prevCanvasHeight = newH;

  quantizer.clampScrollY(quantizer.scrollY, renderer.height);
  updatePitchNavigator();
  updateTrackActionsVisibility();
}

fullscreenBtn?.addEventListener('click', toggleFullscreen);

document.addEventListener('fullscreenchange', () => {
  handleResize();
  fullscreenBtn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
});

// Line Harmonizer Voicing Controls
defaultHarmonizerSelect?.addEventListener('change', () => {
  if (!defaultHarmonizerSelect) return;
  const mode = defaultHarmonizerSelect.value as HarmonizerMode;
  strokeManager.setDefaultStrokeHarmonizer(mode);
});

trackHarmonizerSelect?.addEventListener('change', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (!selectedId || !trackHarmonizerSelect) return;
  const mode = trackHarmonizerSelect.value as HarmonizerMode;
  strokeManager.setStrokeHarmonizer(selectedId, mode, true);
  updateStats();
});

// Organic Timbral Breathing Control (Option 3)
breathingSelect?.addEventListener('change', () => {
  if (!breathingSelect) return;
  const mode = breathingSelect.value as BreathingMode;
  strokeManager.setBreathingMode(mode);
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

  // Copy: Cmd+C, Ctrl+C
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
    if (strokeManager.selectedStrokeId) {
      e.preventDefault();
      strokeManager.copySelected();
      return;
    }
  }

  // Paste: Cmd+V, Ctrl+V
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
    if (strokeManager.hasClipboard()) {
      e.preventDefault();
      const newStroke = strokeManager.paste(quantizer, renderer.height);
      if (newStroke) {
        if (soundEngine.isReady) {
          strokeManager.activateAudioVoices();
        }
        updateStats();
        updateTrackActionsVisibility();
      }
      return;
    }
  }

  // Duplicate: Cmd+D, Ctrl+D
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
    if (strokeManager.selectedStrokeId) {
      e.preventDefault();
      const newStroke = strokeManager.duplicateSelected(quantizer, renderer.height);
      if (newStroke) {
        if (soundEngine.isReady) {
          strokeManager.activateAudioVoices();
        }
        updateStats();
        updateTrackActionsVisibility();
      }
      return;
    }
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

  // 4. Escape: Deselect active stroke
  if (e.key === 'Escape') {
    if (strokeManager.selectedStrokeId) {
      strokeManager.selectStroke(null);
      updateTrackActionsVisibility();
      return;
    }
  }

  // 5. Resync all playheads (R) / Randomize playheads (Shift+R)
  if (e.key.toLowerCase() === 'r') {
    e.preventDefault();
    if (e.shiftKey) {
      strokeManager.randomizeAllPlayheads();
    } else {
      strokeManager.resyncAllPlayheads();
    }
    return;
  }

  // Live Play mode toggle shortcut: P
  if (e.key.toLowerCase() === 'p') {
    e.preventDefault();
    const nextMode = inputHandler.appMode === 'draw' ? 'live' : 'draw';
    setAppMode(nextMode);
    return;
  }

  // 6. Fullscreen toggle shortcut: F
  if (e.key.toLowerCase() === 'f') {
    e.preventDefault();
    toggleFullscreen();
    return;
  }

  // 7. Theme toggle shortcut: T
  if (e.key.toLowerCase() === 't') {
    e.preventDefault();
    const isDark = document.body.classList.contains('dark-mode');
    setTheme(!isDark);
    return;
  }

  // Save Preset shortcut: Cmd+S / Ctrl+S
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    openSavePresetModal();
    return;
  }

  // 8. Mute / Solo shortcuts: M = Mute, S = Solo
  if (e.key.toLowerCase() === 'm' && strokeManager.selectedStrokeId) {
    strokeManager.toggleMute(strokeManager.selectedStrokeId);
    updateTrackActionsVisibility();
  } else if (e.key.toLowerCase() === 's' && strokeManager.selectedStrokeId) {
    strokeManager.toggleSolo(strokeManager.selectedStrokeId);
    updateTrackActionsVisibility();
  }

  // 9. Number Keys 1 - 7: Quick select instruments
  const instKeys = ['1', '2', '3', '4', '5', '6', '7'];
  const instIds = Object.keys(INSTRUMENTS);
  const keyIdx = instKeys.indexOf(e.key);
  if (keyIdx !== -1 && instIds[keyIdx]) {
    selectInstrument(instIds[keyIdx]);
  }

  // 10. Volume adjustment for selected stroke: [ or Down = -5%, ] or Up = +5%
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

  // 11. Frequency Field Scrolling: PageUp (Higher pitches), PageDown (Lower pitches), Home (Mid register)
  if (e.key === 'PageUp') {
    e.preventDefault();
    quantizer.scrollBy(-quantizer.getPxPerOctave(renderer.height), renderer.height);
    updatePitchNavigator();
    flashNavigatorOnScroll();
    return;
  }
  if (e.key === 'PageDown') {
    e.preventDefault();
    quantizer.scrollBy(quantizer.getPxPerOctave(renderer.height), renderer.height);
    updatePitchNavigator();
    flashNavigatorOnScroll();
    return;
  }
  if (e.key === 'Home') {
    e.preventDefault();
    quantizer.resetScrollToDefault(renderer.height);
    updatePitchNavigator();
    flashNavigatorOnScroll();
    return;
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

window.addEventListener('pointerup', () => {
  if (strokeManager.selectedStrokeId) {
    updateTrackActionsVisibility();
  }
});

window.addEventListener('resize', handleResize);

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

  // 3. Render modal scale guidelines (Root and 5th highlighted, chord tones accented)
  renderer.drawGuidelines(quantizer.getGuidelines(renderer.height));

  // 3b. Render drum tier zone guides when Onyx is active or selected
  const showDrumZones = currentInstrumentId === 'onyx' || strokeManager.activeStrokes.some((s) => s.instrumentId === 'onyx' && (s.selected || s.hovered));
  renderer.drawDrumZones(showDrumZones);

  // 4. Render 4-beat visual measure tracker along the top
  renderer.drawBeatTracker(strokeManager.measureProgress, strokeManager.measureBeatIndex);

  // 5. Render active strokes & playheads
  const hasSolo = strokeManager.hasSoloedStrokes;

  // 5a. Melodic strokes in world coordinate layer (scrolls with frequency pitch field)
  renderer.drawWorldLayer(quantizer.scrollY, () => {
    for (const stroke of strokeManager.activeStrokes) {
      if (stroke.instrumentId !== 'onyx') {
        renderer.drawStroke(stroke, hasSolo);
        renderer.drawPlayhead(stroke, nowMs, hasSolo);
      }
    }

    // Active in-flight gesture for melodic instruments
    if (activeDrawingPoints.length > 1 && currentInstrumentId !== 'onyx') {
      const gestureColor = getInstrumentColor(currentInstrumentId, renderer.isDarkMode);
      renderer.drawActiveGesture(activeDrawingPoints, gestureColor);
    }
  });

  // 5b. Drum strokes in fixed screen layer (locked to drum boundaries)
  for (const stroke of strokeManager.activeStrokes) {
    if (stroke.instrumentId === 'onyx') {
      renderer.drawStroke(stroke, hasSolo);
      renderer.drawPlayhead(stroke, nowMs, hasSolo);
    }
  }

  // Active in-flight gesture for drum machine (fixed to screen coordinates)
  if (activeDrawingPoints.length > 1 && currentInstrumentId === 'onyx') {
    const gestureColor = getInstrumentColor(currentInstrumentId, renderer.isDarkMode);
    renderer.drawActiveGesture(activeDrawingPoints, gestureColor);
  }

  // 5c. Disappearing live trail (Live Play mode with dynamic reverb, release & trail lifetime)
  if (inputHandler.liveTrail.length > 0) {
    inputHandler.pruneLiveTrail(nowMs, inputHandler.liveTrailLifetime);
    if (inputHandler.liveTrail.length > 0) {
      const liveColor = getInstrumentColor(currentInstrumentId, renderer.isDarkMode);
      renderer.drawDisappearingTrail(
        inputHandler.liveTrail,
        liveColor,
        nowMs,
        renderer.isDarkMode,
        inputHandler.liveTrailLifetime
      );
    }
  }

  requestAnimationFrame(animationLoop);
}

// Start
renderer.resize();
prevCanvasWidth = renderer.width;
prevCanvasHeight = renderer.height;
quantizer.resetScrollToDefault(renderer.height);
updatePitchNavigator();
loadTemplate('deepCosmicDrone', false);
updateStats();
updateTrackActionsVisibility();
requestAnimationFrame(animationLoop);
