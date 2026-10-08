import './style.css';
import { ScaleQuantizer } from './audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from './audio/scales';
import { StrokeManager, getNextVersionName } from './engine/strokeManager';
import { CanvasRenderer } from './canvas/renderer';
import { InputHandler, DrawShape } from './canvas/inputHandler';
import { DrawnStroke, StrokeStyle, TraversalMode, HarmonizerMode, BreathingMode, XAxisModulationMode, LoopQuantizeMode, WaveShapeType, SavedComposition, MorphCurveMode } from './engine/types';
import { INSTRUMENTS, DEFAULT_INSTRUMENT, getInstrument, getInstrumentColor } from './audio/instruments';
import { TEMPLATES, buildTemplateStrokes } from './audio/templates';
import { soundEngine, ReverbType } from './audio/audioContext';
import { SplinePath, Point2D } from './math/types';
import { LiveRecorder, simulateAndExportMp3, downloadBlob } from './audio/mp3Export';
import { ViewModeManager, ViewMode } from './ui/viewModes';
import { SceneManager, SceneData, SceneSequenceTickResult } from './engine/sceneManager';

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

// Record & MP3 Export Controls
const recordModalBtn = document.getElementById('recordModalBtn') as HTMLButtonElement | null;
const recordModal = document.getElementById('recordModal') as HTMLElement | null;
const closeRecordModalBtn = document.getElementById('closeRecordModalBtn') as HTMLButtonElement | null;
const tabSimulateBtn = document.getElementById('tabSimulateBtn') as HTMLButtonElement | null;
const tabLiveBtn = document.getElementById('tabLiveBtn') as HTMLButtonElement | null;
const tabSimulatePane = document.getElementById('tabSimulatePane') as HTMLElement | null;
const tabLivePane = document.getElementById('tabLivePane') as HTMLElement | null;
const simDurationInput = document.getElementById('simDurationInput') as HTMLInputElement | null;
const durationPillBtns = document.querySelectorAll<HTMLButtonElement>('.duration-pill-btn');
const simProgressWrap = document.getElementById('simProgressWrap') as HTMLElement | null;
const simProgressBar = document.getElementById('simProgressBar') as HTMLElement | null;
const simProgressStatus = document.getElementById('simProgressStatus') as HTMLElement | null;
const startSimulateBtn = document.getElementById('startSimulateBtn') as HTMLButtonElement | null;
const startLiveRecBtn = document.getElementById('startLiveRecBtn') as HTMLButtonElement | null;
const liveRecordingBanner = document.getElementById('liveRecordingBanner') as HTMLElement | null;
const liveRecTimer = document.getElementById('liveRecTimer') as HTMLElement | null;
const stopLiveRecBtn = document.getElementById('stopLiveRecBtn') as HTMLButtonElement | null;
const cancelLiveRecBtn = document.getElementById('cancelLiveRecBtn') as HTMLButtonElement | null;

let liveRecorder: LiveRecorder | null = null;
let isSimulating = false;

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
const appModeButtons = document.querySelectorAll<HTMLButtonElement>('[data-app-mode]');
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
const shortcutsBtn = document.getElementById('shortcutsBtn') as HTMLButtonElement | null;
const shortcutsModal = document.getElementById('shortcutsModal') as HTMLDivElement | null;
const closeShortcutsModalBtn = document.getElementById('closeShortcutsModalBtn') as HTMLButtonElement | null;
const shareLinkBtn = document.getElementById('shareLinkBtn') as HTMLButtonElement | null;
const audioUnlockPrompt = document.getElementById('audioUnlockPrompt') as HTMLDivElement | null;

export function dismissWelcomePrompt(): void {
  if (audioUnlockPrompt) {
    audioUnlockPrompt.classList.add('hidden');
    audioUnlockPrompt.style.display = 'none';
    audioUnlockPrompt.style.pointerEvents = 'none';
  }
}
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

// Layers Mixer & Presets Dirty State Controls
const layersToggleBtn = document.getElementById('layersToggleBtn') as HTMLButtonElement | null;
const layerCountBadge = document.getElementById('layerCountBadge') as HTMLSpanElement | null;
const layerMixerDrawer = document.getElementById('layerMixerDrawer') as HTMLElement | null;
const layerMixerList = document.getElementById('layerMixerList') as HTMLElement | null;
const mixerTrackCount = document.getElementById('mixerTrackCount') as HTMLSpanElement | null;
const mixerMuteAllBtn = document.getElementById('mixerMuteAllBtn') as HTMLButtonElement | null;
const mixerUnmuteAllBtn = document.getElementById('mixerUnmuteAllBtn') as HTMLButtonElement | null;
const mixerCloseBtn = document.getElementById('mixerCloseBtn') as HTMLButtonElement | null;
const dirtyIndicator = document.getElementById('dirtyIndicator') as HTMLSpanElement | null;
const quickSaveBtn = document.getElementById('quickSaveBtn') as HTMLButtonElement | null;

let isCompositionDirty = false;

function setCompositionDirty(dirty: boolean): void {
  isCompositionDirty = dirty;
  if (dirtyIndicator) {
    dirtyIndicator.classList.toggle('is-visible', dirty);
    dirtyIndicator.style.opacity = dirty ? '1' : '0';
    dirtyIndicator.style.visibility = dirty ? 'visible' : 'hidden';
    dirtyIndicator.style.display = 'inline-flex';
  }
  const baseTitle = 'Harmonic Geometry • Generative Music Drawing';
  document.title = dirty ? `• ${baseTitle}` : baseTitle;
}

function formatDurationSec(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function applyGeneralSync(val: string): void {
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
}

// Pitch Navigator Controls
const pitchNavigator = document.getElementById('pitchNavigator') as HTMLElement;
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

// View Architecture Elements (Studio Deck, Zen Canvas, Scene Arranger)
const appContainerEl = document.getElementById('app') as HTMLElement | null;
const topBarEl = document.querySelector('.top-bar') as HTMLElement | null;
const bottomBarEl = document.querySelector('.bottom-bar') as HTMLElement | null;
const studioDeckEl = document.getElementById('studioDeck') as HTMLElement | null;
const zenPillDockEl = document.getElementById('zenPillDock') as HTMLElement | null;
const zenContextPillEl = document.getElementById('zenContextPill') as HTMLElement | null;

// Studio Deck Elements
const studioTabBtnMixer = document.getElementById('studioTabBtnMixer') as HTMLButtonElement | null;
const studioTabBtnMaster = document.getElementById('studioTabBtnMaster') as HTMLButtonElement | null;
const studioTabBtnScenes = document.getElementById('studioTabBtnScenes') as HTMLButtonElement | null;
const studioTabMixer = document.getElementById('studioTabMixer') as HTMLElement | null;
const studioTabMaster = document.getElementById('studioTabMaster') as HTMLElement | null;
const studioTabScenes = document.getElementById('studioTabScenes') as HTMLElement | null;
const studioMixerList = document.getElementById('studioMixerList') as HTMLElement | null;
const studioLayerCount = document.getElementById('studioLayerCount') as HTMLSpanElement | null;
const studioMuteAllBtn = document.getElementById('studioMuteAllBtn') as HTMLButtonElement | null;
const studioUnmuteAllBtn = document.getElementById('studioUnmuteAllBtn') as HTMLButtonElement | null;

// Studio Docked Inspector
const studioDockedInspector = document.getElementById('studioDockedInspector') as HTMLElement | null;
const dockedInspectorToggleBtn = document.getElementById('dockedInspectorToggleBtn') as HTMLButtonElement | null;
const studioBadgeDot = document.getElementById('dockedBadgeDot') as HTMLElement | null;
const studioInspectorLabel = document.getElementById('dockedInspectorLabel') as HTMLElement | null;
const studioInspectorSub = document.getElementById('dockedInspectorSub') as HTMLElement | null;
const studioInspectorContent = document.getElementById('dockedInspectorContent') as HTMLElement | null;
const studioVoicingSelect = document.getElementById('studioVoicingSelect') as HTMLSelectElement | null;
const studioTimingToggle = document.getElementById('studioTimingToggle') as HTMLElement | null;
const studioTimingSlider = document.getElementById('studioTimingSlider') as HTMLInputElement | null;
const studioTimingVal = document.getElementById('studioTimingVal') as HTMLSpanElement | null;
const studioTraversalSwitch = document.getElementById('studioTraversalSwitch') as HTMLElement | null;
const studioWaveShapeSelect = document.getElementById('studioWaveShapeSelect') as HTMLSelectElement | null;
const studioWaveSineBtn = document.getElementById('studioWaveSineBtn') as HTMLButtonElement | null;
const studioWaveAmpSlider = document.getElementById('studioWaveAmpSlider') as HTMLInputElement | null;
const studioWaveAmpVal = document.getElementById('studioWaveAmpVal') as HTMLSpanElement | null;
const studioDupTrackBtn = document.getElementById('studioDupTrackBtn') as HTMLButtonElement | null;
const studioDelTrackBtn = document.getElementById('studioDelTrackBtn') as HTMLButtonElement | null;
const studioDeselectTrackBtn = document.getElementById('studioDeselectTrackBtn') as HTMLButtonElement | null;
const studioTimingModeLabel = document.getElementById('studioTimingModeLabel') as HTMLElement | null;

// Minimalist Running Sequence HUD
const seqMiniIndicator = document.getElementById('seqMiniIndicator') as HTMLElement | null;
const seqMiniName = document.getElementById('seqMiniName') as HTMLElement | null;
const seqMiniState = document.getElementById('seqMiniState') as HTMLElement | null;
const seqMiniProgressText = document.getElementById('seqMiniProgressText') as HTMLElement | null;
const seqMiniBarFill = document.getElementById('seqMiniBarFill') as HTMLElement | null;

// Studio Master Controls
const studioMasterBpmSlider = document.getElementById('studioMasterBpmSlider') as HTMLInputElement | null;
const studioMasterBpmVal = document.getElementById('studioMasterBpmVal') as HTMLSpanElement | null;
const studioMasterReverbSlider = document.getElementById('studioMasterReverbSlider') as HTMLInputElement | null;
const studioMasterReverbVal = document.getElementById('studioMasterReverbVal') as HTMLSpanElement | null;
const studioReverbTypeSelect = document.getElementById('studioReverbTypeSelect') as HTMLSelectElement | null;
const studioStereoWidthSlider = document.getElementById('studioStereoWidthSlider') as HTMLInputElement | null;
const studioStereoWidthVal = document.getElementById('studioStereoWidthVal') as HTMLSpanElement | null;
const studioTapeWarmthSlider = document.getElementById('studioTapeWarmthSlider') as HTMLInputElement | null;
const studioTapeWarmthVal = document.getElementById('studioTapeWarmthVal') as HTMLSpanElement | null;
const studioDuckingSlider = document.getElementById('studioDuckingSlider') as HTMLInputElement | null;
const studioDuckingVal = document.getElementById('studioDuckingVal') as HTMLSpanElement | null;
const studioScaleSelect = document.getElementById('studioScaleSelect') as HTMLSelectElement | null;
const studioRootSelect = document.getElementById('studioRootSelect') as HTMLSelectElement | null;
const studioXAxisSelect = document.getElementById('studioXAxisSelect') as HTMLSelectElement | null;
const studioSyncBtn = document.getElementById('studioSyncBtn') as HTMLButtonElement | null;
const studioRandomizeBtn = document.getElementById('studioRandomizeBtn') as HTMLButtonElement | null;

// Controls Drawer Reverb & Dynamics Controls
const reverbTypeSelect = document.getElementById('reverbTypeSelect') as HTMLSelectElement | null;
const stereoWidthSlider = document.getElementById('stereoWidthSlider') as HTMLInputElement | null;
const stereoWidthVal = document.getElementById('stereoWidthVal') as HTMLSpanElement | null;
const tapeWarmthSlider = document.getElementById('tapeWarmthSlider') as HTMLInputElement | null;
const tapeWarmthVal = document.getElementById('tapeWarmthVal') as HTMLSpanElement | null;
const duckingSlider = document.getElementById('duckingSlider') as HTMLInputElement | null;
const duckingVal = document.getElementById('duckingVal') as HTMLSpanElement | null;

// Zen Mode Elements
const zenPlayPauseBtn = document.getElementById('zenPlayPauseBtn') as HTMLButtonElement | null;
const zenPlayPauseText = document.getElementById('zenPlayPauseText') as HTMLSpanElement | null;
const zenSyncBtn = document.getElementById('zenSyncBtn') as HTMLButtonElement | null;
const zenSwatches = document.getElementById('zenSwatches') as HTMLElement | null;
const zenUndoBtn = document.getElementById('zenUndoBtn') as HTMLButtonElement | null;
const zenClearBtn = document.getElementById('zenClearBtn') as HTMLButtonElement | null;

// Zen Contextual Pill
const zenContextDot = document.getElementById('zenContextDot') as HTMLElement | null;
const zenContextName = document.getElementById('zenContextName') as HTMLElement | null;
const zenContextVolSlider = document.getElementById('zenContextVolSlider') as HTMLInputElement | null;
const zenContextMuteBtn = document.getElementById('zenContextMuteBtn') as HTMLButtonElement | null;
const zenContextSoloBtn = document.getElementById('zenContextSoloBtn') as HTMLButtonElement | null;
const zenContextTravBtn = document.getElementById('zenContextTravBtn') as HTMLButtonElement | null;
const zenContextCloseBtn = document.getElementById('zenContextCloseBtn') as HTMLButtonElement | null;

// Scene Arranger Elements
const scenePlaySeqBtn = document.getElementById('scenePlaySeqBtn') as HTMLButtonElement | null;
const sceneSeqPlayText = document.getElementById('sceneSeqPlayText') as HTMLSpanElement | null;
const sceneMorphSlider = document.getElementById('sceneMorphSlider') as HTMLInputElement | null;
const sceneMorphVal = document.getElementById('sceneMorphVal') as HTMLSpanElement | null;
const sceneMorphCurveSelect = document.getElementById('sceneMorphCurveSelect') as HTMLSelectElement | null;
const sceneMorphBlendButtons = document.querySelectorAll<HTMLButtonElement>('#sceneMorphBlendSwitch .seg-btn');
const sceneAddBtn = document.getElementById('sceneAddBtn') as HTMLButtonElement | null;
const sceneDupBtn = document.getElementById('sceneDupBtn') as HTMLButtonElement | null;
const sceneDelBtn = document.getElementById('sceneDelBtn') as HTMLButtonElement | null;
const sceneCardsList = document.getElementById('sceneCardsList') as HTMLElement | null;

// Engine State
const quantizer = new ScaleQuantizer({
  scale: SCALES.dorian,
  root: ROOT_NOTES.D3,
  octaveSpan: 4,
});
quantizer.setScrollEnabled(true);

const strokeManager = new StrokeManager();
const renderer = new CanvasRenderer(canvasEl);

let prevCanvasWidth = 0;
let prevCanvasHeight = 0;

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
  onPointerDown: () => {
    dismissWelcomePrompt();
  },
  onStrokeComplete: (path: SplinePath) => {
    dismissWelcomePrompt();

    strokeManager.addStroke(
      path,
      currentStyle,
      currentInstrumentId,
      140,
      quantizer,
      renderer.height
    );

    strokeManager.activateAudioVoices();
    syncCompositionState();
  },
  onDrawChange: (points: Point2D[]) => {
    activeDrawingPoints = points;
  },
  onSelectStroke: (strokeId: string | null) => {
    if (strokeId && studioTabBtnMaster?.classList.contains('active')) {
      switchStudioDeckTab('mixer');
    }
    updateTrackActionsVisibility();
    updateMixerSelection();
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

// Frequency Register Smooth Inertial Scrolling Engine
let targetScrollY = quantizer.scrollY;
let isScrollAnimating = false;

function smoothScrollBy(deltaY: number): void {
  const maxScroll = quantizer.getMaxScrollY(renderer.height);
  targetScrollY = Math.max(0, Math.min(maxScroll, targetScrollY + deltaY));
  isScrollAnimating = true;
  flashNavigatorOnScroll();
}

function smoothScrollTo(targetY: number): void {
  const maxScroll = quantizer.getMaxScrollY(renderer.height);
  targetScrollY = Math.max(0, Math.min(maxScroll, targetY));
  isScrollAnimating = true;
  flashNavigatorOnScroll();
}

// 1. Mouse Wheel / Trackpad Scroll with High-Frequency Directional Filtering
canvasEl.addEventListener('wheel', (e: WheelEvent) => {
  e.preventDefault();
  // Filter out pure horizontal swipes (e.g. back navigation gesture)
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
    return;
  }
  smoothScrollBy(e.deltaY);
}, { passive: false });

pitchNavigator?.addEventListener('wheel', (e: WheelEvent) => {
  e.preventDefault();
  smoothScrollBy(e.deltaY);
}, { passive: false });

// 2. Click directly on track to jump view with smooth glide
pitchTrack?.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.target === pitchThumb || pitchThumb.contains(e.target as Node)) return;
  const trackRect = pitchTrack.getBoundingClientRect();
  const clickY = e.clientY - trackRect.top;
  const clickRatio = Math.max(0, Math.min(1, clickY / trackRect.height));
  const targetScrollRatio = clickRatio - (renderer.height / quantizer.getWorldHeight(renderer.height)) / 2;
  const targetY = targetScrollRatio * quantizer.getWorldHeight(renderer.height);
  smoothScrollTo(targetY);
});

// 4. Drag Thumb with real-time responsive positioning
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
  targetScrollY = quantizer.scrollY;
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
  const nextY = quantizer.clampScrollY(dragStartScrollY + deltaScroll, renderer.height);
  targetScrollY = nextY;
  quantizer.scrollY = nextY;
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

// Custom Saved Presets Management
function getSavedCompositions(): Record<string, SavedComposition> {
  try {
    const raw = localStorage.getItem('harmonic_saved_presets') || localStorage.getItem('harmonic_saved_grooves');
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
  renderer.resize();
  prevCanvasWidth = renderer.width;
  prevCanvasHeight = renderer.height;

  if (!soundEngine.isReady) {
    await soundEngine.init();
    statAudio.textContent = 'Audio: Active';
    statAudio.classList.add('chip-ready');
  }
  dismissWelcomePrompt();

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
  if (comp.xAxisModulationMode) {
    if (xAxisSelect) {
      xAxisSelect.value = comp.xAxisModulationMode;
    }
    strokeManager.setXAxisModulationMode(comp.xAxisModulationMode);
  }
  if (comp.defaultHarmonizer && defaultHarmonizerSelect) {
    defaultHarmonizerSelect.value = comp.defaultHarmonizer;
    strokeManager.setDefaultStrokeHarmonizer(comp.defaultHarmonizer);
  }
  if (comp.defaultTiming && generalSyncSelect) {
    generalSyncSelect.value = comp.defaultTiming;
    applyGeneralSync(comp.defaultTiming);
  }
  if (comp.shapeMode) {
    inputHandler.setDrawShape(comp.shapeMode as DrawShape);
    shapeButtons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-shape') === comp.shapeMode));
  }
  if (comp.autoSmooth !== undefined) {
    inputHandler.setAutoSmooth(comp.autoSmooth);
    autoSmoothBtn.classList.toggle('active', comp.autoSmooth);
    autoSmoothBtn.textContent = comp.autoSmooth ? 'Smooth On' : 'Smooth Off';
  }
  if (comp.snapPitch !== undefined) {
    inputHandler.setSnapPitch(comp.snapPitch);
    snapPitchBtn.classList.toggle('active', comp.snapPitch);
    snapPitchBtn.textContent = comp.snapPitch ? 'Snap ON' : 'Snap Off';
    statPitchSnap.textContent = comp.snapPitch ? 'Snap ON' : 'Snap Off';
    statPitchSnap.style.color = comp.snapPitch ? '#2563eb' : 'inherit';
  }
  if (comp.theme) {
    setTheme(comp.theme === 'dark');
  }

  if (typeof comp.scrollY === 'number') {
    quantizer.scrollY = quantizer.clampScrollY(comp.scrollY, renderer.height);
  } else {
    // If older file didn't store scrollY, reset scroll to default
    quantizer.resetScrollToDefault(renderer.height);
  }
  updatePitchNavigator();

  strokeManager.importComposition(comp, quantizer, renderer.height, renderer.width);
  if (soundEngine.isReady) {
    strokeManager.activateAudioVoices();
  }
  currentLoadedPresetName = comp.name || 'Custom Preset';
  setCompositionDirty(false);
  updateStats();
  updateTrackActionsVisibility();
  renderLayerMixer();
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
  const activeName = currentLoadedPresetName || `Ambient Piece ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
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

  const comp = strokeManager.exportComposition(
    cleanName,
    scaleSelect.value,
    rootSelect.value,
    renderer.width,
    renderer.height
  );
  comp.spaceReverb = parseFloat(spaceSlider.value) / 100;
  comp.octaveSpan = parseInt(octavesSlider.value, 10);
  comp.scrollY = quantizer.scrollY;
  if (xAxisSelect) {
    comp.xAxisModulationMode = xAxisSelect.value as XAxisModulationMode;
  }
  if (breathingSelect) {
    comp.breathingMode = breathingSelect.value as BreathingMode;
  }
  if (defaultHarmonizerSelect) {
    comp.defaultHarmonizer = defaultHarmonizerSelect.value as HarmonizerMode;
  }
  if (generalSyncSelect) {
    comp.defaultTiming = generalSyncSelect.value;
  }
  comp.shapeMode = inputHandler.drawShape;
  comp.autoSmooth = inputHandler.isAutoSmooth;
  comp.snapPitch = inputHandler.isPitchSnapped;
  comp.theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';

  // 1. Save to browser storage
  const saved = getSavedCompositions();
  saved[cleanName] = comp;
  localStorage.setItem('harmonic_saved_presets', JSON.stringify(saved));
  localStorage.setItem('harmonic_saved_grooves', JSON.stringify(saved)); // Backwards-compat
  refreshSavedTemplatesDropdown();

  templateSelect.value = `custom:${cleanName}`;
  currentLoadedPresetName = cleanName;
  setCompositionDirty(false);
  renderLayerMixer();

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

// Quick Save Action (1-click overwrite or save)
function executeQuickSave(): void {
  if (strokeManager.activeStrokes.length === 0) {
    alert('Draw or create some musical lines first before saving a preset.');
    return;
  }
  const store = getSavedCompositions();
  if (currentLoadedPresetName && store[currentLoadedPresetName]) {
    executeSavePreset(currentLoadedPresetName, false);
    if (quickSaveBtn) {
      const orig = quickSaveBtn.textContent;
      quickSaveBtn.textContent = 'Saved!';
      setTimeout(() => {
        quickSaveBtn.textContent = orig;
      }, 1200);
    }
  } else {
    openSavePresetModal();
  }
}
quickSaveBtn?.addEventListener('click', executeQuickSave);

// ==========================================================================
// Layers Mixer Panel Logic & Selection Management
// ==========================================================================
let isInspectorCollapsed =
  typeof localStorage !== 'undefined' ? localStorage.getItem('harmonic_inspector_collapsed') === 'true' : false;

/**
 * Synchronizes the visual selection state (.selected) across all layer cards
 * in both Studio Deck and floating Layers Drawer to match strokeManager.selectedStrokeId.
 */
function updateMixerSelection(): void {
  const selectedId = strokeManager.selectedStrokeId;
  const allCards = document.querySelectorAll('.layer-card');
  allCards.forEach((card) => {
    const cardStrokeId = card.getAttribute('data-stroke-id');
    const isSelected = !!selectedId && cardStrokeId === selectedId;
    card.classList.toggle('selected', isSelected);
  });
}

function createLayerCard(
  stroke: any,
  idx: number,
  hasSolo: boolean
): HTMLElement {
  const card = document.createElement('div');
  const isSelected = stroke.id === strokeManager.selectedStrokeId;
  const isDimmed = (hasSolo && !stroke.soloed) || !!stroke.muted;

  card.className = `layer-card${isSelected ? ' selected' : ''}${isDimmed ? ' dimmed' : ''}`;
  card.setAttribute('data-stroke-id', stroke.id);

  const inst = getInstrument(stroke.instrumentId);
  const instName = inst.name;
  const color = renderer.getStrokeColor(stroke);
  const volPct = Math.round((stroke.volume ?? 1.0) * 100);
  const revPct = Math.round((stroke.reverb ?? 0.4) * 100);

  const totalSec = (stroke.timingMode === 'timer' || stroke.speedMode === 'timer')
    ? (stroke.duration ?? 30)
    : (stroke.lut.totalLength / Math.max(1, stroke.playhead.velocity || 100));
  const timingTag = `${totalSec.toFixed(1)}s`;

  card.innerHTML = `
    <div class="layer-card-top">
      <div class="layer-identity">
        <span class="layer-dot" style="background: ${color}"></span>
        <span class="layer-name" title="#${idx + 1} ${instName}">#${idx + 1} ${instName}</span>
        <span class="layer-tag">${timingTag}</span>
      </div>
      <div class="layer-actions">
        <button type="button" class="layer-btn${stroke.muted ? ' active-mute' : ''}" data-action="mute" title="Mute line (M)">M</button>
        <button type="button" class="layer-btn${stroke.soloed ? ' active-solo' : ''}" data-action="solo" title="Solo line (S)">S</button>
        <button type="button" class="layer-btn" data-action="duplicate" title="Duplicate line (⌘D)">⧉</button>
        <button type="button" class="layer-btn text-danger" data-action="delete" title="Delete line (Backspace)">✕</button>
      </div>
    </div>
    <div class="layer-controls-row">
      <div class="layer-slider-group">
        <span class="layer-slider-label">Vol</span>
        <input type="range" class="minimal-slider layer-vol-slider" min="0" max="100" step="1" value="${volPct}" />
        <span class="layer-slider-val layer-vol-val">${volPct}%</span>
      </div>
      <div class="layer-slider-group">
        <span class="layer-slider-label">Rev</span>
        <input type="range" class="minimal-slider layer-rev-slider" min="0" max="100" step="1" value="${revPct}" />
        <span class="layer-slider-val layer-rev-val">${revPct}%</span>
      </div>
    </div>
  `;

  // Select this stroke when clicking anywhere on the card or touching controls
  card.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    if (studioTabBtnMaster?.classList.contains('active')) {
      switchStudioDeckTab('mixer');
    }
    if (strokeManager.selectedStrokeId !== stroke.id) {
      strokeManager.selectStroke(stroke.id);
      updateTrackActionsVisibility();
      updateMixerSelection();
    }
  });

  card.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    if (studioTabBtnMaster?.classList.contains('active')) {
      switchStudioDeckTab('mixer');
    }
    if (strokeManager.selectedStrokeId !== stroke.id) {
      strokeManager.selectStroke(stroke.id);
      updateTrackActionsVisibility();
      updateMixerSelection();
    }
  });

  // Mute button
  card.querySelector<HTMLButtonElement>('[data-action="mute"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    strokeManager.toggleMute(stroke.id);
    syncCompositionState();
  });

  // Solo button
  card.querySelector<HTMLButtonElement>('[data-action="solo"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    strokeManager.toggleSolo(stroke.id);
    syncCompositionState();
  });

  // Duplicate button
  card.querySelector<HTMLButtonElement>('[data-action="duplicate"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    strokeManager.duplicateStroke(stroke.id);
    syncCompositionState();
  });

  // Delete button
  card.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    strokeManager.removeStroke(stroke.id);
    syncCompositionState();
  });

  // Volume slider
  const volSlider = card.querySelector<HTMLInputElement>('.layer-vol-slider');
  const volVal = card.querySelector<HTMLSpanElement>('.layer-vol-val');
  volSlider?.addEventListener('input', (e) => {
    e.stopPropagation();
    const v = parseInt(volSlider.value, 10) / 100;
    if (volVal) volVal.textContent = `${volSlider.value}%`;
    strokeManager.setStrokeVolume(stroke.id, v);
    setCompositionDirty(true);
    if (stroke.id === strokeManager.selectedStrokeId && trackVolSlider && trackVolVal) {
      trackVolSlider.value = volSlider.value;
      trackVolVal.textContent = `${volSlider.value}%`;
    }
  });

  // Reverb slider
  const revSlider = card.querySelector<HTMLInputElement>('.layer-rev-slider');
  const revVal = card.querySelector<HTMLSpanElement>('.layer-rev-val');
  revSlider?.addEventListener('input', (e) => {
    e.stopPropagation();
    const r = parseInt(revSlider.value, 10) / 100;
    if (revVal) revVal.textContent = `${revSlider.value}%`;
    strokeManager.setStrokeReverb(stroke.id, r);
    setCompositionDirty(true);
    if (stroke.id === strokeManager.selectedStrokeId && trackReverbSlider && trackReverbVal) {
      trackReverbSlider.value = revSlider.value;
      trackReverbVal.textContent = `${revSlider.value}%`;
    }
  });

  return card;
}

function renderLayerMixer(): void {
  const strokes = strokeManager.activeStrokes;
  if (layerCountBadge) {
    layerCountBadge.textContent = strokes.length.toString();
  }
  if (mixerTrackCount) {
    mixerTrackCount.textContent = `${strokes.length} ${strokes.length === 1 ? 'Line' : 'Lines'}`;
  }
  if (typeof renderStudioMixer === 'function') {
    renderStudioMixer();
  }
  if (!layerMixerList) return;

  if (strokes.length === 0) {
    layerMixerList.innerHTML = '<div class="mixer-empty-state">No lines yet. Draw on the canvas to add ambient sound layers.</div>';
    return;
  }

  const hasSolo = strokeManager.hasSoloedStrokes;
  layerMixerList.innerHTML = '';

  strokes.forEach((stroke, idx) => {
    layerMixerList!.appendChild(createLayerCard(stroke, idx, hasSolo));
  });
  updateMixerSelection();
}

layersToggleBtn?.addEventListener('click', () => {
  if (!layerMixerDrawer) return;
  const isShown = layerMixerDrawer.style.display !== 'none';
  layerMixerDrawer.style.display = isShown ? 'none' : 'flex';
  layersToggleBtn.classList.toggle('active', !isShown);
  if (!isShown) {
    renderLayerMixer();
  }
});

mixerCloseBtn?.addEventListener('click', () => {
  if (layerMixerDrawer) {
    layerMixerDrawer.style.display = 'none';
    layersToggleBtn?.classList.remove('active');
  }
});

mixerMuteAllBtn?.addEventListener('click', () => {
  strokeManager.activeStrokes.forEach((s) => {
    strokeManager.setStrokeMuted(s.id, true);
  });
  setCompositionDirty(true);
  updateStats();
  updateTrackActionsVisibility();
  renderLayerMixer();
});

mixerUnmuteAllBtn?.addEventListener('click', () => {
  strokeManager.activeStrokes.forEach((s) => {
    strokeManager.setStrokeMuted(s.id, false);
  });
  setCompositionDirty(true);
  updateStats();
  updateTrackActionsVisibility();
  renderLayerMixer();
});

// ==========================================================================
// View Architecture Implementations (Studio Deck, Zen Canvas, Scene Arranger)
// ==========================================================================

const sceneManager = new SceneManager();

const viewModeManager = new ViewModeManager({
  onViewChange: (mode: ViewMode) => {
    if (mode === 'studio') {
      renderStudioMixer();
      if (studioTabBtnScenes?.classList.contains('active')) {
        renderSceneCards();
      }
    } else if (mode === 'zen') {
      armZenAutoDim();
    }
    updateTrackActionsVisibility();
    if (sceneManager.isSequencing()) {
      const prog = sceneManager.getSequenceProgress();
      updateSeqMiniIndicator({
        sceneChanged: false,
        currentScene: sceneManager.getCurrentScene(),
        nextScene: sceneManager.getNextScene(),
        progressRatio: prog.ratio,
        isMorphing: false,
        morphRatio: 0,
      });
    }
  },
  onResizeRequired: () => {
    handleResize();
  },
});

viewModeManager.initDOM({
  app: appContainerEl,
  studioDeck: studioDeckEl,
  zenDock: zenPillDockEl,
  topBar: topBarEl,
  bottomBar: bottomBarEl,
  pitchNav: pitchNavigator,
});

// Wire view mode buttons across the app
document.querySelectorAll<HTMLElement>('[data-view-mode]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const mode = btn.getAttribute('data-view-mode') as ViewMode;
    if (mode) {
      viewModeManager.setMode(mode);
    }
  });
});

// Studio Deck Tab Switching (Layers Mixer vs Master FX vs Scenes)
function switchStudioDeckTab(tab: 'mixer' | 'master' | 'scenes'): void {
  studioTabBtnMixer?.classList.toggle('active', tab === 'mixer');
  studioTabBtnMaster?.classList.toggle('active', tab === 'master');
  studioTabBtnScenes?.classList.toggle('active', tab === 'scenes');

  if (studioTabMixer) studioTabMixer.style.display = tab === 'mixer' ? 'flex' : 'none';
  if (studioTabMaster) studioTabMaster.style.display = tab === 'master' ? 'flex' : 'none';
  if (studioTabScenes) studioTabScenes.style.display = tab === 'scenes' ? 'flex' : 'none';

  if (tab === 'mixer') {
    renderStudioMixer();
  } else if (tab === 'scenes') {
    renderSceneCards();
  } else if (tab === 'master') {
    // Synchronize master FX controls
    if (studioMasterBpmSlider && studioMasterBpmVal) {
      studioMasterBpmSlider.value = strokeManager.currentBpm.toString();
      studioMasterBpmVal.textContent = `${strokeManager.currentBpm} BPM`;
    }
    if (studioMasterReverbSlider && studioMasterReverbVal) {
      const revPct = Math.round(soundEngine.reverbMix * 100);
      studioMasterReverbSlider.value = revPct.toString();
      studioMasterReverbVal.textContent = `${revPct}%`;
    }
    if (studioReverbTypeSelect) studioReverbTypeSelect.value = soundEngine.reverbType;
    if (studioStereoWidthSlider && studioStereoWidthVal) {
      const widthPct = Math.round(soundEngine.stereoWidth * 100);
      studioStereoWidthSlider.value = widthPct.toString();
      studioStereoWidthVal.textContent = widthPct === 100 ? '100% (Stereo)' : (widthPct === 0 ? '0% (Mono)' : `${widthPct}%`);
    }
    if (studioTapeWarmthSlider && studioTapeWarmthVal) {
      const warmthPct = Math.round(soundEngine.tapeWarmth * 100);
      studioTapeWarmthSlider.value = warmthPct.toString();
      studioTapeWarmthVal.textContent = warmthPct === 0 ? '0% (Clean)' : `${warmthPct}%`;
    }
    if (studioDuckingSlider && studioDuckingVal) {
      const duckPct = Math.round(soundEngine.duckingDepth * 100);
      studioDuckingSlider.value = duckPct.toString();
      studioDuckingVal.textContent = duckPct === 0 ? '0% (Off)' : `${duckPct}%`;
    }
    if (studioScaleSelect) studioScaleSelect.value = scaleSelect.value;
    if (studioRootSelect) studioRootSelect.value = rootSelect.value;
    if (studioXAxisSelect) studioXAxisSelect.value = xAxisSelect.value;
  }
}

studioTabBtnMixer?.addEventListener('click', () => switchStudioDeckTab('mixer'));
studioTabBtnMaster?.addEventListener('click', () => switchStudioDeckTab('master'));
studioTabBtnScenes?.addEventListener('click', () => switchStudioDeckTab('scenes'));

// Studio Master FX Controls
studioMasterBpmSlider?.addEventListener('input', () => {
  if (!studioMasterBpmSlider) return;
  const bpm = parseInt(studioMasterBpmSlider.value, 10);
  if (studioMasterBpmVal) studioMasterBpmVal.textContent = `${bpm} BPM`;
  strokeManager.setBpm(bpm);
  bpmSlider.value = bpm.toString();
  bpmVal.textContent = `${bpm} BPM`;
  statTempo.textContent = `${bpm} BPM`;
  setCompositionDirty(true);
});

studioMasterReverbSlider?.addEventListener('input', () => {
  if (!studioMasterReverbSlider) return;
  const pct = parseInt(studioMasterReverbSlider.value, 10);
  if (studioMasterReverbVal) studioMasterReverbVal.textContent = `${pct}%`;
  soundEngine.setReverbMix(pct / 100);
  if (spaceSlider) spaceSlider.value = pct.toString();
  if (spaceVal) spaceVal.textContent = `${pct}%`;
  setCompositionDirty(true);
});

studioReverbTypeSelect?.addEventListener('change', () => {
  if (!studioReverbTypeSelect) return;
  const type = studioReverbTypeSelect.value as ReverbType;
  soundEngine.setReverbType(type);
  if (reverbTypeSelect) reverbTypeSelect.value = type;
  setCompositionDirty(true);
});

studioStereoWidthSlider?.addEventListener('input', () => {
  if (!studioStereoWidthSlider) return;
  const pct = parseInt(studioStereoWidthSlider.value, 10);
  soundEngine.setStereoWidth(pct / 100);
  const text = pct === 100 ? '100% (Stereo)' : (pct === 0 ? '0% (Mono)' : `${pct}%`);
  if (studioStereoWidthVal) studioStereoWidthVal.textContent = text;
  if (stereoWidthSlider) stereoWidthSlider.value = pct.toString();
  if (stereoWidthVal) stereoWidthVal.textContent = text;
  setCompositionDirty(true);
});

studioTapeWarmthSlider?.addEventListener('input', () => {
  if (!studioTapeWarmthSlider) return;
  const pct = parseInt(studioTapeWarmthSlider.value, 10);
  soundEngine.setTapeWarmth(pct / 100);
  const text = pct === 0 ? '0% (Clean)' : `${pct}%`;
  if (studioTapeWarmthVal) studioTapeWarmthVal.textContent = text;
  if (tapeWarmthSlider) tapeWarmthSlider.value = pct.toString();
  if (tapeWarmthVal) tapeWarmthVal.textContent = text;
  setCompositionDirty(true);
});

studioDuckingSlider?.addEventListener('input', () => {
  if (!studioDuckingSlider) return;
  const pct = parseInt(studioDuckingSlider.value, 10);
  soundEngine.setDuckingDepth(pct / 100);
  const text = pct === 0 ? '0% (Off)' : `${pct}%`;
  if (studioDuckingVal) studioDuckingVal.textContent = text;
  if (duckingSlider) duckingSlider.value = pct.toString();
  if (duckingVal) duckingVal.textContent = text;
  setCompositionDirty(true);
});

studioScaleSelect?.addEventListener('change', () => {
  if (!studioScaleSelect) return;
  const scaleKey = studioScaleSelect.value;
  scaleSelect.value = scaleKey;
  if (SCALES[scaleKey]) {
    quantizer.updateConfig({ scale: SCALES[scaleKey] });
    setCompositionDirty(true);
  }
});

studioRootSelect?.addEventListener('change', () => {
  if (!studioRootSelect) return;
  const rootKey = studioRootSelect.value;
  rootSelect.value = rootKey;
  if (ROOT_NOTES[rootKey]) {
    quantizer.updateConfig({ root: ROOT_NOTES[rootKey] });
    setCompositionDirty(true);
  }
});

studioXAxisSelect?.addEventListener('change', () => {
  if (!studioXAxisSelect) return;
  const mode = studioXAxisSelect.value as XAxisModulationMode;
  xAxisSelect.value = mode;
  strokeManager.setXAxisModulationMode(mode);
  setCompositionDirty(true);
});

studioSyncBtn?.addEventListener('click', () => {
  strokeManager.resyncAllPlayheads();
});

studioRandomizeBtn?.addEventListener('click', () => {
  strokeManager.randomizeAllPlayheads();
});

studioMuteAllBtn?.addEventListener('click', () => {
  strokeManager.activeStrokes.forEach((s) => strokeManager.setStrokeMuted(s.id, true));
  setCompositionDirty(true);
  updateStats();
  updateTrackActionsVisibility();
  renderLayerMixer();
  renderStudioMixer();
});

studioUnmuteAllBtn?.addEventListener('click', () => {
  strokeManager.activeStrokes.forEach((s) => strokeManager.setStrokeMuted(s.id, false));
  setCompositionDirty(true);
  updateStats();
  updateTrackActionsVisibility();
  renderLayerMixer();
  renderStudioMixer();
});

// Render persistent Layer Mixer cards inside Studio Deck
function renderStudioMixer(): void {
  const strokes = strokeManager.activeStrokes;
  if (studioLayerCount) {
    studioLayerCount.textContent = strokes.length.toString();
  }
  if (!studioMixerList) return;

  if (strokes.length === 0) {
    studioMixerList.innerHTML = '<div class="mixer-empty-state">No lines drawn yet. Draw on the canvas to add ambient sound layers.</div>';
    updateStudioDockedInspector();
    return;
  }

  const hasSolo = strokeManager.hasSoloedStrokes;
  studioMixerList.innerHTML = '';

  strokes.forEach((stroke, idx) => {
    studioMixerList!.appendChild(createLayerCard(stroke, idx, hasSolo));
  });

  updateStudioDockedInspector();
  updateMixerSelection();
}

// Docked Inspector inside Studio Deck
function updateStudioDockedInspector(): void {
  const selectedId = strokeManager.selectedStrokeId;
  if (!studioDockedInspector) return;

  if (!selectedId) {
    studioDockedInspector.classList.add('is-empty');
    studioDockedInspector.classList.remove('has-selection', 'is-collapsed');
    if (dockedInspectorToggleBtn) dockedInspectorToggleBtn.style.display = 'none';
    if (studioInspectorContent) studioInspectorContent.style.display = 'none';
    if (studioInspectorSub) studioInspectorSub.textContent = 'Select a line to inspect';
    if (studioBadgeDot) studioBadgeDot.style.background = 'transparent';
    if (studioInspectorLabel) studioInspectorLabel.textContent = 'Line Inspector';
    return;
  }

  const stroke = strokeManager.activeStrokes.find((s) => s.id === selectedId);
  if (!stroke) return;

  studioDockedInspector.classList.remove('is-empty');
  studioDockedInspector.classList.add('has-selection');
  if (dockedInspectorToggleBtn) {
    dockedInspectorToggleBtn.style.display = 'inline-flex';
    dockedInspectorToggleBtn.textContent = isInspectorCollapsed ? '▲' : '▼';
    dockedInspectorToggleBtn.setAttribute(
      'title',
      isInspectorCollapsed ? 'Expand Line Inspector' : 'Collapse Line Inspector (show more lines)'
    );
  }

  if (isInspectorCollapsed) {
    studioDockedInspector.classList.add('is-collapsed');
    if (studioInspectorContent) studioInspectorContent.style.display = 'none';
  } else {
    studioDockedInspector.classList.remove('is-collapsed');
    if (studioInspectorContent) studioInspectorContent.style.display = 'flex';
  }

  const idx = strokeManager.activeStrokes.indexOf(stroke);
  const inst = getInstrument(stroke.instrumentId);
  const color = renderer.getStrokeColor(stroke);

  if (studioInspectorLabel) studioInspectorLabel.textContent = inst.name;
  if (studioInspectorSub) studioInspectorSub.textContent = `Line #${idx + 1} (${stroke.style})`;
  if (studioBadgeDot) studioBadgeDot.style.background = color;

  if (studioVoicingSelect) {
    studioVoicingSelect.value = stroke.harmonizer ?? 'single';
  }

  const isTimer = stroke.timingMode === 'timer' || stroke.speedMode === 'timer';
  if (studioTimingModeLabel) {
    studioTimingModeLabel.textContent = isTimer ? 'Timer' : 'Speed';
  }
  studioTimingToggle?.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
    b.classList.toggle('active', (b.getAttribute('data-timing-mode') === 'timer') === isTimer);
  });

  if (studioTimingSlider && studioTimingVal) {
    if (isTimer) {
      studioTimingSlider.min = '1';
      studioTimingSlider.max = '300';
      studioTimingSlider.step = '1';
      studioTimingSlider.value = (stroke.duration ?? 30).toString();
      studioTimingVal.textContent = `${stroke.duration ?? 30}s`;
    } else {
      studioTimingSlider.min = '0.1';
      studioTimingSlider.max = '4.0';
      studioTimingSlider.step = '0.05';
      studioTimingSlider.value = (stroke.speedMultiplier ?? 1.0).toString();
      studioTimingVal.textContent = `${(stroke.speedMultiplier ?? 1.0).toFixed(2)}x`;
    }
  }

  const isBounce = stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong';
  studioTraversalSwitch?.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
    b.classList.toggle('active', (b.getAttribute('data-track-traversal') === 'bounce') === isBounce);
  });

  if (studioWaveShapeSelect) {
    studioWaveShapeSelect.value = stroke.waveParams?.shapeType ?? 'sine';
  }
  if (studioWaveAmpSlider && studioWaveAmpVal) {
    const amp = stroke.waveParams?.amplitude ?? 0;
    studioWaveAmpSlider.value = amp.toString();
    studioWaveAmpVal.textContent = `${Math.round(amp)}px`;
  }
  if (studioWaveSineBtn) {
    studioWaveSineBtn.classList.toggle('active', (stroke.waveParams?.amplitude ?? 0) > 0);
  }
}

// Studio Inspector Controls Events
studioVoicingSelect?.addEventListener('change', () => {
  if (!studioVoicingSelect || !strokeManager.selectedStrokeId) return;
  const mode = studioVoicingSelect.value as HarmonizerMode;
  strokeManager.setStrokeHarmonizer(strokeManager.selectedStrokeId, mode);
  setCompositionDirty(true);
  updateTrackActionsVisibility();
});

studioTimingToggle?.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
  b.addEventListener('click', () => {
    if (!strokeManager.selectedStrokeId) return;
    const mode = b.getAttribute('data-timing-mode') as 'speed' | 'timer';
    strokeManager.setStrokeTimingMode(strokeManager.selectedStrokeId, mode);
    if (studioTimingModeLabel) {
      studioTimingModeLabel.textContent = mode === 'timer' ? 'Timer' : 'Speed';
    }
    setCompositionDirty(true);
    updateTrackActionsVisibility();
    renderStudioMixer();
  });
});

studioTimingSlider?.addEventListener('input', () => {
  if (!studioTimingSlider || !strokeManager.selectedStrokeId) return;
  const stroke = strokeManager.activeStrokes.find((s) => s.id === strokeManager.selectedStrokeId);
  if (!stroke) return;

  const isTimer = stroke.timingMode === 'timer' || stroke.speedMode === 'timer';
  if (isTimer) {
    const val = parseInt(studioTimingSlider.value, 10);
    if (studioTimingVal) studioTimingVal.textContent = `${val}s`;
    strokeManager.setStrokeDuration(stroke.id, val);
  } else {
    const val = parseFloat(studioTimingSlider.value);
    if (studioTimingVal) studioTimingVal.textContent = `${val.toFixed(2)}x`;
    strokeManager.setStrokeSpeed(stroke.id, val);
  }
  setCompositionDirty(true);
  renderLayerMixer();
  renderStudioMixer();
});

studioTraversalSwitch?.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
  b.addEventListener('click', () => {
    if (!strokeManager.selectedStrokeId) return;
    const trav = b.getAttribute('data-track-traversal') as TraversalMode;
    strokeManager.setStrokeTraversal(strokeManager.selectedStrokeId, trav);
    setCompositionDirty(true);
    updateTrackActionsVisibility();
    renderStudioMixer();
  });
});

studioWaveShapeSelect?.addEventListener('change', () => {
  if (!studioWaveShapeSelect || !strokeManager.selectedStrokeId) return;
  const shape = studioWaveShapeSelect.value as WaveShapeType;
  const amp = studioWaveAmpSlider ? parseFloat(studioWaveAmpSlider.value) : 20;
  strokeManager.restructureStrokeWave(strokeManager.selectedStrokeId, Math.max(10, amp), 2, shape, true);
  setCompositionDirty(true);
  updateTrackActionsVisibility();
});

studioWaveSineBtn?.addEventListener('click', () => {
  if (!strokeManager.selectedStrokeId) return;
  const stroke = strokeManager.activeStrokes.find((s) => s.id === strokeManager.selectedStrokeId);
  if (!stroke) return;
  const hasWave = (stroke.waveParams?.amplitude ?? 0) > 0;
  if (hasWave) {
    strokeManager.restructureStrokeWave(stroke.id, 0, 2, 'sine', true);
  } else {
    strokeManager.restructureStrokeWave(stroke.id, 20, 2, 'sine', true);
  }
  setCompositionDirty(true);
  updateTrackActionsVisibility();
});

studioWaveAmpSlider?.addEventListener('input', () => {
  if (!studioWaveAmpSlider || !strokeManager.selectedStrokeId) return;
  const amp = parseFloat(studioWaveAmpSlider.value);
  if (studioWaveAmpVal) studioWaveAmpVal.textContent = `${Math.round(amp)}px`;
  const shape = (studioWaveShapeSelect?.value ?? 'sine') as WaveShapeType;
  strokeManager.restructureStrokeWave(strokeManager.selectedStrokeId, amp, 2, shape, false);
  setCompositionDirty(true);
});

studioDupTrackBtn?.addEventListener('click', () => {
  if (strokeManager.selectedStrokeId) {
    strokeManager.duplicateSelected(quantizer, renderer.height);
    syncCompositionState();
  }
});

studioDelTrackBtn?.addEventListener('click', () => {
  if (strokeManager.selectedStrokeId) {
    strokeManager.deleteSelected();
    syncCompositionState();
  }
});

studioDeselectTrackBtn?.addEventListener('click', () => {
  strokeManager.selectStroke(null);
  updateTrackActionsVisibility();
  renderStudioMixer();
});

dockedInspectorToggleBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  isInspectorCollapsed = !isInspectorCollapsed;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('harmonic_inspector_collapsed', isInspectorCollapsed.toString());
  }
  updateStudioDockedInspector();
});

const dockedInspectorHeader = studioDockedInspector?.querySelector('.docked-inspector-header');
dockedInspectorHeader?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('button')) return;
  if (strokeManager.selectedStrokeId) {
    isInspectorCollapsed = !isInspectorCollapsed;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('harmonic_inspector_collapsed', isInspectorCollapsed.toString());
    }
    updateStudioDockedInspector();
  }
});

// Zen Mode Initialization
function initZenMode(): void {
  if (zenSwatches) {
    zenSwatches.innerHTML = '';
    const insts = Object.values(INSTRUMENTS);
    insts.forEach((inst) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `swatch-btn${inst.id === currentInstrumentId ? ' active' : ''}`;
      btn.setAttribute('data-instrument', inst.id);
      btn.style.setProperty('--swatch-c', inst.color);
      btn.title = inst.name;
      btn.innerHTML = '<span class="swatch-dot"></span>';

      btn.addEventListener('click', () => {
        selectInstrument(inst.id);
        zenSwatches?.querySelectorAll('.swatch-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
      zenSwatches.appendChild(btn);
    });
  }

  zenPlayPauseBtn?.addEventListener('click', () => {
    togglePlayPause();
    if (zenPlayPauseText) {
      zenPlayPauseText.textContent = strokeManager.paused ? 'Play' : 'Pause';
    }
  });

  zenSyncBtn?.addEventListener('click', () => {
    strokeManager.resyncAllPlayheads();
  });

  zenUndoBtn?.addEventListener('click', () => {
    strokeManager.undo();
    syncCompositionState();
  });

  zenClearBtn?.addEventListener('click', () => {
    clearBtn.click();
  });

  document.querySelectorAll<HTMLElement>('#zenAppModeControl .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-app-mode') as 'draw' | 'live';
      if (mode) {
        setAppMode(mode);
      }
    });
  });

  document.querySelectorAll<HTMLElement>('#zenStyleControl .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const style = btn.getAttribute('data-zen-style') as StrokeStyle;
      if (style) {
        currentStyle = style;
        document.querySelectorAll<HTMLElement>('#zenStyleControl .seg-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        // sync top texture
        document.querySelectorAll<HTMLElement>('#strokeModeControl .seg-btn').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-style') === style);
        });
      }
    });
  });

  // Zen Contextual Pill Handlers
  zenContextCloseBtn?.addEventListener('click', () => {
    strokeManager.selectStroke(null);
    updateTrackActionsVisibility();
  });

  zenContextVolSlider?.addEventListener('input', () => {
    if (!zenContextVolSlider || !strokeManager.selectedStrokeId) return;
    const v = parseInt(zenContextVolSlider.value, 10) / 100;
    strokeManager.setStrokeVolume(strokeManager.selectedStrokeId, v);
    setCompositionDirty(true);
  });

  zenContextMuteBtn?.addEventListener('click', () => {
    if (!strokeManager.selectedStrokeId) return;
    strokeManager.toggleMute(strokeManager.selectedStrokeId);
    setCompositionDirty(true);
    updateTrackActionsVisibility();
    renderStudioMixer();
  });

  zenContextSoloBtn?.addEventListener('click', () => {
    if (!strokeManager.selectedStrokeId) return;
    strokeManager.toggleSolo(strokeManager.selectedStrokeId);
    setCompositionDirty(true);
    updateTrackActionsVisibility();
    renderStudioMixer();
  });

  zenContextTravBtn?.addEventListener('click', () => {
    if (!strokeManager.selectedStrokeId) return;
    const s = strokeManager.activeStrokes.find((st) => st.id === strokeManager.selectedStrokeId);
    if (s) {
      const currentTrav = (s.traversal === 'bounce' || (s.traversal as string) === 'pingpong') ? 'bounce' : 'restart';
      const nextTrav = currentTrav === 'bounce' ? 'restart' : 'bounce';
      strokeManager.setStrokeTraversal(s.id, nextTrav);
      setCompositionDirty(true);
      updateTrackActionsVisibility();
      renderStudioMixer();
    }
  });
}

let zenAutoDimTimer: number | null = null;
function armZenAutoDim(): void {
  if (zenAutoDimTimer) window.clearTimeout(zenAutoDimTimer);
  zenPillDockEl?.classList.remove('zen-dimmed');

  zenAutoDimTimer = window.setTimeout(() => {
    if (viewModeManager.getMode() === 'zen' && !strokeManager.paused) {
      zenPillDockEl?.classList.add('zen-dimmed');
    }
  }, 3500);
}

window.addEventListener('pointermove', () => {
  if (viewModeManager.getMode() === 'zen') {
    armZenAutoDim();
  }
});

// Update Zen Contextual Pill
function updateZenContextPill(stroke?: DrawnStroke): void {
  if (!zenContextPillEl) return;
  if (!stroke || viewModeManager.getMode() !== 'zen') {
    zenContextPillEl.style.display = 'none';
    return;
  }

  zenContextPillEl.style.display = 'flex';
  const inst = getInstrument(stroke.instrumentId);
  const color = renderer.getStrokeColor(stroke);
  const idx = strokeManager.activeStrokes.indexOf(stroke);

  if (zenContextDot) zenContextDot.style.background = color;
  if (zenContextName) zenContextName.textContent = `#${idx + 1} ${inst.name}`;
  if (zenContextVolSlider) zenContextVolSlider.value = Math.round((stroke.volume ?? 1.0) * 100).toString();
  if (zenContextMuteBtn) zenContextMuteBtn.classList.toggle('active-mute', !!stroke.muted);
  if (zenContextSoloBtn) zenContextSoloBtn.classList.toggle('active-solo', !!stroke.soloed);
}

// Scene Arranger Implementation
function renderSceneCards(): void {
  if (!sceneCardsList) return;
  const scenes = sceneManager.getScenes();
  const currentScene = sceneManager.getCurrentScene();
  sceneCardsList.innerHTML = '';

  scenes.forEach((scene) => {
    const card = document.createElement('div');
    const isActive = scene.id === currentScene.id;
    card.className = `scene-card${isActive ? ' active' : ''}`;
    card.setAttribute('data-scene-id', scene.id);
    card.setAttribute('draggable', 'true');

    const strokeCount = isActive ? strokeManager.activeStrokes.length : scene.strokes.length;

    card.innerHTML = `
      <div class="scene-card-top">
        <span class="scene-card-name" contenteditable="true" spellcheck="false" title="Click to rename scene">${scene.name}</span>
        ${isActive ? `<span class="scene-card-badge" id="badge_${scene.id}">Active</span>` : ''}
      </div>
      <div class="scene-card-meta">
        <span class="scene-card-chip">${strokeCount} lines</span>
        <label class="scene-card-chip scene-card-chip-input has-tooltip" data-tooltip="Hold Length: Duration in seconds before transitioning (5s - 300s)">
          <input type="number" class="scene-card-duration-input" min="5" max="300" step="1" value="${scene.durationSec}" />s
        </label>
        <label class="scene-card-chip scene-card-chip-input has-tooltip" data-tooltip="Scene Tempo: BPM for this movement (10 - 240 BPM)">
          <input type="number" class="scene-card-bpm-input" min="10" max="240" step="1" value="${scene.bpm || 32}" /> BPM
        </label>
      </div>
      <div class="scene-progress-track" id="track_${scene.id}" title="Click along the countdown bar to speed up & audition morphing">
        <div class="scene-progress-bar" id="progress_${scene.id}"></div>
      </div>
    `;

    const nameEl = card.querySelector<HTMLElement>('.scene-card-name');
    const trackEl = card.querySelector<HTMLElement>(`#track_${scene.id}`);
    const durInput = card.querySelector<HTMLInputElement>('.scene-card-duration-input');
    const bpmInput = card.querySelector<HTMLInputElement>('.scene-card-bpm-input');

    // Interactive duration input
    if (durInput) {
      const applyDur = () => {
        let val = parseInt(durInput.value, 10);
        if (isNaN(val) || val < 5) val = 5;
        if (val > 300) val = 300;
        durInput.value = val.toString();
        sceneManager.setSceneDuration(scene.id, val);
        setCompositionDirty(true);
      };
      durInput.addEventListener('click', (e) => e.stopPropagation());
      durInput.addEventListener('mousedown', (e) => e.stopPropagation());
      durInput.addEventListener('focus', () => { card.setAttribute('draggable', 'false'); });
      durInput.addEventListener('blur', () => {
        card.setAttribute('draggable', 'true');
        applyDur();
      });
      durInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          durInput.blur();
        }
      });
    }

    // Interactive BPM input
    if (bpmInput) {
      const applyBpm = () => {
        let val = parseInt(bpmInput.value, 10);
        if (isNaN(val) || val < 10) val = 10;
        if (val > 240) val = 240;
        bpmInput.value = val.toString();
        sceneManager.setSceneBpm(scene.id, val);
        if (scene.id === sceneManager.getCurrentScene().id) {
          strokeManager.setBpm(val);
          bpmSlider.value = val.toString();
          bpmVal.textContent = `${val} BPM`;
          statTempo.textContent = `${val} BPM`;
        }
        setCompositionDirty(true);
      };
      bpmInput.addEventListener('click', (e) => e.stopPropagation());
      bpmInput.addEventListener('mousedown', (e) => e.stopPropagation());
      bpmInput.addEventListener('focus', () => { card.setAttribute('draggable', 'false'); });
      bpmInput.addEventListener('blur', () => {
        card.setAttribute('draggable', 'true');
        applyBpm();
      });
      bpmInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          bpmInput.blur();
        }
      });
    }

    // Interactive countdown bar seeking: speed up to audition morphing!
    trackEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = trackEl.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(0.99, clickX / rect.width));

      // If clicking another scene's track, switch to that scene first
      if (scene.id !== sceneManager.getCurrentScene().id) {
        switchScene(scene.id);
      }

      // Automatically activate sequence if not yet running so morphing auditions right away
      if (!sceneManager.isSequencing()) {
        sceneManager.updateCurrentScene({
          strokes: strokeManager.exportComposition().strokes,
          bpm: strokeManager.currentBpm,
        });
        sceneManager.startSequence();
        if (sceneSeqPlayText) sceneSeqPlayText.textContent = 'Stop Sequence';
        scenePlaySeqBtn?.classList.add('active');
      }

      // Seek current scene forward
      sceneManager.seekCurrentScene(ratio);

      // Reflect seek ratio immediately on progress bar
      const pBar = document.getElementById(`progress_${scene.id}`);
      if (pBar) {
        pBar.style.width = `${(ratio * 100).toFixed(1)}%`;
      }
    });

    // Drag-and-drop reordering
    card.addEventListener('dragstart', (e) => {
      if (document.activeElement === nameEl || document.activeElement === durInput || document.activeElement === bpmInput) {
        e.preventDefault();
        return;
      }
      card.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', scene.id);
      }
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.scene-card').forEach((c) => c.classList.remove('drag-over'));
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      card.classList.add('drag-over');
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const sourceId = e.dataTransfer?.getData('text/plain');
      if (sourceId && sourceId !== scene.id) {
        const reordered = sceneManager.reorderScene(sourceId, scene.id);
        if (reordered) {
          setCompositionDirty(true);
          renderSceneCards();
        }
      }
    });

    // Click on card body to switch scene
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('scene-card-name') || target.closest('.scene-progress-track') || target.closest('.scene-card-chip-input')) return;
      if (scene.id !== sceneManager.getCurrentScene().id) {
        switchScene(scene.id);
      }
    });

    // Editable name blur event (disable drag while editing text)
    nameEl?.addEventListener('focus', () => {
      card.setAttribute('draggable', 'false');
    });
    nameEl?.addEventListener('blur', () => {
      card.setAttribute('draggable', 'true');
      if (nameEl.textContent) {
        sceneManager.renameScene(scene.id, nameEl.textContent.trim());
        setCompositionDirty(true);
      }
    });
    nameEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameEl.blur();
      }
    });

    sceneCardsList.appendChild(card);
  });
}

function syncCompositionState(): void {
  setCompositionDirty(true);
  updateStats();
  updateTrackActionsVisibility();
  renderLayerMixer();
  renderStudioMixer();
  try {
    if (typeof sceneManager !== 'undefined') {
      sceneManager.updateCurrentScene({
        strokes: strokeManager.exportComposition().strokes,
      });
      if (typeof renderSceneCards === 'function') {
        renderSceneCards();
      }
    }
  } catch {
    // sceneManager not initialized yet
  }
}

function switchScene(sceneId: string): void {
  strokeManager.cancelSceneCrossfade();
  // 1. Snapshot current canvas strokes into currently active scene
  sceneManager.updateCurrentScene({
    strokes: strokeManager.exportComposition().strokes,
    bpm: strokeManager.currentBpm,
    scaleId: scaleSelect.value,
    rootId: rootSelect.value,
    spaceReverb: soundEngine.reverbMix,
    xAxisModulationMode: xAxisSelect.value as XAxisModulationMode,
  });

  // 2. Select target scene
  const target = sceneManager.selectScene(sceneId);
  if (target) {
    loadScene(target);
  }
}

function loadScene(scene: SceneData): void {
  strokeManager.cancelSceneCrossfade();
  const comp: SavedComposition = {
    version: 1,
    name: scene.name,
    timestamp: Date.now(),
    bpm: scene.bpm || 32,
    scaleId: scene.scaleId || 'dorian',
    rootId: scene.rootId || 'D2',
    spaceReverb: scene.spaceReverb ?? 0.65,
    xAxisModulationMode: scene.xAxisModulationMode || 'panAndTone',
    strokes: JSON.parse(JSON.stringify(scene.strokes || [])),
  };

  strokeManager.setSceneMorphVolumeGain(1.0);
  strokeManager.importComposition(comp, quantizer, renderer.height, renderer.width, 0.2);

  if (soundEngine.isReady) {
    strokeManager.activateAudioVoices();
  }

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
    soundEngine.setReverbMix(comp.spaceReverb);
    spaceSlider.value = Math.round(comp.spaceReverb * 100).toString();
    spaceVal.textContent = `${Math.round(comp.spaceReverb * 100)}%`;
  }

  updateStats();
  updateTrackActionsVisibility();
  renderLayerMixer();
  renderStudioMixer();
  renderSceneCards();
}

// Scene Arranger Controls
sceneAddBtn?.addEventListener('click', () => {
  // Snapshot current
  sceneManager.updateCurrentScene({
    strokes: strokeManager.exportComposition().strokes,
    bpm: strokeManager.currentBpm,
  });
  const newScene = sceneManager.addScene();
  switchScene(newScene.id);
});

sceneDupBtn?.addEventListener('click', () => {
  sceneManager.updateCurrentScene({
    strokes: strokeManager.exportComposition().strokes,
    bpm: strokeManager.currentBpm,
  });
  const dup = sceneManager.duplicateCurrentScene();
  switchScene(dup.id);
});

sceneDelBtn?.addEventListener('click', () => {
  const currentId = sceneManager.getCurrentScene().id;
  const deleted = sceneManager.deleteScene(currentId);
  if (deleted) {
    loadScene(sceneManager.getCurrentScene());
  }
});

sceneMorphSlider?.addEventListener('input', () => {
  if (!sceneMorphSlider) return;
  const s = parseInt(sceneMorphSlider.value, 10);
  if (sceneMorphVal) sceneMorphVal.textContent = `${s}s`;
  sceneManager.setMorphDuration(s);
});

sceneMorphBlendButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-blend') as MorphCurveMode | null;
    if (!mode) return;
    sceneMorphBlendButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    sceneManager.setMorphCurveMode(mode);
    if (sceneMorphCurveSelect) {
      sceneMorphCurveSelect.value = mode;
    }
  });
});

sceneMorphCurveSelect?.addEventListener('change', () => {
  if (!sceneMorphCurveSelect) return;
  const mode = sceneMorphCurveSelect.value as MorphCurveMode;
  sceneManager.setMorphCurveMode(mode);
  sceneMorphBlendButtons.forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-blend') === mode);
  });
});

scenePlaySeqBtn?.addEventListener('click', () => {
  if (sceneManager.isSequencing()) {
    sceneManager.stopSequence();
    strokeManager.cancelSceneCrossfade();
    if (seqMiniIndicator) seqMiniIndicator.style.display = 'none';
    if (sceneSeqPlayText) sceneSeqPlayText.textContent = 'Play Sequence';
    scenePlaySeqBtn.classList.remove('active');
  } else {
    // Snapshot current
    sceneManager.updateCurrentScene({
      strokes: strokeManager.exportComposition().strokes,
      bpm: strokeManager.currentBpm,
    });
    sceneManager.startSequence();
    if (sceneSeqPlayText) sceneSeqPlayText.textContent = 'Stop Sequence';
    scenePlaySeqBtn.classList.add('active');
  }
  renderSceneCards();
});

// Click mini HUD indicator to jump straight to Scene Arranger, or click on track to seek!
seqMiniIndicator?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const miniTrack = target.closest('.seq-mini-bar-track') as HTMLElement | null;
  if (miniTrack) {
    const rect = miniTrack.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(0.99, clickX / rect.width));
    sceneManager.seekCurrentScene(ratio);
    return;
  }
  viewModeManager.setMode('studio');
  switchStudioDeckTab('scenes');
});

function updateSeqMiniIndicator(seq: SceneSequenceTickResult): void {
  if (!seqMiniIndicator) return;
  const currentView = typeof viewModeManager !== 'undefined' ? viewModeManager.getMode() : 'studio';
  const isScenesTabActive = currentView === 'studio' && studioTabBtnScenes?.classList.contains('active');
  if (isScenesTabActive || !sceneManager.isSequencing()) {
    seqMiniIndicator.style.display = 'none';
    return;
  }

  seqMiniIndicator.style.display = 'flex';
  seqMiniIndicator.classList.toggle('is-morphing', seq.isMorphing);

  if (seqMiniName) {
    if (seq.isMorphing && seq.nextScene) {
      seqMiniName.textContent = `Morphing → ${seq.nextScene.name}`;
    } else {
      seqMiniName.textContent = seq.currentScene.name;
    }
  }

  if (seqMiniState) {
    seqMiniState.textContent = seq.isMorphing ? 'Morph' : 'Seq';
  }

  if (seqMiniProgressText) {
    const pct = Math.round(seq.progressRatio * 100);
    seqMiniProgressText.textContent = `${pct}%`;
  }

  if (seqMiniBarFill) {
    seqMiniBarFill.style.width = `${(seq.progressRatio * 100).toFixed(1)}%`;
  }
}

initZenMode();


// ==========================================================================
// Record & MP3 Export Handlers
// ==========================================================================
function openRecordModal(): void {
  if (recordModal) {
    recordModal.classList.remove('hidden');
    switchRecordTab('simulate');
    if (simProgressWrap) simProgressWrap.classList.add('hidden');
    if (simProgressBar) simProgressBar.style.width = '0%';
    if (startSimulateBtn) {
      startSimulateBtn.disabled = false;
      startSimulateBtn.textContent = 'Simulate & Convert to MP3';
    }
  }
}

function closeRecordModal(): void {
  if (recordModal) {
    recordModal.classList.add('hidden');
  }
}

function switchRecordTab(tab: 'simulate' | 'live'): void {
  if (tab === 'simulate') {
    tabSimulateBtn?.classList.add('active');
    tabLiveBtn?.classList.remove('active');
    tabSimulatePane?.classList.remove('hidden');
    tabLivePane?.classList.add('hidden');
  } else {
    tabLiveBtn?.classList.add('active');
    tabSimulateBtn?.classList.remove('active');
    tabLivePane?.classList.remove('hidden');
    tabSimulatePane?.classList.add('hidden');
  }
}

durationPillBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    durationPillBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const sec = btn.getAttribute('data-sec');
    if (sec && simDurationInput) {
      simDurationInput.value = sec;
    }
  });
});

simDurationInput?.addEventListener('input', () => {
  const val = simDurationInput.value;
  durationPillBtns.forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-sec') === val);
  });
});

tabSimulateBtn?.addEventListener('click', () => switchRecordTab('simulate'));
tabLiveBtn?.addEventListener('click', () => switchRecordTab('live'));

recordModalBtn?.addEventListener('click', openRecordModal);
closeRecordModalBtn?.addEventListener('click', closeRecordModal);
recordModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeRecordModal);

// Simulate & Convert to MP3
startSimulateBtn?.addEventListener('click', async () => {
  if (isSimulating) return;
  if (strokeManager.activeStrokes.length === 0) {
    alert('Draw or load some lines before simulating.');
    return;
  }

  const duration = Math.max(5, Math.min(600, parseInt(simDurationInput?.value || '30', 10) || 30));
  isSimulating = true;
  if (startSimulateBtn) {
    startSimulateBtn.disabled = true;
    startSimulateBtn.textContent = 'Simulating & Converting...';
  }
  if (simProgressWrap) simProgressWrap.classList.remove('hidden');
  if (simProgressBar) simProgressBar.style.width = '5%';
  if (simProgressStatus) simProgressStatus.textContent = 'Starting offline simulation...';

  try {
    const presetName = currentLoadedPresetName || (templateSelect?.value ? templateSelect.value : 'generative-drawing');
    const cleanPreset = presetName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const filename = `${cleanPreset}-${duration}s.mp3`;

    await simulateAndExportMp3({
      durationSeconds: duration,
      strokeManager,
      quantizer,
      canvasWidth: renderer.width,
      canvasHeight: renderer.height,
      onProgress: (status, percent) => {
        if (simProgressBar) simProgressBar.style.width = `${percent}%`;
        if (simProgressStatus) simProgressStatus.textContent = `${status}`;
      },
    }, filename);

    if (simProgressStatus) simProgressStatus.textContent = `Export complete! Downloaded ${filename}`;
    setTimeout(() => {
      closeRecordModal();
    }, 1400);
  } catch (err) {
    console.error('Simulation export error:', err);
    alert('An error occurred during MP3 simulation. Check browser console for details.');
  } finally {
    isSimulating = false;
    if (startSimulateBtn) {
      startSimulateBtn.disabled = false;
      startSimulateBtn.textContent = 'Simulate & Convert to MP3';
    }
  }
});

// Start Live Recording
startLiveRecBtn?.addEventListener('click', async () => {
  if (!soundEngine.isReady) {
    await soundEngine.init();
    strokeManager.activateAudioVoices();
    statAudio.textContent = 'Audio: Active';
    statAudio.classList.add('chip-ready');
    dismissWelcomePrompt();
  }

  closeRecordModal();

  if (!liveRecorder) {
    liveRecorder = new LiveRecorder();
  }

  if (liveRecorder.recording) {
    liveRecorder.cancel();
  }

  if (liveRecTimer) liveRecTimer.textContent = '00:00';
  if (liveRecordingBanner) liveRecordingBanner.classList.remove('hidden');

  try {
    liveRecorder.start(soundEngine, (elapsedSec) => {
      const m = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
      const s = Math.floor(elapsedSec % 60).toString().padStart(2, '0');
      if (liveRecTimer) liveRecTimer.textContent = `${m}:${s}`;
    });
  } catch (err) {
    console.error('Live record start error:', err);
    alert('Could not start live recording.');
    liveRecordingBanner?.classList.add('hidden');
  }
});

// Stop Live Recording & Export MP3
stopLiveRecBtn?.addEventListener('click', async () => {
  if (!liveRecorder || !liveRecorder.recording) return;

  if (stopLiveRecBtn) {
    stopLiveRecBtn.disabled = true;
    stopLiveRecBtn.textContent = 'Encoding MP3...';
  }

  try {
    const presetName = currentLoadedPresetName || (templateSelect?.value ? templateSelect.value : 'generative-drawing');
    const cleanPreset = presetName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
    const filename = `${cleanPreset}-live-${timeStr}.mp3`;

    const mp3Blob = await liveRecorder.stopAndExport();
    downloadBlob(mp3Blob, filename);
  } catch (err) {
    console.error('Live record export error:', err);
    alert('Could not export live recording MP3.');
  } finally {
    liveRecordingBanner?.classList.add('hidden');
    if (stopLiveRecBtn) {
      stopLiveRecBtn.disabled = false;
      stopLiveRecBtn.textContent = 'Stop & Export MP3';
    }
  }
});

// Cancel Live Recording
cancelLiveRecBtn?.addEventListener('click', () => {
  if (liveRecorder) {
    liveRecorder.cancel();
  }
  liveRecordingBanner?.classList.add('hidden');
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
    localStorage.setItem('harmonic_saved_presets', JSON.stringify(saved));
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

  renderer.resize();
  prevCanvasWidth = renderer.width;
  prevCanvasHeight = renderer.height;

  currentLoadedPresetName = template.name;
  templateSelect.value = tId;

  if (initAudio && !soundEngine.isReady) {
    await soundEngine.init();
    statAudio.textContent = 'Audio: Active';
    statAudio.classList.add('chip-ready');
    dismissWelcomePrompt();
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

  strokeManager.randomizeAllPlayheads(quantizer, renderer.height);
  if (soundEngine.isReady) {
    strokeManager.activateAudioVoices();
  }
  currentLoadedPresetName = template.name;
  setCompositionDirty(false);
  updateStats();
  updateTrackActionsVisibility();
  renderLayerMixer();

  // Keep initial/current scene synchronized with loaded preset strokes and render cards
  sceneManager.updateCurrentScene({
    name: `Scene 1: ${template.name}`,
    strokes: strokeManager.exportComposition().strokes,
    bpm: template.bpm,
    scaleId: template.scaleId,
    rootId: template.rootId,
    spaceReverb: template.spaceReverb ?? 0.65,
    xAxisModulationMode: template.xAxisModulation || 'panAndTone',
  });
  renderSceneCards();
}

templateSelect.addEventListener('change', async () => {
  const tId = templateSelect.value;
  if (!tId) return;

  if (isCompositionDirty && strokeManager.activeStrokes.length > 0) {
    const ok = confirm(`You have unsaved changes in "${currentLoadedPresetName || 'current composition'}". Discard changes and load new preset?`);
    if (!ok) {
      templateSelect.value = currentLoadedPresetName ? `custom:${currentLoadedPresetName}` : '';
      return;
    }
  }

  // Check if it's a custom saved preset
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
  setCompositionDirty(false);
  renderLayerMixer();
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
  setCompositionDirty(true);
});

// Global Floating Tooltip Popover & Contextual Hover Descriptions
const DEFAULT_HELP = 'Hover over any setting for details';
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

// ==========================================================================
// Scroll-to-Modify Sliders and Number Inputs
// ==========================================================================
// Allows users to hover over any range slider or numeric value input and scroll
// the mouse wheel / trackpad to quickly nudge and scrub values up/down.
document.addEventListener('wheel', (e: WheelEvent) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;

  const sliderOrNumber = target.closest('input[type="range"], input[type="number"]') as HTMLInputElement | null;
  if (!sliderOrNumber || sliderOrNumber.disabled) return;

  // Prevent default page or parent container scrolling while modifying the slider
  e.preventDefault();
  e.stopPropagation();

  const min = sliderOrNumber.min !== '' ? parseFloat(sliderOrNumber.min) : 0;
  const max = sliderOrNumber.max !== '' ? parseFloat(sliderOrNumber.max) : 100;
  const step = sliderOrNumber.step !== '' && sliderOrNumber.step !== 'any' ? parseFloat(sliderOrNumber.step) : 1;
  const currentVal = parseFloat(sliderOrNumber.value);
  if (isNaN(currentVal)) return;

  // Determine direction: scrolling up (deltaY < 0 or deltaX > 0) increases value;
  // scrolling down (deltaY > 0 or deltaX < 0) decreases value.
  const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? -e.deltaY : e.deltaX;
  if (delta === 0) return;

  // Determine number of decimal places to prevent floating point inaccuracy
  const stepStr = step.toString();
  const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;

  // Multiplier: Holding Shift gives 5x speed for faster scrubbing, Alt gives 1x fine tune
  const speedMultiplier = e.shiftKey ? 5 : 1;
  const stepIncrement = (delta > 0 ? 1 : -1) * step * speedMultiplier;

  let nextVal = currentVal + stepIncrement;
  nextVal = Math.max(min, Math.min(max, nextVal));
  if (decimals > 0) {
    nextVal = parseFloat(nextVal.toFixed(decimals));
  } else {
    nextVal = Math.round(nextVal);
  }

  if (nextVal !== currentVal) {
    sliderOrNumber.value = nextVal.toString();
    // Dispatch input and change events so all listeners update the audio, labels, and state
    sliderOrNumber.dispatchEvent(new Event('input', { bubbles: true }));
    sliderOrNumber.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, { passive: false });

// Musical Scale and Root Listeners
scaleSelect.addEventListener('change', () => {
  const scale = SCALES[scaleSelect.value];
  if (scale) {
    quantizer.updateConfig({ scale });
    updatePitchNavigator();
    setCompositionDirty(true);
  }
});

rootSelect.addEventListener('change', () => {
  const root = ROOT_NOTES[rootSelect.value];
  if (root) {
    quantizer.updateConfig({ root });
    updatePitchNavigator();
    setCompositionDirty(true);
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
        setCompositionDirty(true);
        updateTrackActionsVisibility();
        renderLayerMixer();
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
  setCompositionDirty(true);
});

// Space (Master Reverb Room Depth) Slider
spaceSlider?.addEventListener('input', () => {
  const val = parseInt(spaceSlider.value, 10);
  spaceVal.textContent = `${val}%`;
  soundEngine.setReverbMix(val / 100);
  if (studioMasterReverbSlider) studioMasterReverbSlider.value = val.toString();
  if (studioMasterReverbVal) studioMasterReverbVal.textContent = `${val}%`;
  setCompositionDirty(true);
});

// Reverb Space Model
reverbTypeSelect?.addEventListener('change', () => {
  if (!reverbTypeSelect) return;
  const type = reverbTypeSelect.value as ReverbType;
  soundEngine.setReverbType(type);
  if (studioReverbTypeSelect) studioReverbTypeSelect.value = type;
  setCompositionDirty(true);
});

// Stereo Field Dimension Slider
stereoWidthSlider?.addEventListener('input', () => {
  if (!stereoWidthSlider) return;
  const pct = parseInt(stereoWidthSlider.value, 10);
  soundEngine.setStereoWidth(pct / 100);
  const text = pct === 100 ? '100% (Stereo)' : (pct === 0 ? '0% (Mono)' : `${pct}%`);
  if (stereoWidthVal) stereoWidthVal.textContent = text;
  if (studioStereoWidthSlider) studioStereoWidthSlider.value = pct.toString();
  if (studioStereoWidthVal) studioStereoWidthVal.textContent = text;
  setCompositionDirty(true);
});

// Tape Warmth & Saturation Slider
tapeWarmthSlider?.addEventListener('input', () => {
  if (!tapeWarmthSlider) return;
  const pct = parseInt(tapeWarmthSlider.value, 10);
  soundEngine.setTapeWarmth(pct / 100);
  const text = pct === 0 ? '0% (Clean)' : `${pct}%`;
  if (tapeWarmthVal) tapeWarmthVal.textContent = text;
  if (studioTapeWarmthSlider) studioTapeWarmthSlider.value = pct.toString();
  if (studioTapeWarmthVal) studioTapeWarmthVal.textContent = text;
  setCompositionDirty(true);
});

// Sidechain Ducking Pump Slider
duckingSlider?.addEventListener('input', () => {
  if (!duckingSlider) return;
  const pct = parseInt(duckingSlider.value, 10);
  soundEngine.setDuckingDepth(pct / 100);
  const text = pct === 0 ? '0% (Off)' : `${pct}%`;
  if (duckingVal) duckingVal.textContent = text;
  if (studioDuckingSlider) studioDuckingSlider.value = pct.toString();
  if (studioDuckingVal) studioDuckingVal.textContent = text;
  setCompositionDirty(true);
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
  targetScrollY = quantizer.scrollY;

  updatePitchNavigator();
  updateStats();
  if (strokeManager.selectedStrokeId) {
    updateTrackActionsVisibility();
  }
});

// Track Inspector Volume / Timing / Traversal / Wave Reshape / Mute / Solo / Delete Controls
function updateTrackActionsVisibility(): void {
  updateMixerSelection();
  const selectedId = strokeManager.selectedStrokeId;
  const currentView = typeof viewModeManager !== 'undefined' ? viewModeManager.getMode() : 'studio';

  if (selectedId) {
    if (studioTabBtnMaster?.classList.contains('active')) {
      switchStudioDeckTab('mixer');
    }
    statMode.textContent = 'Line Selected';
    const stroke = strokeManager.activeStrokes.find((s) => s.id === selectedId);

    if (currentView === 'studio') {
      trackInspectorBar.style.display = 'none';
      trackInspectorBar.classList.add('hidden');
      updateStudioDockedInspector();
    } else if (currentView === 'zen') {
      trackInspectorBar.style.display = 'none';
      trackInspectorBar.classList.add('hidden');
      updateZenContextPill(stroke);
    } else {
      trackInspectorBar.style.display = 'flex';
      trackInspectorBar.classList.remove('hidden');
    }

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
    updateStudioDockedInspector();
    updateZenContextPill();
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
  applyGeneralSync(generalSyncSelect.value);
  setCompositionDirty(true);
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
    syncCompositionState();
  }
});

muteBtn.addEventListener('click', () => {
  if (strokeManager.selectedStrokeId) {
    strokeManager.toggleMute(strokeManager.selectedStrokeId);
    syncCompositionState();
  }
});

soloBtn.addEventListener('click', () => {
  if (strokeManager.selectedStrokeId) {
    strokeManager.toggleSolo(strokeManager.selectedStrokeId);
    syncCompositionState();
  }
});

duplicateTrackBtn?.addEventListener('click', () => {
  if (strokeManager.selectedStrokeId) {
    const newStroke = strokeManager.duplicateSelected(quantizer, renderer.height);
    if (newStroke) {
      if (soundEngine.isReady) {
        strokeManager.activateAudioVoices();
      }
      syncCompositionState();
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
  syncCompositionState();
});

clearBtn.addEventListener('click', () => {
  if (isCompositionDirty && strokeManager.activeStrokes.length > 0) {
    const ok = confirm('You have unsaved changes in your composition. Are you sure you want to clear the canvas?');
    if (!ok) return;
  }
  strokeManager.clearAll();
  templateSelect.value = '';
  currentLoadedPresetName = '';
  setCompositionDirty(false);
  updateStats();
  updateTrackActionsVisibility();
  renderLayerMixer();
  renderStudioMixer();
  try {
    if (typeof sceneManager !== 'undefined') {
      sceneManager.updateCurrentScene({
        strokes: [],
      });
      if (typeof renderSceneCards === 'function') {
        renderSceneCards();
      }
    }
  } catch {}
});

// Global Toast Notification Helper
function showToast(message: string, durationMs: number = 2400): void {
  let toastEl = document.getElementById('appToast') as HTMLDivElement | null;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'appToast';
    toastEl.className = 'app-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('is-visible');
  setTimeout(() => {
    toastEl?.classList.remove('is-visible');
  }, durationMs);
}

// Shortcuts Cheat Sheet Modal Handlers
function openShortcutsModal(): void {
  shortcutsModal?.classList.remove('hidden');
}

function closeShortcutsModal(): void {
  shortcutsModal?.classList.add('hidden');
}

shortcutsBtn?.addEventListener('click', openShortcutsModal);
closeShortcutsModalBtn?.addEventListener('click', closeShortcutsModal);
shortcutsModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeShortcutsModal);

const PROD_BASE_URL = 'https://generative-music-drawing.vercel.app';

function buildCurrentCompositionExport(): SavedComposition {
  const comp = strokeManager.exportComposition(
    currentLoadedPresetName || 'Shared Score',
    scaleSelect ? scaleSelect.value : 'dorian',
    rootSelect ? rootSelect.value : 'D2',
    renderer.width,
    renderer.height
  );
  comp.spaceReverb = soundEngine.reverbMix;
  comp.octaveSpan = parseInt(octavesSlider.value, 10);
  comp.scrollY = quantizer.scrollY;
  if (xAxisSelect) {
    comp.xAxisModulationMode = xAxisSelect.value as XAxisModulationMode;
  }
  if (breathingSelect) {
    comp.breathingMode = breathingSelect.value as BreathingMode;
  }
  if (defaultHarmonizerSelect) {
    comp.defaultHarmonizer = defaultHarmonizerSelect.value as HarmonizerMode;
  }
  if (generalSyncSelect) {
    comp.defaultTiming = generalSyncSelect.value;
  }
  return comp;
}

// Shareable Composition Link - Stores to persistent DB on deployed app and returns clean URL
async function createShareableLink(): Promise<string> {
  const comp = buildCurrentCompositionExport();

  // Try storing to API backend first
  try {
    const apiUrl = window.location.hostname.includes('vercel.app')
      ? '/api/track'
      : `${PROD_BASE_URL}/api/track`;

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(comp),
    });

    if (resp.ok) {
      const result = await resp.json();
      if (result && result.id) {
        return `${PROD_BASE_URL}/?track=${encodeURIComponent(result.id)}`;
      }
    }
  } catch (err) {
    console.warn('API share save failed, using encoded fallback:', err);
  }

  // Fallback: direct deployed URL with clean score hash
  const jsonStr = JSON.stringify(comp);
  const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(jsonStr))));
  return `${PROD_BASE_URL}/#score=${encoded}`;
}

shareLinkBtn?.addEventListener('click', async () => {
  try {
    showToast('Generating shareable link...');
    const shareUrl = await createShareableLink();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Score link copied to clipboard!');
    } else {
      prompt('Copy your score link:', shareUrl);
    }
  } catch (err) {
    showToast('Could not copy link to clipboard');
  }
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
  targetScrollY = quantizer.scrollY;
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
  setCompositionDirty(true);
});

trackHarmonizerSelect?.addEventListener('change', () => {
  const selectedId = strokeManager.selectedStrokeId;
  if (!selectedId || !trackHarmonizerSelect) return;
  const mode = trackHarmonizerSelect.value as HarmonizerMode;
  strokeManager.setStrokeHarmonizer(selectedId, mode, true);
  setCompositionDirty(true);
  updateStats();
  renderLayerMixer();
});

// Organic Timbral Breathing Control (Option 3)
breathingSelect?.addEventListener('change', () => {
  if (!breathingSelect) return;
  const mode = breathingSelect.value as BreathingMode;
  strokeManager.setBreathingMode(mode);
  setCompositionDirty(true);
});

// Warn user if leaving with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (isCompositionDirty && strokeManager.activeStrokes.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Fast Forward & Rewind Scrubber State
let isFastForwardHeld = false;
let isRewindHeld = false;

function isFastForwardKey(e: KeyboardEvent): boolean {
  return (
    (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey
  );
}

function isRewindKey(e: KeyboardEvent): boolean {
  return (
    (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey
  );
}

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement | null;
  const isTextInput = target && (
    (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range' && (target as HTMLInputElement).type !== 'checkbox') ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
  if (isTextInput) {
    return;
  }

  // Fast-forward (+) and Rewind (-) continuous scrub holding
  if (isFastForwardKey(e)) {
    e.preventDefault();
    if (!isFastForwardHeld) {
      isFastForwardHeld = true;
      if (statMode) {
        statMode.textContent = strokeManager.selectedStrokeId ? 'Fast Forwarding (4x)' : 'Fast Forwarding All (4x)';
        statMode.style.color = '#2563eb';
      }
    }
    return;
  }

  if (isRewindKey(e)) {
    e.preventDefault();
    if (!isRewindHeld) {
      isRewindHeld = true;
      if (statMode) {
        statMode.textContent = strokeManager.selectedStrokeId ? 'Rewinding (4x)' : 'Rewinding All (4x)';
        statMode.style.color = '#2563eb';
      }
    }
    return;
  }

  // View Mode Shortcut: V cycles through Studio -> Zen -> Scenes -> Studio
  if (e.key.toLowerCase() === 'v' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    viewModeManager.cycleNextMode();
    return;
  }

  // Quick Save: Cmd+S / Ctrl+S
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && !e.shiftKey) {
    e.preventDefault();
    executeQuickSave();
    return;
  }

  // Toggle Layers Mixer: M key when no stroke is selected
  if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey && !strokeManager.selectedStrokeId) {
    e.preventDefault();
    layersToggleBtn?.click();
    return;
  }

  // 1. Play / Pause toggle shortcuts: Spacebar or P
  if (e.code === 'Space' || e.key.toLowerCase() === 'p') {
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
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
    syncCompositionState();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    strokeManager.redo();
    syncCompositionState();
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
        syncCompositionState();
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
        syncCompositionState();
      }
      return;
    }
  }

  // 3. Delete / Backspace: delete selected stroke
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (strokeManager.selectedStrokeId) {
      e.preventDefault();
      strokeManager.deleteSelected();
      syncCompositionState();
      return;
    }
  }

  // 4. Escape: Close modals, close controls drawer, or deselect active stroke
  if (e.key === 'Escape') {
    if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) {
      closeShortcutsModal();
      return;
    }
    if (recordModal && !recordModal.classList.contains('hidden')) {
      closeRecordModal();
      return;
    }
    if (advancedDrawer && advancedDrawer.style.display !== 'none') {
      setDrawerOpen(false);
      return;
    }
    if (strokeManager.selectedStrokeId) {
      strokeManager.selectStroke(null);
      updateTrackActionsVisibility();
      return;
    }
  }

  // Question mark (?): open shortcuts modal
  if ((e.key === '?' || (e.shiftKey && e.key === '/')) && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    openShortcutsModal();
    return;
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

  // Live Play mode toggle shortcut: L
  if (e.key.toLowerCase() === 'l') {
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

  // 7. Traversal toggle shortcut: T (Straight / Bounce)
  if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const targetStrokeId = strokeManager.selectedStrokeId || (strokeManager.activeStrokes.length === 1 ? strokeManager.activeStrokes[0].id : null);
    if (targetStrokeId) {
      const stroke = strokeManager.activeStrokes.find((s) => s.id === targetStrokeId);
      if (stroke) {
        const currentTrav = (stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong') ? 'bounce' : 'restart';
        const nextTrav: TraversalMode = currentTrav === 'bounce' ? 'restart' : 'bounce';
        strokeManager.setStrokeTraversal(stroke.id, nextTrav);
        setCompositionDirty(true);
        updateTrackActionsVisibility();
        renderLayerMixer();
        return;
      }
    }
    // If no stroke is selected, toggle the default traversal mode for future strokes
    const nextDefTrav: TraversalMode = strokeManager.mode === 'bounce' ? 'restart' : 'bounce';
    strokeManager.setTraversalMode(nextDefTrav);
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
  if (e.key === '[' || e.key === ']' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const targetStrokeId = strokeManager.selectedStrokeId || (strokeManager.activeStrokes.length === 1 ? strokeManager.activeStrokes[0].id : null);
    if (targetStrokeId) {
      const stroke = strokeManager.activeStrokes.find((s) => s.id === targetStrokeId);
      if (stroke) {
        e.preventDefault();
        const currentVol = stroke.volume ?? 1.0;
        const delta = (e.key === ']' || e.key === 'ArrowUp') ? 0.05 : -0.05;
        const nextVol = Math.max(0, Math.min(1, Math.round((currentVol + delta) * 100) / 100));
        strokeManager.setStrokeVolume(stroke.id, nextVol, true);
        setCompositionDirty(true);
        updateTrackActionsVisibility();
        renderLayerMixer();
      }
    }
  }

  // 10b. Speed / Timing adjustment for selected stroke: Left = -0.1x / -5s, Right = +0.1x / +5s
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const targetStrokeId = strokeManager.selectedStrokeId || (strokeManager.activeStrokes.length === 1 ? strokeManager.activeStrokes[0].id : null);
    if (targetStrokeId) {
      const stroke = strokeManager.activeStrokes.find((s) => s.id === targetStrokeId);
      if (stroke) {
        e.preventDefault();
        const isTimer = stroke.timingMode === 'timer' || stroke.speedMode === 'timer';
        if (isTimer) {
          const currentDur = Math.round(stroke.duration ?? 30);
          const delta = e.key === 'ArrowRight' ? 5 : -5;
          const nextDur = Math.max(1, Math.min(300, currentDur + delta));
          strokeManager.setStrokeDuration(stroke.id, nextDur, true);
        } else {
          const currentSpeed = stroke.speedMultiplier ?? 1.0;
          const delta = e.key === 'ArrowRight' ? 0.1 : -0.1;
          const nextSpeed = Math.max(0.1, Math.min(5.0, Math.round((currentSpeed + delta) * 10) / 10));
          strokeManager.setStrokeSpeed(stroke.id, nextSpeed, true);
        }
        setCompositionDirty(true);
        updateTrackActionsVisibility();
        renderLayerMixer();
      }
    }
  }

  // 11. Frequency Field Scrolling: PageUp (Higher pitches), PageDown (Lower pitches), Home (Mid register)
  if (e.key === 'PageUp') {
    e.preventDefault();
    smoothScrollBy(-quantizer.getPxPerOctave(renderer.height));
    return;
  }
  if (e.key === 'PageDown') {
    e.preventDefault();
    smoothScrollBy(quantizer.getPxPerOctave(renderer.height));
    return;
  }
  if (e.key === 'Home') {
    e.preventDefault();
    smoothScrollTo(quantizer.getDefaultScrollY(renderer.height));
    return;
  }
});

window.addEventListener('keyup', (e: KeyboardEvent) => {
  if (isFastForwardKey(e) || e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') {
    isFastForwardHeld = false;
    if (statMode && !isRewindHeld) {
      statMode.textContent = strokeManager.selectedStrokeId ? 'Line Selected (Edit)' : 'Draw / Click to Select';
      statMode.style.color = strokeManager.selectedStrokeId ? '#2563eb' : 'inherit';
    }
  }
  if (isRewindKey(e) || e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
    isRewindHeld = false;
    if (statMode && !isFastForwardHeld) {
      statMode.textContent = strokeManager.selectedStrokeId ? 'Line Selected (Edit)' : 'Draw / Click to Select';
      statMode.style.color = strokeManager.selectedStrokeId ? '#2563eb' : 'inherit';
    }
  }
});

window.addEventListener('blur', () => {
  isFastForwardHeld = false;
  isRewindHeld = false;
  if (statMode) {
    statMode.textContent = strokeManager.selectedStrokeId ? 'Line Selected (Edit)' : 'Draw / Click to Select';
    statMode.style.color = strokeManager.selectedStrokeId ? '#2563eb' : 'inherit';
  }
});

// Audio Unlock & Welcome Banner Dismissal on First Interaction
window.addEventListener('pointerdown', async () => {
  dismissWelcomePrompt();
  if (!soundEngine.isReady) {
    await soundEngine.init();
    LiveRecorder.preloadWorklet(soundEngine.context);
    strokeManager.activateAudioVoices();
    statAudio.textContent = 'Audio: Active';
    statAudio.classList.add('chip-ready');
  }
  setTimeout(updateTrackActionsVisibility, 50);
}, { once: false });

window.addEventListener('click', () => {
  dismissWelcomePrompt();
}, { once: false });

window.addEventListener('pointerup', () => {
  if (strokeManager.selectedStrokeId) {
    updateTrackActionsVisibility();
  }
  // Auto-blur clicked buttons and range sliders so keyboard shortcuts (Space / P) are never trapped
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    if (active.tagName === 'BUTTON' || (active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'range')) {
      active.blur();
    }
  }
});

// Auto-blur select dropdowns on change
document.addEventListener('change', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && t.tagName === 'SELECT') {
    t.blur();
  }
});

window.addEventListener('resize', handleResize);

function updateStats(): void {
  const count = strokeManager.activeStrokes.length;
  statStrokes.textContent = `${count} ${count === 1 ? 'stroke' : 'strokes'}`;
}

// Animation & Sequencer Loop with Smooth Frame-Delta Filtering
let lastTimeMs = 0;
let smoothedDt = 1 / 60;

function animationLoop(nowMs: number): void {
  if (lastTimeMs === 0) {
    lastTimeMs = nowMs;
  }
  const rawDt = (nowMs - lastTimeMs) / 1000;
  lastTimeMs = nowMs;

  // Filter delta-time: if huge stutter or tab backgrounded (>120ms), reset smooth baseline
  if (rawDt > 0.12) {
    smoothedDt = 1 / 60;
  } else {
    // Clamp minor frame-timing variances and smooth with exponential moving average
    const clampedDt = Math.max(0.001, Math.min(0.064, rawDt));
    smoothedDt = smoothedDt * 0.75 + clampedDt * 0.25;
  }

  // 0. Smooth Kinetic Inertial Scrolling for Pitch Register
  if (isScrollAnimating || Math.abs(targetScrollY - quantizer.scrollY) > 0.05) {
    // Damped exponential lerp (lambda = 16 for silky fast response with natural momentum decay)
    const lerpFactor = 1 - Math.exp(-16 * smoothedDt);
    quantizer.scrollY += (targetScrollY - quantizer.scrollY) * lerpFactor;
    if (Math.abs(targetScrollY - quantizer.scrollY) < 0.05) {
      quantizer.scrollY = targetScrollY;
      isScrollAnimating = false;
    }
    updatePitchNavigator();
  }

  // 1. Update constant-velocity playheads, Y pitch, X stereo modulation, and measure progress
  strokeManager.update(smoothedDt, renderer.width, renderer.height, quantizer);

  // 1a. Fast-forward / rewind scrub when + or - key is held
  if (isFastForwardHeld && !isRewindHeld) {
    strokeManager.scrubStroke(strokeManager.selectedStrokeId, 4.0, smoothedDt, renderer.width, renderer.height, quantizer);
  } else if (isRewindHeld && !isFastForwardHeld) {
    const rewindRate = strokeManager.paused ? -4.0 : -5.0;
    strokeManager.scrubStroke(strokeManager.selectedStrokeId, rewindRate, smoothedDt, renderer.width, renderer.height, quantizer);
  }

  // 1b. Update Scene Arranger progression sequence if active
  if (typeof sceneManager !== 'undefined' && sceneManager.isSequencing()) {
    // Only advance sequence timer when playing (not paused)!
    if (!strokeManager.paused) {
      const seq = sceneManager.tickSequence(smoothedDt);

      if (seq.sceneChanged) {
        if (strokeManager.isCrossfadingMorph) {
          strokeManager.updateSceneCrossfade(1.0);
          strokeManager.completeSceneCrossfade();
        } else {
          loadScene(seq.currentScene);
        }

        // Update quantizer scale and root to the new scene
        if (seq.currentScene.scaleId || seq.currentScene.rootId) {
          const scaleKey = (seq.currentScene.scaleId || 'dorian') as keyof typeof SCALES;
          const scaleObj = SCALES[scaleKey] || SCALES.dorian;
          const rootKey = (seq.currentScene.rootId || 'D2') as keyof typeof ROOT_NOTES;
          const rootObj = ROOT_NOTES[rootKey] || ROOT_NOTES.D2;
          quantizer.updateConfig({
            scale: scaleObj,
            root: rootObj,
          });
          if (scaleSelect) scaleSelect.value = seq.currentScene.scaleId || 'dorian';
          if (rootSelect) rootSelect.value = seq.currentScene.rootId || 'D2';
          updatePitchNavigator();
        }

        // Finalize BPM and Reverb
        strokeManager.setBpm(seq.currentScene.bpm || 32);
        bpmSlider.value = (seq.currentScene.bpm || 32).toString();
        bpmVal.textContent = `${seq.currentScene.bpm || 32} BPM`;
        statTempo.textContent = `${seq.currentScene.bpm || 32} BPM`;

        const targetRev = seq.currentScene.spaceReverb ?? 0.65;
        soundEngine.setReverbMix(targetRev);
        if (spaceSlider) spaceSlider.value = Math.round(targetRev * 100).toString();
        if (spaceVal) spaceVal.textContent = `${Math.round(targetRev * 100)}%`;

        currentLoadedPresetName = seq.currentScene.name;
        renderStudioMixer();
        renderLayerMixer();
        updateStats();
        renderSceneCards();
      } else if (seq.isMorphing && seq.nextScene) {
        // 1. Start overlapping crossfade if not yet started
        if (!strokeManager.isCrossfadingMorph) {
          const nextComp: SavedComposition = {
            version: 1,
            name: seq.nextScene.name,
            timestamp: Date.now(),
            bpm: seq.nextScene.bpm || 32,
            scaleId: seq.nextScene.scaleId || 'dorian',
            rootId: seq.nextScene.rootId || 'D2',
            spaceReverb: seq.nextScene.spaceReverb ?? 0.65,
            xAxisModulationMode: seq.nextScene.xAxisModulationMode || 'panAndTone',
            strokes: JSON.parse(JSON.stringify(seq.nextScene.strokes || [])),
          };
          const morphCurve = sceneManager.getMorphCurveMode();
          strokeManager.startSceneCrossfade(
            nextComp,
            quantizer,
            renderer.height,
            renderer.width,
            morphCurve,
            seq.nextScene.id
          );
        }

        // 2. Update crossfade gains each frame (equal power / reverb wash / linear)
        const { reverbBoost } = strokeManager.updateSceneCrossfade(seq.morphRatio);

        // 3. Smoothly interpolate BPM
        const curBpm = seq.currentScene.bpm || 32;
        const nextBpm = seq.nextScene.bpm || 32;
        const interpolatedBpm = Math.round(curBpm + (nextBpm - curBpm) * seq.morphRatio);
        if (strokeManager.currentBpm !== interpolatedBpm) {
          strokeManager.setBpm(interpolatedBpm);
          bpmVal.textContent = `${interpolatedBpm} BPM`;
          statTempo.textContent = `${interpolatedBpm} BPM`;
        }

        // 4. Smoothly interpolate Space Reverb + add reverbBoost if in reverbWash mode
        const curRev = seq.currentScene.spaceReverb ?? 0.65;
        const nextRev = seq.nextScene.spaceReverb ?? 0.65;
        const baseRev = curRev + (nextRev - curRev) * seq.morphRatio;
        const finalRev = Math.max(0, Math.min(1, baseRev + reverbBoost));
        soundEngine.setReverbMix(finalRev);
        if (spaceVal) spaceVal.textContent = `${Math.round(finalRev * 100)}%`;
      } else {
        if (strokeManager.isCrossfadingMorph) {
          strokeManager.cancelSceneCrossfade();
        }
      }

      // Update active scene progress bar
      const activeProgressBar = document.getElementById(`progress_${seq.currentScene.id}`);
      if (activeProgressBar) {
        activeProgressBar.style.width = `${(seq.progressRatio * 100).toFixed(1)}%`;
      }

      // Update card morph state & badge
      const activeCardEl = document.querySelector(`.scene-card[data-scene-id="${seq.currentScene.id}"]`);
      if (activeCardEl) {
        activeCardEl.classList.toggle('is-morphing', seq.isMorphing);
      }
      const activeBadgeEl = document.getElementById(`badge_${seq.currentScene.id}`);
      if (activeBadgeEl) {
        if (seq.isMorphing) {
          activeBadgeEl.className = 'scene-card-morph-badge';
          const curveLabel = sceneManager.getMorphCurveMode() === 'reverbWash' ? 'Atmospheric Morph' : 'Crossfade Overlap';
          activeBadgeEl.textContent = `${curveLabel} ${Math.round(seq.morphRatio * 100)}%`;
        } else {
          activeBadgeEl.className = 'scene-card-badge';
          activeBadgeEl.textContent = 'Active';
        }
      }

      // Update Minimalist HUD Indicator for other views (Studio & Zen)
      updateSeqMiniIndicator(seq);
    }
  } else {
    if (seqMiniIndicator) seqMiniIndicator.style.display = 'none';
  }

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

  // 6. Update & Draw Dynamic Particle Sparks
  renderer.updateAndDrawParticles(smoothedDt);

  // 7. Audio-Reactive Ambient Spectrum & Glow
  if (soundEngine.isReady) {
    const freqData = soundEngine.getFrequencyData();
    const masterEnergy = soundEngine.getMasterEnergy();
    renderer.drawAudioReactiveSpectrum(freqData, masterEnergy);
  }

  requestAnimationFrame(animationLoop);
}

// Wire Spark Emitter to StrokeManager Trigger Hits
strokeManager.onTriggerSpark = (x: number, y: number, color: string, count = 6, instrumentId?: string) => {
  // If instrument is melodic, convert world coordinate y to viewport screen y
  const screenY = instrumentId === 'onyx' ? y : quantizer.worldToScreenY(y, renderer.height);
  renderer.spawnSparks(x, screenY, color, count);
};

// Also emit sparks when drawing live wand notes
inputHandler.onLiveTrigger = (x: number, y: number, color: string) => {
  renderer.spawnSparks(x, y, color, 8, 1.2);
};

// URL Composition Loader (?track=... or #score=...)
async function checkSharedCompositionUrl(): Promise<boolean> {
  // 1. Check for ?track=<id> query parameter (Database-backed track)
  const urlParams = new URLSearchParams(window.location.search);
  const trackId = urlParams.get('track');
  if (trackId) {
    try {
      showToast('Loading shared track...');
      const apiUrl = window.location.hostname.includes('vercel.app')
        ? `/api/track?id=${encodeURIComponent(trackId)}`
        : `${PROD_BASE_URL}/api/track?id=${encodeURIComponent(trackId)}`;

      const resp = await fetch(apiUrl);
      if (resp.ok) {
        const json = await resp.json();
        const scoreData = (json && json.data) ? json.data : json;
        if (scoreData && Array.isArray(scoreData.strokes)) {
          await loadComposition(scoreData);
          showToast(`Loaded score "${scoreData.name || 'Shared Score'}"`);
          return true;
        }
      }
    } catch (err) {
      console.warn('Failed to load track from DB:', err);
    }
  }

  // 2. Fallback to #score=<encoded> hash if present
  const hash = window.location.hash;
  if (hash.startsWith('#score=')) {
    try {
      const encoded = hash.replace('#score=', '');
      const jsonStr = decodeURIComponent(escape(atob(decodeURIComponent(encoded))));
      const parsedComp = JSON.parse(jsonStr) as SavedComposition;
      if (parsedComp && Array.isArray(parsedComp.strokes)) {
        await loadComposition(parsedComp);
        showToast(`Loaded score "${parsedComp.name || 'Shared Score'}"`);
        return true;
      }
    } catch (e) {
      console.error('Failed to unpack URL score:', e);
    }
  }

  return false;
}

// Start
renderer.resize();
prevCanvasWidth = renderer.width;
prevCanvasHeight = renderer.height;
quantizer.resetScrollToDefault(renderer.height);
targetScrollY = quantizer.scrollY;
updatePitchNavigator();

(async () => {
  const loadedFromUrl = await checkSharedCompositionUrl();
  if (!loadedFromUrl) {
    loadTemplate('cathedralSolitude', false);
  }
  targetScrollY = quantizer.scrollY;
  updateStats();
  updateTrackActionsVisibility();
  requestAnimationFrame(animationLoop);
})();
