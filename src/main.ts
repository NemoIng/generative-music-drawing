import './style.css';
import { ScaleQuantizer } from './audio/scaleQuantizer';
import { SCALES, ROOT_NOTES } from './audio/scales';
import { StrokeManager } from './engine/strokeManager';
import { CanvasRenderer } from './canvas/renderer';
import { InputHandler, DrawShape } from './canvas/inputHandler';
import {
  DrawnStroke,
  StrokeStyle,
  TraversalMode,
  HarmonizerMode,
  BreathingMode,
  XAxisModulationMode,
  SavedComposition,
} from './engine/types';
import { INSTRUMENTS, DEFAULT_INSTRUMENT, getInstrument, getInstrumentColor } from './audio/instruments';
import { TEMPLATES, buildTemplateStrokes } from './audio/templates';
import { soundEngine, ReverbType } from './audio/audioContext';
import { SplinePath, Point2D } from './math/types';
import { LiveRecorder } from './audio/mp3Export';
import { ViewModeManager, ViewMode } from './ui/viewModes';
import { SceneManager, SceneData, SceneSequenceTickResult } from './engine/sceneManager';
import { generateAssistedStrokes, AssistedLineCount, AssistedInstrumentMode } from './engine/assistedDrawing';
import {
  STORAGE_KEYS,
  readStorageKey,
  writeStorageKey,
  loadSavedPresets,
  savePreset,
} from './ui/storage';
import { showToast } from './ui/toast';
import { createShareUrl, decodeCompositionBase64Url, fetchSharedTrack } from './ui/shareService';
import { bindSliderUndo } from './ui/sliderUndo';
import { createKeydownHandler } from './ui/shortcuts';
import { PresetModalController } from './ui/presetModalController';
import { RecordExportController } from './ui/recordExportController';
import { SceneUiController } from './ui/sceneUiController';
import { StudioDeckController } from './ui/studioDeckController';
import { activateModalFocusTrap } from './ui/modalFocus';
import { showConfirmDialog, isConfirmDialogOpen, cancelConfirmDialog } from './ui/confirmModal';
import { OnboardingController } from './ui/onboarding';
import { ABSnapshotManager } from './ui/abSnapshot';
import { midiController } from './audio/midiController';

// DOM Elements
const canvasEl = document.getElementById('musicCanvas') as HTMLCanvasElement;
const templateSelect = document.getElementById('templateSelect') as HTMLSelectElement;
const loadTemplateFileBtn = document.getElementById('loadTemplateFileBtn') as HTMLButtonElement;
const topLoadPresetBtn = document.getElementById('topLoadPresetBtn') as HTMLButtonElement | null;
const loadFileInput = document.getElementById('loadFileInput') as HTMLInputElement;

let currentLoadedPresetName: string | null = 'Cathedral of Solitude';
let currentLoadedTemplateId = 'cathedralSolitude';

const shapeButtons = document.querySelectorAll<HTMLButtonElement>('#shapeControl .seg-btn');
const autoSmoothBtn = document.getElementById('autoSmoothBtn') as HTMLButtonElement;
const snapPitchBtn = document.getElementById('snapPitchBtn') as HTMLButtonElement;
const assistToggleBtn = document.getElementById('assistToggleBtn') as HTMLButtonElement | null;
const assistCountControl = document.getElementById('assistCountControl') as HTMLDivElement | null;
const assistCountButtons = document.querySelectorAll<HTMLButtonElement>('#assistCountControl .seg-btn');
const assistInkModeBtn = document.getElementById('assistInkModeBtn') as HTMLButtonElement | null;
const drawerAssistToggleBtn = document.getElementById('drawerAssistToggleBtn') as HTMLButtonElement | null;
const drawerAssistCountSelect = document.getElementById('drawerAssistCountSelect') as HTMLSelectElement | null;
const drawerAssistInkSelect = document.getElementById('drawerAssistInkSelect') as HTMLSelectElement | null;
const swatchButtons = document.querySelectorAll<HTMLButtonElement>('#instrumentPalette .swatch-btn');
const xAxisSelect = document.getElementById('xAxisSelect') as HTMLSelectElement;
const scaleSelect = document.getElementById('scaleSelect') as HTMLSelectElement;
const rootSelect = document.getElementById('rootSelect') as HTMLSelectElement;
const generalSyncSelect = document.getElementById('generalSyncSelect') as HTMLSelectElement;
const scoreTimingBadge = document.getElementById('scoreTimingBadge') as HTMLSpanElement | null;
const appModeButtons = document.querySelectorAll<HTMLButtonElement>('[data-app-mode]');
const strokeModeButtons = document.querySelectorAll<HTMLButtonElement>('#strokeModeControl .seg-btn');
const bpmSlider = document.getElementById('bpmSlider') as HTMLInputElement;
const bpmVal = document.getElementById('bpmVal') as HTMLSpanElement;
const spaceSlider = document.getElementById('spaceSlider') as HTMLInputElement;
const spaceVal = document.getElementById('spaceVal') as HTMLSpanElement;
const octavesSlider = document.getElementById('octavesSlider') as HTMLInputElement;
const octavesVal = document.getElementById('octavesVal') as HTMLSpanElement;
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
const replayTourBtn = document.getElementById('replayTourBtn') as HTMLButtonElement | null;
const shareLinkBtn = document.getElementById('shareLinkBtn') as HTMLButtonElement | null;
const audioUnlockPrompt = document.getElementById('audioUnlockPrompt') as HTMLDivElement | null;
const startAudioBannerBtn = document.getElementById('startAudioBannerBtn') as HTMLButtonElement | null;

const statMode = document.getElementById('statMode') as HTMLSpanElement | null;
const statAudio = document.getElementById('statAudio') as HTMLButtonElement | HTMLSpanElement | null;
const contextHelp = document.getElementById('contextHelp') as HTMLSpanElement;
const defaultHarmonizerSelect = document.getElementById('defaultHarmonizerSelect') as HTMLSelectElement | null;
const breathingControlGroup = document.getElementById('breathingControlGroup') as HTMLElement | null;
const breathingSelect = document.getElementById('breathingSelect') as HTMLSelectElement | null;

// Layers Mixer & Presets Dirty State Controls
const layerCountBadge = document.getElementById('layerCountBadge') as HTMLSpanElement | null;
const dirtyIndicator = document.getElementById('dirtyIndicator') as HTMLSpanElement | null;

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

const studioLayerCount = document.getElementById('studioLayerCount') as HTMLSpanElement | null;

// Minimalist Running Sequence HUD
const seqMiniIndicator = document.getElementById('seqMiniIndicator') as HTMLElement | null;

// Studio Master Controls (value mirroring from Drawer / syncMasterFxUI)
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
const studioBreathingSelect = document.getElementById('studioBreathingSelect') as HTMLSelectElement | null;

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
const zenContextRedrawBtn = document.getElementById('zenContextRedrawBtn') as HTMLButtonElement | null;
const zenContextMuteBtn = document.getElementById('zenContextMuteBtn') as HTMLButtonElement | null;
const zenContextSoloBtn = document.getElementById('zenContextSoloBtn') as HTMLButtonElement | null;
const zenContextTravBtn = document.getElementById('zenContextTravBtn') as HTMLButtonElement | null;

// Scene Arranger List (morphing badge class sync during sequence ticks)
const sceneCardsList = document.getElementById('sceneCardsList') as HTMLElement | null;

let autoOnboardingStarted = false;

export function dismissWelcomePrompt(): void {
  if (audioUnlockPrompt) {
    audioUnlockPrompt.classList.add('hidden');
    audioUnlockPrompt.style.display = 'none';
    audioUnlockPrompt.style.pointerEvents = 'none';
  }
  if (!autoOnboardingStarted) {
    autoOnboardingStarted = true;
    onboarding.start();
  }
}

/**
 * Synchronizes the bottom bar audio status chip (#statAudio) with Web Audio engine state.
 */
export function updateAudioStatusChip(): void {
  if (!statAudio) return;
  if (soundEngine.isReady) {
    statAudio.textContent = 'Audio: Active';
    statAudio.setAttribute('data-tooltip', 'Audio Engine Active: Web Audio synthesizer running');
    statAudio.classList.remove('chip-unstarted');
    statAudio.classList.add('chip-ready');
  } else {
    statAudio.textContent = 'Click to Start Audio';
    statAudio.setAttribute('data-tooltip', 'Click to Start Audio Engine');
    statAudio.classList.add('chip-unstarted');
    statAudio.classList.remove('chip-ready');
  }
}

// Reactively update audio status chip whenever AudioContext state changes (running/suspended)
soundEngine.onStateChange = () => {
  updateAudioStatusChip();
};

let audioUnlockListenersRemoved = false;
function removeAudioUnlockListeners(): void {
  if (audioUnlockListenersRemoved || typeof window === 'undefined') return;
  audioUnlockListenersRemoved = true;
  window.removeEventListener('pointerdown', unlockAudioOnGesture);
  window.removeEventListener('click', unlockAudioOnGesture);
  window.removeEventListener('keydown', unlockAudioOnGesture);
  window.removeEventListener('touchstart', unlockAudioOnGesture);
}

export async function ensureAudioUnlocked(): Promise<void> {
  if (!soundEngine.isReady) {
    try {
      await soundEngine.init();
      try {
        LiveRecorder.preloadWorklet(soundEngine.context);
      } catch {
        // optional worklet preload
      }
      strokeManager.activateAudioVoices();
    } catch (err) {
      console.warn('Audio initialization deferred:', err);
    }
  } else {
    strokeManager.activateAudioVoices();
  }
  if (soundEngine.isReady) {
    removeAudioUnlockListeners();
  }
  updateAudioStatusChip();
  dismissWelcomePrompt();
}

startAudioBannerBtn?.addEventListener('click', async (e) => {
  e.stopPropagation();
  await ensureAudioUnlocked();
});
audioUnlockPrompt?.addEventListener('click', async () => {
  await ensureAudioUnlocked();
});
statAudio?.addEventListener('click', async () => {
  await ensureAudioUnlocked();
});

const BREATHING_GENERAL_TOOLTIP =
  'Timbral Breathing: Adds natural breathing movement — Gentle Swell (soft warm rise and fall), Deep Ocean (slow immersive waves), Tape Drift (dreamy floating texture), or Off (steady, unchanging tones).';

function updateBreathingTooltip(_mode?: BreathingMode): void {
  if (breathingControlGroup) {
    breathingControlGroup.setAttribute('data-tooltip', BREATHING_GENERAL_TOOLTIP);
  }
}

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

function applyGeneralSync(val: string): void {
  if (val.startsWith('speed:')) {
    const mult = parseFloat(val.replace('speed:', ''));
    strokeManager.setDefaultSpeedMode('speed');
    strokeManager.setDefaultSpeedMultiplier(mult);
  } else if (val.startsWith('timer:')) {
    const dur = parseInt(val.replace('timer:', ''), 10);
    strokeManager.setDefaultSpeedMode('timer');
    strokeManager.setDefaultDuration(dur);
  } else if (val.startsWith('bars:')) {
    const mode = val.replace('bars:', '') as 'freeform' | '1bar' | '2bars' | '4bars' | '8bars';
    strokeManager.setDefaultSpeedMode('bars');
    strokeManager.setLoopQuantizeMode(mode);
  }
}

// Engine State
const quantizer = new ScaleQuantizer({
  scale: SCALES.dorian,
  root: ROOT_NOTES.D3,
  octaveSpan: 4,
});
quantizer.setScrollEnabled(true);

const strokeManager = new StrokeManager();
const renderer = new CanvasRenderer(canvasEl);
const sceneManager = new SceneManager();
const abSnapshot = new ABSnapshotManager();
const onboarding = new OnboardingController();

let beatGridVisible = readStorageKey('harmonic_beat_grid') === '1';
let pendingSceneId: string | null = null;

let prevCanvasWidth = 0;
let prevCanvasHeight = 0;

let currentStyle: StrokeStyle = 'solid';
let currentInstrumentId: string = DEFAULT_INSTRUMENT.id;
let activeDrawingPoints: Point2D[] = [];
let assistedDrawingEnabled = false;
let assistedLineCount: AssistedLineCount = 3;
let assistedInstrumentMode: AssistedInstrumentMode = 'same';

// Web MIDI Output Hooks
strokeManager.onMidiPulse = (event) => {
  const baseDurMs = event.isDrum ? 90 : event.isStriped ? 110 : 220;
  const durationMs = Math.max(40, Math.round(baseDurMs * event.articulation));
  midiController.sendPulseNote(
    event.instrumentId,
    event.frequency,
    event.velocity,
    durationMs,
    event.isDrum,
    event.drumZone,
    event.tomFreq
  );
};

strokeManager.onMidiDroneUpdate = (event) => {
  midiController.updateDroneNote(
    event.strokeId,
    event.instrumentId,
    event.frequency,
    event.velocity,
    event.normX,
    event.curvature,
    event.filterCutoff
  );
};

strokeManager.onMidiDroneStop = (strokeId) => {
  midiController.stopDroneNote(strokeId);
};

// Restore persisted Auto-Smooth preference safely
const savedAutoSmooth = readStorageKey(STORAGE_KEYS.AUTO_SMOOTH);
const initialAutoSmooth = savedAutoSmooth !== null ? savedAutoSmooth !== 'false' : true;

// Input Handling with Draw / Edit modes, straight bars, marquee multi-select, and touch gestures
const inputHandler = new InputHandler(canvasEl, {
  strokeManager,
  getQuantizer: () => quantizer,
  getCurrentInstrument: () => currentInstrumentId,
  getCurrentStyle: () => currentStyle,
  getXAxisModulation: () => (xAxisSelect ? (xAxisSelect.value as XAxisModulationMode) : 'panAndTone'),
  onPointerDown: () => {
    dismissWelcomePrompt();
    updateAudioStatusChip();
  },
  onStrokeRedraw: (strokeId: string, path: SplinePath) => {
    strokeManager.redrawStroke(strokeId, path);
    strokeManager.selectStroke(strokeId);
    updateTrackActionsVisibility();
    studioDeckController.updateMixerSelection();
    syncCompositionState();
    if (statMode && inputHandler.appMode === 'redraw') {
      const s = strokeManager.getStroke(strokeId);
      const instName = s ? getInstrument(s.instrumentId)?.name || 'Line' : 'Line';
      const color = s ? renderer.getStrokeColor(s) : '#2563eb';
      statMode.textContent = `Re-drawn '${instName}'. Draw again to reshape, or click Draw (or press R).`;
      statMode.style.color = color;
    }
  },
  onRedrawStart: (strokeId: string) => {
    const stroke = strokeManager.getStroke(strokeId);
    if (stroke) {
      syncInstrumentToStroke(stroke);
    }
  },
  onRedrawStateChange: (isArmed: boolean) => {
    updateRedrawButtonsUI(isArmed);
  },
  onStrokeComplete: (path: SplinePath, isPoint?: boolean) => {
    dismissWelcomePrompt();

    if (assistedDrawingEnabled) {
      const gainScale = Number((1 / Math.sqrt(assistedLineCount)).toFixed(2));
      const newStroke = strokeManager.addStroke(
        path,
        currentStyle,
        currentInstrumentId,
        140,
        quantizer,
        renderer.height,
        gainScale,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        isPoint ?? false
      );

      const companionSpecs = generateAssistedStrokes(
        newStroke,
        assistedLineCount,
        quantizer,
        renderer.height,
        renderer.width,
        { instrumentMode: assistedInstrumentMode }
      );

      const companionStrokes: DrawnStroke[] = companionSpecs.map((spec) => {
        const compStroke = strokeManager.addStroke(
          spec.path,
          spec.style,
          spec.instrumentId,
          140,
          quantizer,
          renderer.height,
          Number((gainScale * spec.volumeMultiplier).toFixed(2)),
          undefined,
          spec.traversal,
          undefined,
          undefined,
          undefined,
          Math.min(1, strokeManager.defaultStrokeReverb + (spec.reverbDelta ?? 0)),
          undefined,
          undefined,
          undefined,
          false,
          spec.isPoint ?? false
        );
        strokeManager.setStrokePlayheadPhase(
          compStroke.id,
          spec.initialPhaseRatio,
          spec.initialDirection,
          quantizer,
          renderer.height
        );
        return compStroke;
      });

      const allPlaced = [newStroke, ...companionStrokes];
      strokeManager.recordBatchAddUndo(allPlaced);
      strokeManager.activateAudioVoices();
      strokeManager.selectStrokes(allPlaced.map((s) => s.id));
      syncCompositionState();
      onboarding.notifyUserAction('drew_stroke');
      if (inputHandler.appMode === 'draw' && statMode) {
        statMode.textContent = `Assisted Draw: Placed ${allPlaced.length} Lines (←/→ Tempo)`;
        statMode.style.color = '#2563eb';
      }
      return;
    }

    const newStroke = strokeManager.addStroke(
      path,
      currentStyle,
      currentInstrumentId,
      140,
      quantizer,
      renderer.height,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      isPoint ?? false
    );

    strokeManager.activateAudioVoices();
    strokeManager.selectStroke(newStroke.id);
    updateTrackActionsVisibility();
    studioDeckController.updateMixerSelection();
    if (inputHandler.appMode === 'draw' && statMode) {
      statMode.textContent = 'Line Selected (Edit)';
      statMode.style.color = '#2563eb';
    }
    syncCompositionState();
    onboarding.notifyUserAction('drew_stroke');
  },
  onDrawChange: (points: Point2D[]) => {
    activeDrawingPoints = points;
  },
  onStrokeTranslateEnd: () => {
    syncCompositionState();
  },
  onSelectStroke: (strokeId: string | null) => {
    if (!strokeId && inputHandler.appMode !== 'redraw' && inputHandler.isRedrawing) {
      inputHandler.cancelRedraw();
    }
    const stroke = strokeId ? strokeManager.getStroke(strokeId) : null;
    if (stroke && (inputHandler.appMode === 'redraw' || inputHandler.isRedrawing)) {
      syncInstrumentToStroke(stroke);
    }
    if (strokeId !== null || strokeManager.selectedStrokeIds.length > 0) {
      onboarding.notifyUserAction('selected_stroke');
    }
    updateTrackActionsVisibility();
    studioDeckController.updateMixerSelection();
    if (statMode) {
      if (inputHandler.appMode === 'draw') {
        statMode.textContent = strokeId ? 'Line Selected (Edit)' : 'Draw / Click to Select';
        statMode.style.color = strokeId ? '#2563eb' : 'inherit';
      } else if (inputHandler.appMode === 'redraw') {
        const instName = stroke ? getInstrument(stroke.instrumentId)?.name || 'Line' : 'Line';
        const color = stroke ? renderer.getStrokeColor(stroke) : '#2563eb';
        statMode.textContent = `Re-draw: Draw curve on canvas to replace '${instName}'`;
        statMode.style.color = color;
      }
    }
  },
  onMarqueeSelect: (worldRect) => {
    const hits = strokeManager.getStrokesInRect(worldRect);
    if (hits.length > 0) {
      strokeManager.selectMultipleStrokes(hits.map((s) => s.id));
      onboarding.notifyUserAction('selected_stroke');
    } else {
      strokeManager.selectStroke(null);
    }
    updateTrackActionsVisibility();
    studioDeckController.updateMixerSelection();
  },
  onDuplicateDragStart: (ids: string[]) => {
    const created = strokeManager.duplicateStrokes(ids, 0, 0, quantizer, renderer.height);
    if (created.length > 0) {
      if (soundEngine.isReady) {
        strokeManager.activateAudioVoices();
      }
      syncCompositionState();
    }
    return created.map((s) => s.id);
  },
  onPinchOctaveZoom: (scaleFactor: number) => {
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return;
    applyOctaveSpan(quantizer.getConfig().octaveSpan / scaleFactor);
  },
  onTwoFingerScrollY: (deltaY: number) => {
    smoothScrollBy(deltaY);
  },
});

inputHandler.setAutoSmooth(initialAutoSmooth);
if (autoSmoothBtn) {
  autoSmoothBtn.classList.toggle('active', initialAutoSmooth);
  autoSmoothBtn.setAttribute('aria-pressed', initialAutoSmooth ? 'true' : 'false');
  autoSmoothBtn.textContent = initialAutoSmooth ? 'Smooth On' : 'Smooth Off';
}

function syncInstrumentToStroke(stroke: DrawnStroke): void {
  currentInstrumentId = stroke.instrumentId;
  currentStyle = stroke.style;
  swatchButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-instrument') === stroke.instrumentId);
  });
  document.querySelectorAll<HTMLElement>('#zenSwatches .swatch-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-instrument') === stroke.instrumentId);
  });
  strokeModeButtons.forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-style') === stroke.style);
  });
  document.querySelectorAll<HTMLElement>('#zenStyleControl .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-zen-style') === stroke.style);
  });
}

function updateRedrawButtonsUI(isArmed: boolean): void {
  const isRedrawActive = isArmed || inputHandler.appMode === 'redraw';
  document.getElementById('studioRedrawTrackBtn')?.classList.toggle('active', isRedrawActive);
  zenContextRedrawBtn?.classList.toggle('active', isRedrawActive);
  appModeButtons.forEach((btn) => {
    if (btn.getAttribute('data-app-mode') === 'redraw') {
      btn.classList.toggle('active', isRedrawActive);
    }
  });
  const allRedrawBtns = document.querySelectorAll('.layer-btn[data-action="redraw"]');
  allRedrawBtns.forEach((btn) => {
    const card = btn.closest('.layer-card');
    const cardStrokeId = card?.getAttribute('data-stroke-id');
    const isThisCardRedrawing = isRedrawActive && cardStrokeId === strokeManager.selectedStrokeId;
    btn.classList.toggle('active', isThisCardRedrawing);
  });
  if (statMode && inputHandler.appMode === 'draw') {
    if (isArmed) {
      const s = strokeManager.selectedStrokeId ? strokeManager.getStroke(strokeManager.selectedStrokeId) : null;
      const color = s ? renderer.getStrokeColor(s) : '#2563eb';
      statMode.textContent = 'Re-drawing line... Draw new path on canvas';
      statMode.style.color = color;
    } else if (strokeManager.selectedStrokeId) {
      statMode.textContent = 'Line Selected (Edit)';
      statMode.style.color = '#2563eb';
    }
  }
}

// Interaction Mode Switching (Draw Score vs Re-draw vs Live Play)
function setAppMode(mode: 'draw' | 'redraw' | 'live'): void {
  inputHandler.setAppMode(mode);
  appModeButtons.forEach((btn) => {
    const isActive = btn.getAttribute('data-app-mode') === mode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  if (mode === 'live') {
    onboarding.notifyUserAction('tried_feature');
  } else if (mode === 'redraw') {
    if (!strokeManager.selectedStrokeId && strokeManager.activeStrokes.length > 0) {
      const last = strokeManager.activeStrokes[strokeManager.activeStrokes.length - 1];
      strokeManager.selectStroke(last.id);
      updateTrackActionsVisibility();
      studioDeckController.updateMixerSelection();
    }
    const targetStroke = strokeManager.selectedStrokeId ? strokeManager.getStroke(strokeManager.selectedStrokeId) : null;
    if (targetStroke) {
      syncInstrumentToStroke(targetStroke);
    }
  }

  updateRedrawButtonsUI(mode === 'redraw' || inputHandler.isRedrawing);

  if (statMode) {
    if (mode === 'live') {
      const revPct = Math.round(inputHandler.liveReverbSend * 100);
      statMode.textContent = `Live Play (${revPct}% Reverb)`;
      statMode.style.color = '#2563eb';
    } else if (mode === 'redraw') {
      const s = strokeManager.selectedStrokeId ? strokeManager.getStroke(strokeManager.selectedStrokeId) : null;
      const instName = s ? getInstrument(s.instrumentId)?.name || 'Line' : 'Line';
      const color = s ? renderer.getStrokeColor(s) : '#2563eb';
      statMode.textContent = `Re-draw '${instName}' (Drag line to move • Draw empty space to replace)`;
      statMode.style.color = color;
    } else {
      if (strokeManager.selectedStrokeId) {
        statMode.textContent = 'Line Selected (Edit)';
        statMode.style.color = '#2563eb';
      } else {
        statMode.textContent = 'Draw / Click to Select';
        statMode.style.color = 'inherit';
      }
    }
  }

  if (liveControlsGroup) {
    liveControlsGroup.style.display = mode === 'live' ? 'flex' : 'none';
  }
  drawOnlyControls.forEach((el) => {
    el.style.display = '';
  });
  updateTrackActionsVisibility();
}

appModeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-app-mode') as 'draw' | 'redraw' | 'live';
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
  liveSnapBtn.setAttribute('aria-pressed', nextSnap ? 'true' : 'false');
  liveSnapBtn.textContent = nextSnap ? 'Scale Lock ON' : 'Free Glide';
});

liveTrailSlider?.addEventListener('input', () => {
  const sec = parseFloat(liveTrailSlider.value);
  if (liveTrailVal) liveTrailVal.textContent = `${sec.toFixed(1)}s`;
  inputHandler.setLiveTrailLifetime(sec * 1000);
});

// Drawing Shape Switching (Curve vs Straight Note Bar vs Dot)
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
autoSmoothBtn?.addEventListener('click', () => {
  const willSmooth = !inputHandler.isAutoSmooth;
  inputHandler.setAutoSmooth(willSmooth);
  autoSmoothBtn.classList.toggle('active', willSmooth);
  autoSmoothBtn.setAttribute('aria-pressed', willSmooth ? 'true' : 'false');
  autoSmoothBtn.textContent = willSmooth ? 'Smooth On' : 'Smooth Off';
  writeStorageKey(STORAGE_KEYS.AUTO_SMOOTH, String(willSmooth));
});

// Magnetic Pitch Snap Toggle
snapPitchBtn?.addEventListener('click', () => {
  const willSnap = !inputHandler.isPitchSnapped;
  inputHandler.setSnapPitch(willSnap);
  snapPitchBtn.classList.toggle('active', willSnap);
  snapPitchBtn.setAttribute('aria-pressed', willSnap ? 'true' : 'false');
  snapPitchBtn.textContent = willSnap ? 'Snap ON' : 'Snap Off';
});

// Assisted Drawing Toggle, Line Count (2-5), & Instrument Mode (Same vs Mixed)
function setAssistedDrawing(
  enabled: boolean,
  count?: AssistedLineCount,
  inkMode?: AssistedInstrumentMode
): void {
  assistedDrawingEnabled = enabled;
  if (count !== undefined) {
    assistedLineCount = Math.max(2, Math.min(5, Math.round(count))) as AssistedLineCount;
  }
  if (inkMode !== undefined) {
    assistedInstrumentMode = inkMode === 'mixed' ? 'mixed' : 'same';
  }

  if (assistToggleBtn) {
    assistToggleBtn.classList.toggle('active', assistedDrawingEnabled);
    assistToggleBtn.textContent = assistedDrawingEnabled ? 'On' : 'Off';
    assistToggleBtn.setAttribute('aria-pressed', assistedDrawingEnabled ? 'true' : 'false');
  }
  if (assistCountControl) {
    assistCountControl.style.display = assistedDrawingEnabled ? 'inline-flex' : 'none';
  }
  assistCountButtons.forEach((btn) => {
    const val = parseInt(btn.getAttribute('data-assist-count') || '', 10);
    btn.classList.toggle('active', val === assistedLineCount);
  });

  if (assistInkModeBtn) {
    assistInkModeBtn.style.display = assistedDrawingEnabled ? 'inline-flex' : 'none';
    const isMixed = assistedInstrumentMode === 'mixed';
    assistInkModeBtn.classList.toggle('active', isMixed);
    assistInkModeBtn.textContent = isMixed ? 'Mixed Inks' : 'Same Ink';
    assistInkModeBtn.setAttribute('data-assist-ink', assistedInstrumentMode);
  }

  topBarEl?.querySelector('.top-bar-primary')?.classList.toggle('is-assist-expanded', assistedDrawingEnabled);

  if (drawerAssistToggleBtn) {
    drawerAssistToggleBtn.classList.toggle('active', assistedDrawingEnabled);
    drawerAssistToggleBtn.setAttribute('aria-pressed', assistedDrawingEnabled ? 'true' : 'false');
    drawerAssistToggleBtn.textContent = assistedDrawingEnabled ? 'Assist On' : 'Assist Off';
  }
  if (drawerAssistCountSelect) {
    drawerAssistCountSelect.value = String(assistedLineCount);
  }
  if (drawerAssistInkSelect) {
    drawerAssistInkSelect.value = assistedInstrumentMode;
  }

  if (statMode && inputHandler.appMode === 'draw') {
    if (assistedDrawingEnabled) {
      const inkLabel = assistedInstrumentMode === 'mixed' ? 'Mixed Inks' : 'Same Ink';
      statMode.textContent = `Assisted Draw ON (${assistedLineCount} Lines • ${inkLabel})`;
      statMode.style.color = '#2563eb';
    } else {
      statMode.textContent = strokeManager.selectedStrokeId ? 'Line Selected (Edit)' : 'Draw / Click to Select';
      statMode.style.color = strokeManager.selectedStrokeId ? '#2563eb' : 'inherit';
    }
  }
}

assistToggleBtn?.addEventListener('click', () => {
  setAssistedDrawing(!assistedDrawingEnabled);
});

drawerAssistToggleBtn?.addEventListener('click', () => {
  setAssistedDrawing(!assistedDrawingEnabled);
});

assistCountButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const val = parseInt(btn.getAttribute('data-assist-count') || '', 10);
    if (val >= 2 && val <= 5) {
      setAssistedDrawing(true, val as AssistedLineCount);
    }
  });
});

assistInkModeBtn?.addEventListener('click', () => {
  const nextMode: AssistedInstrumentMode = assistedInstrumentMode === 'mixed' ? 'same' : 'mixed';
  setAssistedDrawing(true, undefined, nextMode);
});

drawerAssistCountSelect?.addEventListener('change', () => {
  const val = parseInt(drawerAssistCountSelect.value, 10);
  if (val >= 2 && val <= 5) {
    setAssistedDrawing(assistedDrawingEnabled, val as AssistedLineCount);
  }
});

drawerAssistInkSelect?.addEventListener('change', () => {
  const mode = drawerAssistInkSelect.value === 'mixed' ? 'mixed' : 'same';
  setAssistedDrawing(assistedDrawingEnabled, undefined, mode);
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

canvasEl.addEventListener('wheel', (e: WheelEvent) => {
  e.preventDefault();
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
    return;
  }
  smoothScrollBy(e.deltaY);
}, { passive: false });

pitchNavigator?.addEventListener('wheel', (e: WheelEvent) => {
  e.preventDefault();
  smoothScrollBy(e.deltaY);
}, { passive: false });

pitchTrack?.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.target === pitchThumb || pitchThumb.contains(e.target as Node)) return;
  const trackRect = pitchTrack.getBoundingClientRect();
  const clickY = e.clientY - trackRect.top;
  const clickRatio = Math.max(0, Math.min(1, clickY / trackRect.height));
  const targetScrollRatio = clickRatio - (renderer.height / quantizer.getWorldHeight(renderer.height)) / 2;
  const targetY = targetScrollRatio * quantizer.getWorldHeight(renderer.height);
  smoothScrollTo(targetY);
});

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

/**
 * Keeps both Advanced Drawer and Studio Master FX controls synchronized with current engine/UI state.
 */
function syncMasterFxUI(): void {
  const bpm = strokeManager.currentBpm;
  if (bpmSlider) bpmSlider.value = bpm.toString();
  if (bpmVal) bpmVal.textContent = `${bpm} BPM`;
  if (studioMasterBpmSlider) studioMasterBpmSlider.value = bpm.toString();
  if (studioMasterBpmVal) studioMasterBpmVal.textContent = `${bpm} BPM`;

  const revPct = Math.round(soundEngine.reverbMix * 100);
  if (spaceSlider) spaceSlider.value = revPct.toString();
  if (spaceVal) spaceVal.textContent = `${revPct}%`;
  if (studioMasterReverbSlider) studioMasterReverbSlider.value = revPct.toString();
  if (studioMasterReverbVal) studioMasterReverbVal.textContent = `${revPct}%`;

  const revType = soundEngine.reverbType;
  if (reverbTypeSelect) reverbTypeSelect.value = revType;
  if (studioReverbTypeSelect) studioReverbTypeSelect.value = revType;

  const widthPct = Math.round(soundEngine.stereoWidth * 100);
  const widthText = widthPct === 100 ? '100% (Stereo)' : (widthPct === 0 ? '0% (Mono)' : `${widthPct}%`);
  if (stereoWidthSlider) stereoWidthSlider.value = widthPct.toString();
  if (stereoWidthVal) stereoWidthVal.textContent = widthText;
  if (studioStereoWidthSlider) studioStereoWidthSlider.value = widthPct.toString();
  if (studioStereoWidthVal) studioStereoWidthVal.textContent = widthText;

  const warmthPct = Math.round(soundEngine.tapeWarmth * 100);
  const drawerWarmthText = warmthPct === 0 ? '0% (Clean)' : `${warmthPct}%`;
  if (tapeWarmthSlider) tapeWarmthSlider.value = warmthPct.toString();
  if (tapeWarmthVal) tapeWarmthVal.textContent = drawerWarmthText;
  if (studioTapeWarmthSlider) studioTapeWarmthSlider.value = warmthPct.toString();
  if (studioTapeWarmthVal) studioTapeWarmthVal.textContent = `${warmthPct}%`;

  const duckPct = Math.round(soundEngine.duckingDepth * 100);
  const drawerDuckText = duckPct === 0 ? '0% (Off)' : `${duckPct}%`;
  if (duckingSlider) duckingSlider.value = duckPct.toString();
  if (duckingVal) duckingVal.textContent = drawerDuckText;
  if (studioDuckingSlider) studioDuckingSlider.value = duckPct.toString();
  if (studioDuckingVal) studioDuckingVal.textContent = `${duckPct}%`;

  if (studioScaleSelect && scaleSelect) studioScaleSelect.value = scaleSelect.value;
  if (studioRootSelect && rootSelect) studioRootSelect.value = rootSelect.value;
  if (studioXAxisSelect && xAxisSelect) studioXAxisSelect.value = xAxisSelect.value;
  if (studioBreathingSelect && breathingSelect) studioBreathingSelect.value = breathingSelect.value;

  studioDeckController.syncMasterSwingAndPerformanceUI(
    strokeManager.swing,
    beatGridVisible,
    strokeManager.quantizedTriggering
  );
}

async function loadComposition(
  comp: SavedComposition,
  options?: { preserveAB?: boolean }
): Promise<void> {
  midiController.allNotesOff();
  pendingSceneId = null;
  renderer.resize();
  prevCanvasWidth = renderer.width;
  prevCanvasHeight = renderer.height;

  await ensureAudioUnlocked();

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
  }
  if (comp.spaceReverb !== undefined) {
    soundEngine.setReverbMix(comp.spaceReverb);
  }
  if (comp.reverbType) {
    soundEngine.setReverbType(comp.reverbType);
  }
  if (typeof comp.stereoWidth === 'number') {
    soundEngine.setStereoWidth(comp.stereoWidth);
  }
  if (typeof comp.tapeWarmth === 'number') {
    soundEngine.setTapeWarmth(comp.tapeWarmth);
  }
  if (typeof comp.duckingDepth === 'number') {
    soundEngine.setDuckingDepth(comp.duckingDepth);
  }
  if (comp.octaveSpan !== undefined) {
    const clampedOct = Math.max(1, Math.min(8, comp.octaveSpan));
    if (octavesSlider) {
      const sliderMin = parseFloat(octavesSlider.min || '2');
      const sliderMax = parseFloat(octavesSlider.max || '6');
      octavesSlider.value = String(Math.max(sliderMin, Math.min(sliderMax, Math.round(clampedOct))));
    }
    if (octavesVal) {
      octavesVal.textContent = Number.isInteger(clampedOct)
        ? `${clampedOct} Oct`
        : `${clampedOct.toFixed(1)} Oct`;
    }
    quantizer.updateConfig({ octaveSpan: clampedOct });
  }
  if (comp.breathingMode && breathingSelect) {
    breathingSelect.value = comp.breathingMode;
    if (studioBreathingSelect) studioBreathingSelect.value = comp.breathingMode;
    strokeManager.setBreathingMode(comp.breathingMode);
    updateBreathingTooltip(comp.breathingMode);
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
    autoSmoothBtn.setAttribute('aria-pressed', comp.autoSmooth ? 'true' : 'false');
    autoSmoothBtn.textContent = comp.autoSmooth ? 'Smooth On' : 'Smooth Off';
    writeStorageKey(STORAGE_KEYS.AUTO_SMOOTH, String(comp.autoSmooth));
  }
  if (comp.snapPitch !== undefined) {
    inputHandler.setSnapPitch(comp.snapPitch);
    snapPitchBtn.classList.toggle('active', comp.snapPitch);
    snapPitchBtn.setAttribute('aria-pressed', comp.snapPitch ? 'true' : 'false');
    snapPitchBtn.textContent = comp.snapPitch ? 'Snap ON' : 'Snap Off';
  }
  if (comp.theme) {
    setTheme(comp.theme === 'dark');
  }

  strokeManager.setSwing(typeof comp.swing === 'number' ? comp.swing : 0);
  if (typeof comp.beatGridVisible === 'boolean') {
    beatGridVisible = comp.beatGridVisible;
    writeStorageKey('harmonic_beat_grid', beatGridVisible ? '1' : '0');
  }
  if (typeof comp.quantizedTriggering === 'boolean') {
    strokeManager.setQuantizedTriggering(comp.quantizedTriggering);
  }

  if (typeof comp.scrollY === 'number') {
    quantizer.setScrollY(quantizer.clampScrollY(comp.scrollY, renderer.height));
  } else {
    quantizer.resetScrollToDefault(renderer.height);
  }
  targetScrollY = quantizer.scrollY;
  updatePitchNavigator();

  strokeManager.importComposition(comp, quantizer, renderer.height, renderer.width);
  if (soundEngine.isReady) {
    strokeManager.activateAudioVoices();
  }

  if (comp.scenes && comp.scenes.length > 0) {
    sceneManager.importScenes(comp.scenes);
  } else {
    sceneManager.importScenes([
      {
        id: `scene_${Date.now()}_1`,
        name: comp.name ? `Scene 1: ${comp.name}` : 'Scene 1: Ambient Foundation',
        durationSec: 30,
        bpm: comp.bpm || strokeManager.currentBpm,
        scaleId: comp.scaleId || scaleSelect.value,
        rootId: comp.rootId || rootSelect.value,
        spaceReverb: comp.spaceReverb ?? soundEngine.reverbMix,
        xAxisModulationMode: comp.xAxisModulationMode || (xAxisSelect.value as XAxisModulationMode),
        strokes: strokeManager.exportComposition().strokes,
      },
    ]);
  }

  if (!options?.preserveAB) {
    abSnapshot.clear();
    studioDeckController.updateABSnapshotButtons();
  }

  currentLoadedPresetName = comp.name || 'Custom Preset';
  setCompositionDirty(false);
  syncMasterFxUI();
  updateStats();
  updateTrackActionsVisibility();
  studioDeckController.renderAllMixers();
  studioDeckController.updateHistoryBadge();
  sceneUiController.renderSceneCards();
  presetModalController.updatePresetDeleteButtons();
}

function buildCurrentCompositionExport(nameOverride?: string): SavedComposition {
  const comp = strokeManager.exportComposition(
    nameOverride || currentLoadedPresetName || 'Shared Score',
    scaleSelect ? scaleSelect.value : 'dorian',
    rootSelect ? rootSelect.value : 'D3',
    renderer.width,
    renderer.height
  );
  comp.spaceReverb = soundEngine.reverbMix;
  comp.reverbType = soundEngine.reverbType;
  comp.stereoWidth = soundEngine.stereoWidth;
  comp.tapeWarmth = soundEngine.tapeWarmth;
  comp.duckingDepth = soundEngine.duckingDepth;
  comp.octaveSpan = quantizer.getConfig().octaveSpan;
  comp.scrollY = quantizer.scrollY;
  comp.swing = strokeManager.swing;
  comp.beatGridVisible = beatGridVisible;
  comp.quantizedTriggering = strokeManager.quantizedTriggering;
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

  if (sceneManager.getScenes().length > 1) {
    sceneManager.updateCurrentScene({
      strokes: comp.strokes,
      bpm: strokeManager.currentBpm,
      scaleId: comp.scaleId,
      rootId: comp.rootId,
      spaceReverb: comp.spaceReverb,
      xAxisModulationMode: comp.xAxisModulationMode,
    });
    comp.scenes = sceneManager.exportScenes();
  } else {
    comp.scenes = undefined;
  }

  return comp;
}

// ==========================================================================
// Composition Helpers & Wave 2 Modular Controllers
// ==========================================================================
function duplicateStrokeWithState(strokeId: string): DrawnStroke | null {
  const source = strokeManager.getStroke(strokeId);
  const newStroke = strokeManager.duplicateStroke(strokeId, quantizer, renderer.height);
  if (newStroke && source) {
    if (typeof source.distortion === 'number') {
      strokeManager.setStrokeDistortion(newStroke.id, source.distortion, false);
    }
    if (typeof source.filterCutoff === 'number') {
      strokeManager.setStrokeFilterCutoff(newStroke.id, source.filterCutoff, false);
    }
    if (typeof source.lofi === 'number') {
      strokeManager.setStrokeLofi(newStroke.id, source.lofi, false);
    }
    if (typeof source.articulation === 'number') {
      strokeManager.setStrokeArticulation(newStroke.id, source.articulation, false);
    }
    if (source.muted) {
      strokeManager.setStrokeMuted(newStroke.id, true);
    }
    if (soundEngine.isReady) {
      strokeManager.activateAudioVoices();
    }
  }
  return newStroke;
}

function toggleStrokeMuteWithQuantize(strokeId: string): void {
  if (strokeManager.quantizedTriggering) {
    strokeManager.queueToggleMute(strokeId);
    if (strokeManager.paused) {
      syncCompositionState();
    } else {
      studioDeckController.renderAllMixers();
    }
  } else {
    strokeManager.toggleMute(strokeId);
    syncCompositionState();
  }
}

const viewModeManager = new ViewModeManager({
  onViewChange: (mode: ViewMode) => {
    if (mode === 'studio') {
      studioDeckController.renderAllMixers();
      if (document.getElementById('studioTabBtnScenes')?.classList.contains('active')) {
        sceneUiController.renderSceneCards();
      }
      if (document.getElementById('studioTabBtnMaster')?.classList.contains('active')) {
        syncMasterFxUI();
        studioDeckController.refreshMidiUi();
      }
    } else if (mode === 'zen') {
      setDrawerOpen(false);
      armZenAutoDim();
    }
    updateTrackActionsVisibility();
    if (sceneManager.isSequencing()) {
      const prog = sceneManager.getSequenceProgress();
      sceneUiController.updateSeqMiniIndicator({
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

const sceneUiController = new SceneUiController({
  sceneManager,
  strokeManager,
  quantizer,
  soundEngine,
  getCanvasSize: () => ({ width: renderer.width, height: renderer.height }),
  onLoadScene: (scene) => loadScene(scene),
  onSwitchScene: (sceneId) => switchScene(sceneId),
  onSyncCompositionState: () => {
    setCompositionDirty(true);
    updateStats();
    studioDeckController.updateHistoryBadge();
  },
  onSwitchToScenesTab: () => {
    viewModeManager.setMode('studio');
    studioDeckController.switchStudioDeckTab('scenes');
  },
  getPendingSceneId: () => pendingSceneId,
});

const studioDeckController = new StudioDeckController({
  strokeManager,
  renderer,
  quantizer,
  soundEngine,
  inputHandler,
  viewModeManager,
  midiController,
  abSnapshot,
  buildCurrentCompositionSnapshot: () => buildCurrentCompositionExport(),
  onCompositionDirty: (dirty) => setCompositionDirty(dirty),
  onSyncCompositionState: () => syncCompositionState(),
  onUpdateTrackActionsVisibility: () => updateTrackActionsVisibility(),
  onSetAppMode: (mode) => setAppMode(mode),
  onDuplicateStroke: (strokeId) => duplicateStrokeWithState(strokeId),
  onApplySnapshot: async (snapshot) => {
    await loadComposition(snapshot, { preserveAB: true });
  },
  onBeatGridChange: (visible) => {
    beatGridVisible = visible;
    writeStorageKey('harmonic_beat_grid', visible ? '1' : '0');
  },
  onQuantizedChange: (enabled) => {
    if (!enabled && pendingSceneId) {
      pendingSceneId = null;
    }
    sceneUiController.renderSceneCards();
  },
  onMidiCcTargetApplied: () => {
    syncMasterFxUI();
    updatePitchNavigator();
    updateTrackActionsVisibility();
  },
  onRenderSceneCards: () => sceneUiController.renderSceneCards(),
});

const presetModalController = new PresetModalController({
  buildCurrentCompositionExport: (nameOverride) => buildCurrentCompositionExport(nameOverride),
  loadComposition: (comp) => loadComposition(comp),
  getCurrentCompositionName: () => currentLoadedPresetName,
  setCurrentCompositionName: (name) => {
    currentLoadedPresetName = name;
  },
  setCurrentLoadedTemplateId: (id) => {
    currentLoadedTemplateId = id;
  },
  setCompositionDirty: (dirty) => setCompositionDirty(dirty),
  getTemplates: () => TEMPLATES,
  hasActiveStrokes: () => strokeManager.activeStrokes.length > 0,
  onFallbackToTemplate: async (templateId) => {
    await loadTemplate(templateId, false);
  },
  onPresetSaved: () => {
    studioDeckController.renderAllMixers();
  },
});

const recordExportController = new RecordExportController({
  strokeManager,
  quantizer,
  soundEngine,
  getCanvasSize: () => ({ width: renderer.width, height: renderer.height }),
  getCompositionName: () =>
    currentLoadedPresetName || (templateSelect?.value ? templateSelect.value : 'generative-drawing'),
  onAudioStarted: () => ensureAudioUnlocked(),
});

studioDeckController.init();
sceneUiController.init();
presetModalController.init();
recordExportController.init();

studioDeckController.syncMasterSwingAndPerformanceUI(
  strokeManager.swing,
  beatGridVisible,
  strokeManager.quantizedTriggering
);

const originalOpenRecordModal = recordExportController.openModal.bind(recordExportController);
recordExportController.openModal = () => {
  onboarding.notifyUserAction('tried_feature');
  originalOpenRecordModal();
};

const originalUpdateSeqPlayBtn = sceneUiController.updateSequencePlayButton.bind(sceneUiController);
sceneUiController.updateSequencePlayButton = () => {
  originalUpdateSeqPlayBtn();
  if (sceneManager.isSequencing()) {
    onboarding.notifyUserAction('tried_feature');
  }
};

strokeManager.onBarBoundary = () => {
  if (pendingSceneId) {
    const nextId = pendingSceneId;
    pendingSceneId = null;
    executeSwitchSceneImmediate(nextId);
  }
  sceneUiController.renderSceneCards();
  studioDeckController.renderAllMixers();
  studioDeckController.updateHistoryBadge();
};

viewModeManager.initDOM({
  app: appContainerEl,
  studioDeck: studioDeckEl,
  zenDock: zenPillDockEl,
  topBar: topBarEl,
  bottomBar: bottomBarEl,
  pitchNav: pitchNavigator,
});

// ==========================================================================
// Zen Mode Initialization
// ==========================================================================
function initZenMode(): void {
  if (zenSwatches) {
    zenSwatches.textContent = '';
    const insts = Object.values(INSTRUMENTS);
    insts.forEach((inst, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `swatch-btn has-tooltip${inst.id === currentInstrumentId ? ' active' : ''}`;
      btn.setAttribute('data-instrument', inst.id);
      btn.style.setProperty('--swatch-c', inst.color);
      btn.title = `${inst.name} (${idx + 1})`;
      btn.setAttribute('data-tooltip', `${inst.name} (${idx + 1})`);
      const dot = document.createElement('span');
      dot.className = 'swatch-dot';
      btn.appendChild(dot);

      btn.addEventListener('click', () => {
        selectInstrument(inst.id);
        zenSwatches?.querySelectorAll('.swatch-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
      zenSwatches.appendChild(btn);
    });
  }

  zenPlayPauseBtn?.addEventListener('click', () => {
    void togglePlayPause();
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
      const mode = btn.getAttribute('data-app-mode') as 'draw' | 'redraw' | 'live';
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
        document.querySelectorAll<HTMLElement>('#strokeModeControl .seg-btn').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-style') === style);
        });
      }
    });
  });

  zenContextRedrawBtn?.addEventListener('click', () => {
    if (!strokeManager.selectedStrokeId) return;
    if (inputHandler.appMode === 'redraw') {
      setAppMode('draw');
    } else {
      setAppMode('redraw');
    }
  });

  if (zenContextVolSlider) {
    bindSliderUndo<{ strokeId: string; initialValue: number }>(zenContextVolSlider, {
      captureInitial: () => {
        const id = strokeManager.selectedStrokeId;
        const s = id ? strokeManager.getStroke(id) : undefined;
        return s ? { strokeId: s.id, initialValue: s.volume ?? 1.0 } : undefined;
      },
      onInput: (val) => {
        if (!strokeManager.selectedStrokeId) return;
        strokeManager.setStrokeVolume(strokeManager.selectedStrokeId, val / 100, false);
        setCompositionDirty(true);
      },
      onCommit: (initial, val) => {
        const v = Math.max(0, Math.min(1, val / 100));
        strokeManager.setStrokeVolume(initial.strokeId, v, false);
        strokeManager.commitStrokePropertyUndo(initial.strokeId, 'volume', initial.initialValue, v);
        setCompositionDirty(true);
        studioDeckController.updateHistoryBadge();
      },
    });
  }

  zenContextMuteBtn?.addEventListener('click', () => {
    if (!strokeManager.selectedStrokeId) return;
    toggleStrokeMuteWithQuantize(strokeManager.selectedStrokeId);
  });

  zenContextSoloBtn?.addEventListener('click', () => {
    if (!strokeManager.selectedStrokeId) return;
    strokeManager.toggleSolo(strokeManager.selectedStrokeId);
    syncCompositionState();
  });

  zenContextTravBtn?.addEventListener('click', () => {
    if (!strokeManager.selectedStrokeId) return;
    const s = strokeManager.activeStrokes.find((st) => st.id === strokeManager.selectedStrokeId);
    if (s) {
      const currentTrav = s.traversal === 'bounce' || (s.traversal as string) === 'pingpong' ? 'bounce' : 'restart';
      const nextTrav = currentTrav === 'bounce' ? 'restart' : 'bounce';
      strokeManager.setStrokeTraversal(s.id, nextTrav);
      setCompositionDirty(true);
      updateTrackActionsVisibility();
      studioDeckController.renderAllMixers();
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
  if (zenContextName) {
    zenContextName.textContent = stroke.isPoint ? `Dot #${idx + 1} ${inst.name}` : `#${idx + 1} ${inst.name}`;
  }
  if (zenContextVolSlider) zenContextVolSlider.value = Math.round((stroke.volume ?? 1.0) * 100).toString();
  if (zenContextRedrawBtn) {
    zenContextRedrawBtn.classList.toggle('active', inputHandler.isRedrawing);
    zenContextRedrawBtn.style.display = stroke.isPoint ? 'none' : '';
  }
  if (zenContextMuteBtn) zenContextMuteBtn.classList.toggle('active-mute', !!stroke.muted);
  if (zenContextSoloBtn) zenContextSoloBtn.classList.toggle('active-solo', !!stroke.soloed);
  if (zenContextTravBtn) zenContextTravBtn.style.display = stroke.isPoint ? 'none' : '';
}

function syncCompositionState(): void {
  setCompositionDirty(true);
  updateStats();
  updateTrackActionsVisibility();
  studioDeckController.renderAllMixers();
  studioDeckController.updateHistoryBadge();
  sceneManager.updateCurrentScene({
    strokes: strokeManager.exportComposition().strokes,
  });
  sceneUiController.renderSceneCards();
}

function executeSwitchSceneImmediate(sceneId: string): void {
  pendingSceneId = null;
  strokeManager.cancelSceneCrossfade();
  sceneManager.updateCurrentScene({
    strokes: strokeManager.exportComposition().strokes,
    bpm: strokeManager.currentBpm,
    scaleId: scaleSelect.value,
    rootId: rootSelect.value,
    spaceReverb: soundEngine.reverbMix,
    xAxisModulationMode: xAxisSelect.value as XAxisModulationMode,
  });

  const target = sceneManager.selectScene(sceneId);
  if (target) {
    loadScene(target);
  }
}

function switchScene(sceneId: string): void {
  onboarding.notifyUserAction('tried_feature');
  if (
    strokeManager.quantizedTriggering &&
    !strokeManager.paused &&
    sceneId !== sceneManager.getCurrentScene().id
  ) {
    pendingSceneId = sceneId;
    sceneUiController.renderSceneCards();
    showToast('Scene queued for next bar');
    return;
  }
  executeSwitchSceneImmediate(sceneId);
}

function loadScene(scene: SceneData): void {
  pendingSceneId = null;
  strokeManager.cancelSceneCrossfade();
  const comp: SavedComposition = {
    version: 1,
    name: scene.name,
    timestamp: Date.now(),
    bpm: scene.bpm || 32,
    scaleId: scene.scaleId || 'dorian',
    rootId: scene.rootId || 'D3',
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
  if (comp.xAxisModulationMode && xAxisSelect) {
    xAxisSelect.value = comp.xAxisModulationMode;
  }
  if (comp.bpm) {
    strokeManager.setBpm(comp.bpm);
  }
  if (comp.spaceReverb !== undefined) {
    soundEngine.setReverbMix(comp.spaceReverb);
  }

  syncMasterFxUI();
  updateStats();
  updateTrackActionsVisibility();
  studioDeckController.renderAllMixers();
  sceneUiController.renderSceneCards();
}

initZenMode();

// Load Preset File Trigger Buttons (Drawer + Top Bar)
loadTemplateFileBtn?.addEventListener('click', () => {
  loadFileInput?.click();
});

topLoadPresetBtn?.addEventListener('click', () => {
  loadFileInput?.click();
});

loadFileInput?.addEventListener('change', async () => {
  const file = loadFileInput.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const comp = JSON.parse(text) as SavedComposition;
    if (!comp.strokes || !Array.isArray(comp.strokes)) {
      showToast('Invalid template file format: missing strokes array.', 'error');
      return;
    }
    const compName = comp.name || file.name.replace(/\.json$/i, '');
    comp.name = compName;
    if (!savePreset(comp)) {
      showToast('Loaded file, but browser storage could not persist it.', 'error');
    }
    presetModalController.refreshSavedTemplatesDropdown();
    currentLoadedTemplateId = `custom:${compName}`;
    templateSelect.value = currentLoadedTemplateId;
    currentLoadedPresetName = compName;
    await loadComposition(comp);
    if (statMode) statMode.textContent = `Preset Loaded: ${compName}`;
  } catch (err) {
    console.error('Failed to parse groove template file:', err);
    showToast('Could not parse template JSON file.', 'error');
  } finally {
    loadFileInput.value = '';
  }
});

// Starter Groove Template Loader
async function loadTemplate(tId: string, initAudio = true): Promise<void> {
  const template = TEMPLATES[tId];
  if (!template) return;

  midiController.allNotesOff();
  pendingSceneId = null;
  renderer.resize();
  prevCanvasWidth = renderer.width;
  prevCanvasHeight = renderer.height;

  currentLoadedPresetName = template.name;
  currentLoadedTemplateId = tId;
  templateSelect.value = tId;

  if (initAudio) {
    await ensureAudioUnlocked();
  }

  if (SCALES[template.scaleId]) {
    quantizer.updateConfig({ scale: SCALES[template.scaleId] });
    scaleSelect.value = template.scaleId;
  }
  if (ROOT_NOTES[template.rootId]) {
    quantizer.updateConfig({ root: ROOT_NOTES[template.rootId] });
    rootSelect.value = template.rootId;
  }
  strokeManager.setBpm(template.bpm);
  strokeManager.setSwing(0);

  if (template.spaceReverb !== undefined) {
    soundEngine.setReverbMix(template.spaceReverb);
  }
  if (template.octaveSpan !== undefined) {
    if (octavesSlider) octavesSlider.value = template.octaveSpan.toString();
    if (octavesVal) octavesVal.textContent = `${template.octaveSpan} Oct`;
    quantizer.updateConfig({ octaveSpan: template.octaveSpan });
  }
  if (template.xAxisModulation) {
    xAxisSelect.value = template.xAxisModulation;
    strokeManager.setXAxisModulationMode(template.xAxisModulation);
  }
  if (template.breathingMode && breathingSelect) {
    breathingSelect.value = template.breathingMode;
    if (studioBreathingSelect) studioBreathingSelect.value = template.breathingMode;
    strokeManager.setBreathingMode(template.breathingMode);
    updateBreathingTooltip(template.breathingMode);
  } else if (breathingSelect) {
    breathingSelect.value = 'gentle';
    if (studioBreathingSelect) studioBreathingSelect.value = 'gentle';
    strokeManager.setBreathingMode('gentle');
    updateBreathingTooltip('gentle');
  }

  strokeManager.clearAll();
  abSnapshot.clear();
  studioDeckController.updateABSnapshotButtons();

  const templateScroll =
    template.initialScrollRatio !== undefined
      ? quantizer.clampScrollY(template.initialScrollRatio * renderer.height, renderer.height)
      : quantizer.getMaxScrollY(renderer.height);
  quantizer.setScrollY(templateScroll);
  targetScrollY = templateScroll;
  updatePitchNavigator();

  const strokes = buildTemplateStrokes(tId, renderer.width, renderer.height, quantizer);

  for (const s of strokes) {
    for (const seg of s.path.segments) {
      seg.p0.y += templateScroll;
      seg.p1.y += templateScroll;
      seg.p2.y += templateScroll;
      seg.p3.y += templateScroll;
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

  strokeManager.clearHistory();
  strokeManager.randomizeAllPlayheads(quantizer, renderer.height);
  if (soundEngine.isReady) {
    strokeManager.activateAudioVoices();
  }
  currentLoadedPresetName = template.name;
  setCompositionDirty(false);
  syncMasterFxUI();
  updateStats();
  updateTrackActionsVisibility();
  studioDeckController.renderAllMixers();
  studioDeckController.updateHistoryBadge();

  sceneManager.updateCurrentScene({
    name: `Scene 1: ${template.name}`,
    strokes: strokeManager.exportComposition().strokes,
    bpm: template.bpm,
    scaleId: template.scaleId,
    rootId: template.rootId,
    spaceReverb: template.spaceReverb ?? 0.65,
    xAxisModulationMode: template.xAxisModulation || 'panAndTone',
  });
  sceneUiController.renderSceneCards();
  presetModalController.updatePresetDeleteButtons();
}

templateSelect.addEventListener('change', async () => {
  const tId = templateSelect.value;
  if (!tId) return;

  if (tId === '__open_file__') {
    templateSelect.value = currentLoadedTemplateId;
    loadFileInput?.click();
    return;
  }

  if (isCompositionDirty && strokeManager.activeStrokes.length > 0) {
    const ok = await showConfirmDialog({
      title: 'Discard Unsaved Changes?',
      message: `You have unsaved changes in "${currentLoadedPresetName || 'current composition'}". Discard changes and load new preset?`,
      confirmLabel: 'Discard & Load',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) {
      templateSelect.value = currentLoadedTemplateId;
      return;
    }
  }

  if (tId.startsWith('custom:')) {
    const name = tId.slice('custom:'.length);
    const match = loadSavedPresets().find((p) => p.name === name);
    if (match) {
      currentLoadedTemplateId = tId;
      currentLoadedPresetName = name;
      await loadComposition(match);
      templateSelect.value = tId;
    } else {
      templateSelect.value = currentLoadedTemplateId;
    }
    presetModalController.updatePresetDeleteButtons();
    return;
  }

  await loadTemplate(tId, true);
  setCompositionDirty(false);
  studioDeckController.renderAllMixers();
  presetModalController.updatePresetDeleteButtons();
});

// Color-Sound Instrument Swatch Selection
function selectInstrument(instrumentId: string): void {
  const inst = getInstrument(instrumentId);
  currentInstrumentId = inst.id;

  swatchButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-instrument') === inst.id);
  });
  document.querySelectorAll<HTMLElement>('#zenSwatches .swatch-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-instrument') === inst.id);
  });

  if (inst.id === 'onyx') {
    currentStyle = 'dotted';
    strokeModeButtons.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-style') === 'dotted');
    });
    document.querySelectorAll<HTMLElement>('#zenStyleControl .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-zen-style') === 'dotted');
    });
  }

  if (strokeManager.selectedStrokeId) {
    strokeManager.revoiceStroke(strokeManager.selectedStrokeId, inst.id);
    if (inst.id === 'onyx') {
      strokeManager.setStrokeStyle(strokeManager.selectedStrokeId, 'dotted');
    }
    setCompositionDirty(true);
    updateTrackActionsVisibility();
    studioDeckController.renderAllMixers();
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
  if (studioXAxisSelect) studioXAxisSelect.value = mode;
  strokeManager.setXAxisModulationMode(mode);
  setCompositionDirty(true);
});

// ==========================================================================
// Global Floating Tooltip Popover & Contextual Hover Descriptions
// ==========================================================================
const DEFAULT_HELP = 'Hover over any setting for details';
const floatingTooltip = document.getElementById('floatingTooltip') as HTMLDivElement | null;
const toggleTooltipsBtn = document.getElementById('toggleTooltipsBtn') as HTMLButtonElement | null;

let areTooltipsEnabled = readStorageKey(STORAGE_KEYS.TOOLTIPS_ENABLED) !== 'false';

function updateTooltipsToggleUI(): void {
  if (!toggleTooltipsBtn) return;
  toggleTooltipsBtn.textContent = areTooltipsEnabled ? 'Hints On' : 'Hints Off';
  toggleTooltipsBtn.classList.toggle('active', areTooltipsEnabled);
  toggleTooltipsBtn.setAttribute('aria-pressed', areTooltipsEnabled ? 'true' : 'false');
  toggleTooltipsBtn.setAttribute(
    'data-tooltip',
    areTooltipsEnabled
      ? 'Toggle Tooltips: Turn floating popup bubbles OFF (bottom-bar descriptions remain active).'
      : 'Toggle Tooltips: Turn floating popup bubbles back ON.'
  );
}

toggleTooltipsBtn?.addEventListener('click', () => {
  areTooltipsEnabled = !areTooltipsEnabled;
  writeStorageKey(STORAGE_KEYS.TOOLTIPS_ENABLED, areTooltipsEnabled.toString());
  updateTooltipsToggleUI();
  if (!areTooltipsEnabled && floatingTooltip) {
    floatingTooltip.classList.remove('visible');
  }
});

updateTooltipsToggleUI();

function showTooltip(el: HTMLElement): void {
  const text = el.getAttribute('data-tooltip');
  if (!text) return;

  if (contextHelp) {
    contextHelp.textContent = text;
    contextHelp.style.color = 'var(--text-primary)';
  }

  if (areTooltipsEnabled && floatingTooltip) {
    floatingTooltip.textContent = text;
    floatingTooltip.classList.add('visible');

    const rect = el.getBoundingClientRect();
    const tipWidth = floatingTooltip.offsetWidth || 220;
    const tipHeight = floatingTooltip.offsetHeight || 36;

    let left = rect.left + rect.width / 2 - tipWidth / 2;
    left = Math.max(10, Math.min(window.innerWidth - tipWidth - 10, left));

    let top = rect.bottom + 6;
    if (top + tipHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - tipHeight - 6);
    }

    floatingTooltip.style.left = `${Math.round(left)}px`;
    floatingTooltip.style.top = `${Math.round(top)}px`;
  }
}

function hideTooltip(): void {
  if (contextHelp) {
    contextHelp.textContent = DEFAULT_HELP;
    contextHelp.style.color = 'var(--text-muted)';
  }
  if (floatingTooltip) {
    floatingTooltip.classList.remove('visible');
  }
}

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
document.addEventListener(
  'wheel',
  (e: WheelEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const sliderOrNumber = target.closest('input[type="range"], input[type="number"]') as HTMLInputElement | null;
    if (!sliderOrNumber || sliderOrNumber.disabled) return;

    e.preventDefault();
    e.stopPropagation();

    const min = sliderOrNumber.min !== '' ? parseFloat(sliderOrNumber.min) : 0;
    const max = sliderOrNumber.max !== '' ? parseFloat(sliderOrNumber.max) : 100;
    const step = sliderOrNumber.step !== '' && sliderOrNumber.step !== 'any' ? parseFloat(sliderOrNumber.step) : 1;
    const currentVal = parseFloat(sliderOrNumber.value);
    if (isNaN(currentVal)) return;

    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? -e.deltaY : e.deltaX;
    if (delta === 0) return;

    const stepStr = step.toString();
    const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;

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
      sliderOrNumber.dispatchEvent(new Event('input', { bubbles: true }));
      sliderOrNumber.dispatchEvent(new Event('change', { bubbles: true }));
    }
  },
  { passive: false }
);

// Musical Scale and Root Listeners
scaleSelect.addEventListener('change', () => {
  const scaleKey = scaleSelect.value;
  if (studioScaleSelect) studioScaleSelect.value = scaleKey;
  const scale = SCALES[scaleKey];
  if (scale) {
    quantizer.updateConfig({ scale });
    updatePitchNavigator();
    setCompositionDirty(true);
  }
});

rootSelect.addEventListener('change', () => {
  const rootKey = rootSelect.value;
  if (studioRootSelect) studioRootSelect.value = rootKey;
  const root = ROOT_NOTES[rootKey];
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
      document.querySelectorAll<HTMLElement>('#zenStyleControl .seg-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-zen-style') === style);
      });
      if (strokeManager.selectedStrokeId) {
        strokeManager.setStrokeStyle(strokeManager.selectedStrokeId, style);
        setCompositionDirty(true);
        updateTrackActionsVisibility();
        studioDeckController.renderAllMixers();
      }
    }
  });
});

// BPM Tempo Slider
bpmSlider.addEventListener('input', () => {
  const bpm = parseInt(bpmSlider.value, 10);
  bpmVal.textContent = `${bpm} BPM`;
  if (studioMasterBpmSlider) studioMasterBpmSlider.value = bpm.toString();
  if (studioMasterBpmVal) studioMasterBpmVal.textContent = `${bpm} BPM`;
  strokeManager.setBpm(bpm);
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
  if (tapeWarmthVal) tapeWarmthVal.textContent = pct === 0 ? '0% (Clean)' : `${pct}%`;
  if (studioTapeWarmthSlider) studioTapeWarmthSlider.value = pct.toString();
  if (studioTapeWarmthVal) studioTapeWarmthVal.textContent = `${pct}%`;
  setCompositionDirty(true);
});

// Sidechain Ducking Pump Slider
duckingSlider?.addEventListener('input', () => {
  if (!duckingSlider) return;
  const pct = parseInt(duckingSlider.value, 10);
  soundEngine.setDuckingDepth(pct / 100);
  if (duckingVal) duckingVal.textContent = pct === 0 ? '0% (Off)' : `${pct}%`;
  if (studioDuckingSlider) studioDuckingSlider.value = pct.toString();
  if (studioDuckingVal) studioDuckingVal.textContent = `${pct}%`;
  setCompositionDirty(true);
});

// Canvas Pitch Octaves Zoom Helper (shared by slider & 2-finger pinch zoom)
function applyOctaveSpan(targetOctaveSpan: number): void {
  const newOct = Math.max(1, Math.min(8, Math.round(targetOctaveSpan * 10) / 10));
  const oldOct = quantizer.getConfig().octaveSpan;
  if (!Number.isFinite(newOct) || !oldOct || Math.abs(newOct - oldOct) < 0.01) return;

  if (octavesSlider) {
    const sliderMin = parseFloat(octavesSlider.min || '2');
    const sliderMax = parseFloat(octavesSlider.max || '6');
    octavesSlider.value = String(Math.max(sliderMin, Math.min(sliderMax, Math.round(newOct))));
  }
  if (octavesVal) {
    octavesVal.textContent = Number.isInteger(newOct) ? `${newOct} Oct` : `${newOct.toFixed(1)} Oct`;
  }

  const viewportH = renderer.height;
  const oldWorldH = quantizer.getWorldHeight(viewportH);
  const oldActiveH = Math.max(1, oldWorldH - 2 * ScaleQuantizer.MARGIN_Y);

  quantizer.updateConfig({ octaveSpan: newOct });

  const newWorldH = quantizer.getWorldHeight(viewportH);
  const newActiveH = Math.max(1, newWorldH - 2 * ScaleQuantizer.MARGIN_Y);
  const scaleFactor = newActiveH / oldActiveH;

  strokeManager.scaleMelodicStrokesY(scaleFactor, ScaleQuantizer.MARGIN_Y);

  if (activeDrawingPoints.length > 0 && currentInstrumentId !== 'onyx') {
    for (const pt of activeDrawingPoints) {
      pt.y = ScaleQuantizer.MARGIN_Y + (pt.y - ScaleQuantizer.MARGIN_Y) * scaleFactor;
    }
  }

  const centerScreenY = viewportH * 0.5;
  const oldWorldCenterY = quantizer.scrollY + centerScreenY;
  const newWorldCenterY = ScaleQuantizer.MARGIN_Y + (oldWorldCenterY - ScaleQuantizer.MARGIN_Y) * scaleFactor;

  quantizer.setScrollY(quantizer.clampScrollY(newWorldCenterY - centerScreenY, viewportH));
  targetScrollY = quantizer.scrollY;

  updatePitchNavigator();
  updateStats();
  if (strokeManager.selectedStrokeId) {
    updateTrackActionsVisibility();
  }
  setCompositionDirty(true);
}

// Canvas Pitch Octaves Range Slider
octavesSlider?.addEventListener('input', () => {
  applyOctaveSpan(parseInt(octavesSlider.value, 10));
});

function updateScoreTimingStatus(): void {
  if (!scoreTimingBadge) return;
  const strokes = strokeManager.activeStrokes;
  if (strokes.length === 0) {
    scoreTimingBadge.textContent = 'Empty';
    scoreTimingBadge.style.color = '';
    return;
  }
  const timerCount = strokes.filter((s) => s.timingMode === 'timer' || s.speedMode === 'timer').length;
  if (timerCount === 0) {
    scoreTimingBadge.textContent = 'All Speed';
    scoreTimingBadge.style.color = '#10b981';
  } else if (timerCount === strokes.length) {
    scoreTimingBadge.textContent = `${timerCount} ${timerCount === 1 ? 'Timer Line' : 'Timer Lines'}`;
    scoreTimingBadge.style.color = '';
  } else {
    scoreTimingBadge.textContent = `${timerCount} Timer / ${strokes.length - timerCount} Speed`;
    scoreTimingBadge.style.color = '';
  }
}

function updateTrackActionsVisibility(): void {
  studioDeckController.updateMixerSelection();
  updateScoreTimingStatus();
  const selectedId = strokeManager.selectedStrokeId;
  const currentView = typeof viewModeManager !== 'undefined' ? viewModeManager.getMode() : 'studio';

  if (selectedId) {
    if (statMode) statMode.textContent = 'Line Selected';
    const stroke = strokeManager.activeStrokes.find((s) => s.id === selectedId);

    if (currentView === 'studio') {
      studioDeckController.updateStudioDockedInspector();
    } else if (currentView === 'zen') {
      updateZenContextPill(stroke);
    }

    if (stroke) {
      strokeModeButtons.forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-style') === stroke.style);
      });
    }
  } else {
    const selectedCount = strokeManager.selectedStrokeIds.length;
    if (selectedCount > 1) {
      if (statMode) statMode.textContent = `${selectedCount} Lines Selected (Drag Move • ←/→ Tempo)`;
    } else if (statMode) {
      statMode.textContent = inputHandler.appMode === 'live' ? 'Live Play' : 'Draw / Click to Select';
    }
    studioDeckController.updateStudioDockedInspector();
    updateZenContextPill();
    strokeModeButtons.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-style') === currentStyle);
    });
  }
}

// General Timing Default (Sets default speed/timer for future drawn lines)
generalSyncSelect?.addEventListener('change', () => {
  applyGeneralSync(generalSyncSelect.value);
  setCompositionDirty(true);
});

// Convert All Lines to Speed Timing Action in Controls Panel
const convertAllSpeedBtn = document.getElementById('convertAllSpeedBtn') as HTMLButtonElement | null;
convertAllSpeedBtn?.addEventListener('click', () => {
  strokeManager.convertAllStrokesToSpeedTiming(renderer.width);
  if (generalSyncSelect) {
    generalSyncSelect.value = 'speed:1.0';
  }
  setCompositionDirty(true);
  updateStats();
  updateTrackActionsVisibility();
  studioDeckController.renderAllMixers();
  studioDeckController.updateHistoryBadge();
  updateScoreTimingStatus();

  convertAllSpeedBtn.classList.add('active');
  setTimeout(() => {
    convertAllSpeedBtn.classList.remove('active');
  }, 400);
});

// Play / Pause Toggle
async function togglePlayPause(): Promise<void> {
  await ensureAudioUnlocked();
  const isPaused = !strokeManager.paused;
  strokeManager.setPaused(isPaused);
  if (isPaused) {
    midiController.allNotesOff();
  }

  if (playPauseIcon) playPauseIcon.textContent = '';
  if (playPauseText) playPauseText.textContent = isPaused ? 'Play' : 'Pause';
  if (zenPlayPauseText) zenPlayPauseText.textContent = isPaused ? 'Play' : 'Pause';

  if (typeof document !== 'undefined' && document.hidden) {
    if (isPaused) {
      stopBackgroundAudioTicker();
    } else {
      startBackgroundAudioTicker();
    }
  }
}

playPauseBtn?.addEventListener('click', () => {
  void togglePlayPause();
});

// Undo Action
undoBtn?.addEventListener('click', () => {
  strokeManager.undo();
  syncCompositionState();
});

clearBtn?.addEventListener('click', async () => {
  if (isCompositionDirty && strokeManager.activeStrokes.length > 0) {
    const ok = await showConfirmDialog({
      title: 'Clear Canvas?',
      message: 'You have unsaved changes in your composition. Are you sure you want to clear the canvas?',
      confirmLabel: 'Clear Canvas',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
  }
  midiController.allNotesOff();
  pendingSceneId = null;
  strokeManager.clearAll();
  abSnapshot.clear();
  studioDeckController.updateABSnapshotButtons();
  currentLoadedTemplateId = '';
  templateSelect.value = '';
  currentLoadedPresetName = '';
  setCompositionDirty(false);
  updateStats();
  updateTrackActionsVisibility();
  studioDeckController.renderAllMixers();
  studioDeckController.updateHistoryBadge();
  sceneManager.updateCurrentScene({
    strokes: [],
  });
  sceneUiController.renderSceneCards();
  presetModalController.updatePresetDeleteButtons();
});

// Shortcuts Cheat Sheet & Math Modals (with Focus Traps + Onboarding Replay)
let releaseShortcutsFocusTrap: (() => void) | null = null;
let releaseInfoFocusTrap: (() => void) | null = null;

function openShortcutsModal(): void {
  if (!shortcutsModal) return;
  shortcutsModal.classList.remove('hidden');
  releaseShortcutsFocusTrap?.();
  releaseShortcutsFocusTrap = activateModalFocusTrap(shortcutsModal);
}

function closeShortcutsModal(): void {
  releaseShortcutsFocusTrap?.();
  releaseShortcutsFocusTrap = null;
  shortcutsModal?.classList.add('hidden');
}

function openInfoModal(): void {
  if (!infoModal) return;
  infoModal.classList.remove('hidden');
  releaseInfoFocusTrap?.();
  releaseInfoFocusTrap = activateModalFocusTrap(infoModal);
}

function closeInfoModal(): void {
  releaseInfoFocusTrap?.();
  releaseInfoFocusTrap = null;
  infoModal?.classList.add('hidden');
}

shortcutsBtn?.addEventListener('click', openShortcutsModal);
closeShortcutsModalBtn?.addEventListener('click', closeShortcutsModal);
shortcutsModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeShortcutsModal);

replayTourBtn?.addEventListener('click', () => {
  closeShortcutsModal();
  onboarding.start(true);
});

shareLinkBtn?.addEventListener('click', async () => {
  try {
    showToast('Generating shareable link...');
    const comp = buildCurrentCompositionExport();
    const { url: shareUrl } = await createShareUrl(comp);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Score link copied to clipboard!');
    } else {
      prompt('Copy your score link:', shareUrl);
    }
  } catch {
    showToast('Could not copy link to clipboard', 'error');
  }
});

infoBtn?.addEventListener('click', openInfoModal);
closeModalBtn?.addEventListener('click', closeInfoModal);
infoModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeInfoModal);

// Master Playhead Synchronization & Randomization
resyncBtn?.addEventListener('click', () => {
  strokeManager.resyncAllPlayheads();
});

randomizePlayheadsBtn?.addEventListener('click', () => {
  strokeManager.clearHistory();
  strokeManager.randomizeAllPlayheads(quantizer, renderer.height);
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
  themeToggleBtn?.setAttribute('aria-pressed', dark ? 'true' : 'false');
  writeStorageKey(STORAGE_KEYS.THEME, dark ? 'dark' : 'light');
  updateTrackActionsVisibility();
}

const savedTheme = readStorageKey(STORAGE_KEYS.THEME);
setTheme(savedTheme === 'dark');

themeToggleBtn?.addEventListener('click', () => {
  const isDark = document.body.classList.contains('dark-mode');
  setTheme(!isDark);
});

// Controls Popover Sidebar Toggle
function setDrawerOpen(open: boolean): void {
  advancedDrawer.style.display = open ? 'block' : 'none';
  if (drawerToggleArrow) drawerToggleArrow.textContent = '';
  drawerToggleBtn?.classList.toggle('active', open);
  drawerToggleBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
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

  const clamped = quantizer.clampScrollY(quantizer.scrollY, renderer.height);
  quantizer.setScrollY(clamped);
  targetScrollY = clamped;
  updatePitchNavigator();
  updateTrackActionsVisibility();
}

fullscreenBtn?.addEventListener('click', toggleFullscreen);

document.addEventListener('fullscreenchange', () => {
  handleResize();
  if (fullscreenBtn) {
    fullscreenBtn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  }
});

// Default Line Harmonizer Voicing Control
defaultHarmonizerSelect?.addEventListener('change', () => {
  if (!defaultHarmonizerSelect) return;
  const mode = defaultHarmonizerSelect.value as HarmonizerMode;
  strokeManager.setDefaultStrokeHarmonizer(mode);
  setCompositionDirty(true);
});

// Organic Timbral Breathing Control
breathingSelect?.addEventListener('change', () => {
  if (!breathingSelect) return;
  const mode = breathingSelect.value as BreathingMode;
  if (studioBreathingSelect) studioBreathingSelect.value = mode;
  strokeManager.setBreathingMode(mode);
  updateBreathingTooltip(mode);
  setCompositionDirty(true);
});

// Warn user if leaving with unsaved changes (production only)
if (typeof window !== 'undefined') {
  if (import.meta.hot) {
    import.meta.hot.on('vite:beforeFullReload', () => {
      isCompositionDirty = false;
    });
  }

  window.addEventListener('beforeunload', (e) => {
    midiController.allNotesOff();
    if (!import.meta.env.DEV && isCompositionDirty && strokeManager.activeStrokes.length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ==========================================================================
// Keyboard Shortcuts (via src/ui/shortcuts.ts)
// ==========================================================================
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

function closeOpenOptionalModal(id: string): boolean {
  const modal = document.getElementById(id);
  if (modal && !modal.classList.contains('hidden')) {
    modal.classList.add('hidden');
    return true;
  }
  return false;
}

const keydownHandler = createKeydownHandler({
  onEscape: () => {
    if (isConfirmDialogOpen()) {
      cancelConfirmDialog();
      return true;
    }
    if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) {
      closeShortcutsModal();
      return true;
    }
    if (presetModalController.isOpen()) {
      presetModalController.closeSavePresetModal();
      return true;
    }
    if (recordExportController.isOpen()) {
      recordExportController.closeModal();
      return true;
    }
    if (infoModal && !infoModal.classList.contains('hidden')) {
      closeInfoModal();
      return true;
    }
    if (closeOpenOptionalModal('exportMp3Modal') || closeOpenOptionalModal('sceneArrangerModal')) {
      return true;
    }
    if (inputHandler.isRedrawing || inputHandler.appMode === 'redraw') {
      setAppMode('draw');
      return true;
    }
    if (advancedDrawer && advancedDrawer.style.display !== 'none') {
      setDrawerOpen(false);
      return true;
    }
    if (strokeManager.selectedStrokeIds.length > 0) {
      strokeManager.selectStroke(null);
      updateTrackActionsVisibility();
      studioDeckController.updateMixerSelection();
      return true;
    }
    return false;
  },
  onUndo: () => {
    strokeManager.undo();
    syncCompositionState();
  },
  onRedo: () => {
    strokeManager.redo();
    syncCompositionState();
  },
  onSave: () => {
    presetModalController.openSavePresetModal(true);
  },
  onSelectAll: () => {
    strokeManager.selectAllStrokes();
    if (strokeManager.selectedStrokeIds.length > 0) {
      onboarding.notifyUserAction('selected_stroke');
    }
    updateTrackActionsVisibility();
    studioDeckController.updateMixerSelection();
  },
  onCopy: () => {
    if (strokeManager.selectedStrokeId) {
      strokeManager.copySelected();
      return true;
    }
    return false;
  },
  onPaste: () => {
    if (strokeManager.hasClipboard()) {
      const newStroke = strokeManager.paste(quantizer, renderer.height);
      if (newStroke) {
        if (soundEngine.isReady) {
          strokeManager.activateAudioVoices();
        }
        syncCompositionState();
      }
      return true;
    }
    return false;
  },
  onDuplicate: () => {
    if (strokeManager.selectedStrokeId) {
      duplicateStrokeWithState(strokeManager.selectedStrokeId);
      syncCompositionState();
      return true;
    }
    return false;
  },
  onRandomizePlayheads: () => {
    strokeManager.clearHistory();
  strokeManager.randomizeAllPlayheads(quantizer, renderer.height);
  },
  onFastForwardStart: () => {
    if (!isFastForwardHeld) {
      isFastForwardHeld = true;
      if (statMode) {
        statMode.textContent = strokeManager.selectedStrokeId ? 'Fast Forwarding (4x)' : 'Fast Forwarding All (4x)';
        statMode.style.color = '#2563eb';
      }
    }
  },
  onRewindStart: () => {
    if (!isRewindHeld) {
      isRewindHeld = true;
      if (statMode) {
        statMode.textContent = strokeManager.selectedStrokeId ? 'Rewinding (4x)' : 'Rewinding All (4x)';
        statMode.style.color = '#2563eb';
      }
    }
  },
  onPlayPause: () => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    void togglePlayPause();
  },
  onDrawMode: () => {
    setAppMode('draw');
  },
  onRedrawOrResync: () => {
    if (strokeManager.activeStrokes.length > 0) {
      if (inputHandler.appMode === 'redraw') {
        setAppMode('draw');
      } else {
        if (!strokeManager.selectedStrokeId) {
          const last = strokeManager.activeStrokes[strokeManager.activeStrokes.length - 1];
          strokeManager.selectStroke(last.id);
        }
        setAppMode('redraw');
      }
    } else {
      showToast('Draw a line first to use Re-draw mode');
    }
  },
  onResyncPlayheads: () => {
    strokeManager.resyncAllPlayheads();
    showToast('Playheads synced to start');
  },
  onToggleLiveMode: () => {
    const nextMode = inputHandler.appMode === 'live' ? 'draw' : 'live';
    setAppMode(nextMode);
  },
  onToggleFullscreen: () => {
    toggleFullscreen();
  },
  onToggleBeatGrid: () => {
    beatGridVisible = !beatGridVisible;
    writeStorageKey('harmonic_beat_grid', beatGridVisible ? '1' : '0');
    studioDeckController.syncMasterSwingAndPerformanceUI(
      strokeManager.swing,
      beatGridVisible,
      strokeManager.quantizedTriggering
    );
    setCompositionDirty(true);
    showToast(beatGridVisible ? 'Beat Grid On' : 'Beat Grid Off');
  },
  onToggleBarQuantize: () => {
    const nextQuantized = !strokeManager.quantizedTriggering;
    strokeManager.setQuantizedTriggering(nextQuantized);
    if (!nextQuantized) {
      pendingSceneId = null;
    }
    studioDeckController.syncMasterSwingAndPerformanceUI(
      strokeManager.swing,
      beatGridVisible,
      nextQuantized
    );
    studioDeckController.renderAllMixers();
    sceneUiController.renderSceneCards();
    setCompositionDirty(true);
    showToast(nextQuantized ? 'Next-Bar Quantize On' : 'Next-Bar Quantize Off');
  },
  onToggleTraversal: () => {
    const targetStrokeId =
      strokeManager.selectedStrokeId ||
      (strokeManager.activeStrokes.length === 1 ? strokeManager.activeStrokes[0].id : null);
    if (targetStrokeId) {
      const stroke = strokeManager.activeStrokes.find((s) => s.id === targetStrokeId);
      if (stroke) {
        if (stroke.isPoint) return;
        const currentTrav =
          stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong' ? 'bounce' : 'restart';
        const nextTrav: TraversalMode = currentTrav === 'bounce' ? 'restart' : 'bounce';
        strokeManager.setStrokeTraversal(stroke.id, nextTrav);
        setCompositionDirty(true);
        updateTrackActionsVisibility();
        studioDeckController.renderAllMixers();
        return;
      }
    }
    const nextDefTrav: TraversalMode = strokeManager.mode === 'bounce' ? 'restart' : 'bounce';
    strokeManager.setTraversalMode(nextDefTrav);
  },
  onMuteOrMixer: () => {
    if (strokeManager.selectedStrokeId) {
      toggleStrokeMuteWithQuantize(strokeManager.selectedStrokeId);
    } else {
      viewModeManager.setMode('studio');
      studioDeckController.switchStudioDeckTab('mixer');
    }
  },
  onSolo: () => {
    if (strokeManager.selectedStrokeId) {
      strokeManager.toggleSolo(strokeManager.selectedStrokeId);
      syncCompositionState();
    }
  },
  onToggleAssistedDrawing: () => {
    setAssistedDrawing(!assistedDrawingEnabled);
  },
  onCycleViewMode: () => {
    viewModeManager.cycleNextMode();
  },
  onSelectInstrumentIndex: (idx) => {
    const instIds = Object.keys(INSTRUMENTS);
    if (instIds[idx]) {
      selectInstrument(instIds[idx]);
    }
  },
  onDeleteSelected: () => {
    if (strokeManager.selectedStrokeIds.length > 0) {
      strokeManager.deleteSelected();
      syncCompositionState();
      return true;
    }
    return false;
  },
  onAdjustVolume: (direction, shiftKey) => {
    const targetIds =
      strokeManager.selectedStrokeIds.length > 0
        ? strokeManager.selectedStrokeIds
        : strokeManager.activeStrokes.length === 1
          ? [strokeManager.activeStrokes[0].id]
          : [];
    if (targetIds.length === 0) return false;

    const step = shiftKey ? 0.15 : 0.05;
    const updated = strokeManager.adjustStrokesVolume(targetIds, direction * step, true);
    if (updated.length > 0) {
      setCompositionDirty(true);
      updateTrackActionsVisibility();
      studioDeckController.renderAllMixers();
      if (statMode) {
        const avgPct = Math.round((updated.reduce((acc, s) => acc + (s.volume ?? 1), 0) / updated.length) * 100);
        statMode.textContent =
          updated.length > 1 ? `Volume (${updated.length} Lines): ~${avgPct}%` : `Line Volume: ${avgPct}%`;
        statMode.style.color = '#2563eb';
      }
    }
    return true;
  },
  onAdjustTiming: (direction, shiftKey) => {
    const targetIds =
      strokeManager.selectedStrokeIds.length > 0
        ? strokeManager.selectedStrokeIds
        : strokeManager.activeStrokes.length === 1
          ? [strokeManager.activeStrokes[0].id]
          : [];
    if (targetIds.length === 0) return false;

    const mult = shiftKey ? 5 : 1;
    const updated = strokeManager.adjustStrokesTempo(targetIds, direction, mult, true);
    if (updated.length > 0) {
      setCompositionDirty(true);
      updateTrackActionsVisibility();
      studioDeckController.renderAllMixers();
      if (statMode) {
        const isStrokeTimer = (s: DrawnStroke) => s.timingMode === 'timer' || s.speedMode === 'timer';
        if (updated.length === 1) {
          const first = updated[0];
          const spd = first.speedMultiplier ?? 1.0;
          const valLabel = isStrokeTimer(first)
            ? `${Math.round(first.duration ?? 30)}s`
            : `${Number.isInteger(Math.round(spd * 100) / 10) ? spd.toFixed(1) : spd.toFixed(2)}x`;
          statMode.textContent = `Line Tempo: ${valLabel}`;
        } else {
          const dirLabel = direction > 0 ? 'Faster' : 'Slower';
          const allTimer = updated.every(isStrokeTimer);
          const allSpeed = updated.every((s) => !isStrokeTimer(s));
          if (allTimer) {
            const avgDur = Math.round(
              updated.reduce((acc, s) => acc + (s.duration ?? 30), 0) / updated.length
            );
            statMode.textContent = `Tempo (${updated.length} Lines): ${dirLabel} (~${avgDur}s)`;
          } else if (allSpeed) {
            const avgSpd =
              updated.reduce((acc, s) => acc + (s.speedMultiplier ?? 1.0), 0) / updated.length;
            statMode.textContent = `Tempo (${updated.length} Lines): ${dirLabel} (~${avgSpd.toFixed(1)}x)`;
          } else {
            statMode.textContent = `Tempo (${updated.length} Lines): ${dirLabel}`;
          }
        }
        statMode.style.color = '#2563eb';
      }
    }
    return true;
  },
  onShowShortcuts: () => {
    openShortcutsModal();
  },
  onScrollPitchUp: () => {
    smoothScrollBy(-quantizer.getPxPerOctave(renderer.height));
  },
  onScrollPitchDown: () => {
    smoothScrollBy(quantizer.getPxPerOctave(renderer.height));
  },
  onScrollPitchHome: () => {
    smoothScrollTo(quantizer.getDefaultScrollY(renderer.height));
  },
});

window.addEventListener('keydown', keydownHandler);

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

// Audio Unlock & Welcome Banner Dismissal on First Interaction (self-cleaning)
const unlockAudioOnGesture = async () => {
  await ensureAudioUnlocked();
  if (soundEngine.isReady) {
    removeAudioUnlockListeners();
  }
  setTimeout(updateTrackActionsVisibility, 50);
};
window.addEventListener('pointerdown', unlockAudioOnGesture, { passive: true });
window.addEventListener('click', unlockAudioOnGesture, { passive: true });
window.addEventListener('keydown', unlockAudioOnGesture, { passive: true });
window.addEventListener('touchstart', unlockAudioOnGesture, { passive: true });

window.addEventListener('pointerup', () => {
  if (strokeManager.selectedStrokeId) {
    updateTrackActionsVisibility();
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    if (active.tagName === 'BUTTON' || (active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'range')) {
      active.blur();
    }
  }
});

document.addEventListener('change', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && t.tagName === 'SELECT') {
    t.blur();
  }
});

window.addEventListener('resize', handleResize);

const canvasContainerEl = document.getElementById('canvasContainer');
if (canvasContainerEl && typeof ResizeObserver !== 'undefined') {
  let resizeRafPending = false;
  const canvasResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    const nextW = Math.round(entry.contentRect.width);
    const nextH = Math.round(entry.contentRect.height);
    if (nextW === Math.round(prevCanvasWidth) && nextH === Math.round(prevCanvasHeight)) {
      return;
    }
    if (resizeRafPending) return;
    resizeRafPending = true;
    requestAnimationFrame(() => {
      resizeRafPending = false;
      handleResize();
    });
  });
  canvasResizeObserver.observe(canvasContainerEl);
}

function updateStats(): void {
  const count = strokeManager.activeStrokes.length;
  if (layerCountBadge) layerCountBadge.textContent = count.toString();
  if (studioLayerCount) studioLayerCount.textContent = count.toString();
  updateAudioStatusChip();
}

// ==========================================================================
// Scene Sequence Progression & Animation Loop (Foreground + Background Audio)
// ==========================================================================
function processSceneSequenceTick(seq: SceneSequenceTickResult, updateDom: boolean): void {
  if (seq.sceneChanged) {
    if (strokeManager.isCrossfadingMorph) {
      strokeManager.updateSceneCrossfade(1.0);
      strokeManager.completeSceneCrossfade();
    } else {
      loadScene(seq.currentScene);
    }

    if (seq.currentScene.scaleId || seq.currentScene.rootId) {
      const scaleKey = (seq.currentScene.scaleId || 'dorian') as keyof typeof SCALES;
      const scaleObj = SCALES[scaleKey] || SCALES.dorian;
      const rootKey = (seq.currentScene.rootId || 'D3') as keyof typeof ROOT_NOTES;
      const rootObj = ROOT_NOTES[rootKey] || ROOT_NOTES.D3;
      quantizer.updateConfig({ scale: scaleObj, root: rootObj });
      if (updateDom) {
        if (scaleSelect) scaleSelect.value = seq.currentScene.scaleId || 'dorian';
        if (rootSelect) rootSelect.value = seq.currentScene.rootId || 'D3';
        updatePitchNavigator();
      }
    }

    strokeManager.setBpm(seq.currentScene.bpm || 32);
    const targetRev = seq.currentScene.spaceReverb ?? 0.65;
    soundEngine.setReverbMix(targetRev);
    currentLoadedPresetName = seq.currentScene.name;

    if (updateDom) {
      syncMasterFxUI();
      studioDeckController.renderAllMixers();
      updateStats();
      sceneUiController.renderSceneCards();
    }
  } else if (seq.isMorphing && seq.nextScene) {
    if (!strokeManager.isCrossfadingMorph) {
      const nextComp: SavedComposition = {
        version: 1,
        name: seq.nextScene.name,
        timestamp: Date.now(),
        bpm: seq.nextScene.bpm || 32,
        scaleId: seq.nextScene.scaleId || 'dorian',
        rootId: seq.nextScene.rootId || 'D3',
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

    const { reverbBoost } = strokeManager.updateSceneCrossfade(seq.morphRatio);

    const curBpm = seq.currentScene.bpm || 32;
    const nextBpm = seq.nextScene.bpm || 32;
    const interpolatedBpm = Math.round(curBpm + (nextBpm - curBpm) * seq.morphRatio);
    if (strokeManager.currentBpm !== interpolatedBpm) {
      strokeManager.setBpm(interpolatedBpm);
      if (updateDom) {
        bpmVal.textContent = `${interpolatedBpm} BPM`;
        if (studioMasterBpmVal) studioMasterBpmVal.textContent = `${interpolatedBpm} BPM`;
      }
    }

    const curRev = seq.currentScene.spaceReverb ?? 0.65;
    const nextRev = seq.nextScene.spaceReverb ?? 0.65;
    const baseRev = curRev + (nextRev - curRev) * seq.morphRatio;
    const finalRev = Math.max(0, Math.min(1, baseRev + reverbBoost));
    soundEngine.setReverbMix(finalRev);
    if (updateDom) {
      if (spaceVal) spaceVal.textContent = `${Math.round(finalRev * 100)}%`;
      if (studioMasterReverbVal) studioMasterReverbVal.textContent = `${Math.round(finalRev * 100)}%`;
    }
  } else if (strokeManager.isCrossfadingMorph) {
    strokeManager.cancelSceneCrossfade();
  }

  if (!updateDom) return;

  const activeProgressBar = document.getElementById(`progress_${seq.currentScene.id}`);
  if (activeProgressBar) {
    activeProgressBar.style.width = `${(seq.progressRatio * 100).toFixed(1)}%`;
  }

  if (sceneCardsList) {
    for (const child of Array.from(sceneCardsList.children)) {
      if (child.getAttribute('data-scene-id') === seq.currentScene.id) {
        child.classList.toggle('is-morphing', seq.isMorphing);
        break;
      }
    }
  }

  const activeBadgeEl = document.getElementById(`badge_${seq.currentScene.id}`);
  if (activeBadgeEl) {
    if (seq.isMorphing) {
      activeBadgeEl.className = 'scene-card-morph-badge';
      const curveLabel =
        sceneManager.getMorphCurveMode() === 'reverbWash' ? 'Atmospheric Morph' : 'Crossfade Overlap';
      activeBadgeEl.textContent = `${curveLabel} ${Math.round(seq.morphRatio * 100)}%`;
    } else {
      activeBadgeEl.className = 'scene-card-badge';
      activeBadgeEl.textContent = 'Active';
    }
  }

  sceneUiController.updateSeqMiniIndicator(seq);
}

let lastTimeMs = 0;
let smoothedDt = 1 / 60;
let animFrameId: number | null = null;
let bgAudioTimer: ReturnType<typeof setInterval> | null = null;

function startBackgroundAudioTicker(): void {
  stopBackgroundAudioTicker();
  if (strokeManager.paused || strokeManager.activeStrokes.length === 0) {
    return;
  }
  let bgLastTime = performance.now();
  bgAudioTimer = setInterval(() => {
    if ((typeof document !== 'undefined' && !document.hidden) || strokeManager.paused) {
      stopBackgroundAudioTicker();
      return;
    }
    const now = performance.now();
    const dt = Math.max(0.005, Math.min(0.06, (now - bgLastTime) / 1000));
    bgLastTime = now;

    strokeManager.update(dt, renderer.width, renderer.height, quantizer);

    if (typeof sceneManager !== 'undefined' && sceneManager.isSequencing() && !strokeManager.paused) {
      const seq = sceneManager.tickSequence(dt);
      processSceneSequenceTick(seq, false);
    }
  }, 25);
}

function stopBackgroundAudioTicker(): void {
  if (bgAudioTimer !== null) {
    clearInterval(bgAudioTimer);
    bgAudioTimer = null;
  }
}

function handleVisibilityChange(): void {
  if (typeof document === 'undefined') return;
  if (document.hidden) {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    startBackgroundAudioTicker();
  } else {
    stopBackgroundAudioTicker();
    lastTimeMs = performance.now();
    smoothedDt = 1 / 60;
    syncMasterFxUI();
    updatePitchNavigator();
    studioDeckController.renderAllMixers();
    sceneUiController.renderSceneCards();
    updateTrackActionsVisibility();
    if (animFrameId === null) {
      animFrameId = requestAnimationFrame(animationLoop);
    }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function animationLoop(nowMs: number): void {
  if (typeof document !== 'undefined' && document.hidden) {
    animFrameId = null;
    startBackgroundAudioTicker();
    return;
  }
  animFrameId = null;

  if (lastTimeMs === 0) {
    lastTimeMs = nowMs;
  }
  const rawDt = (nowMs - lastTimeMs) / 1000;
  lastTimeMs = nowMs;

  if (rawDt > 0.12) {
    smoothedDt = 1 / 60;
  } else {
    const clampedDt = Math.max(0.001, Math.min(0.064, rawDt));
    smoothedDt = smoothedDt * 0.75 + clampedDt * 0.25;
  }

  // 0. Smooth Kinetic Inertial Scrolling for Pitch Register
  if (isScrollAnimating || Math.abs(targetScrollY - quantizer.scrollY) > 0.05) {
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
    strokeManager.scrubStroke(
      strokeManager.selectedStrokeId,
      rewindRate,
      smoothedDt,
      renderer.width,
      renderer.height,
      quantizer
    );
  }

  // 1b. Update Scene Arranger progression sequence if active
  if (typeof sceneManager !== 'undefined' && sceneManager.isSequencing()) {
    if (!strokeManager.paused) {
      const seq = sceneManager.tickSequence(smoothedDt);
      processSceneSequenceTick(seq, true);
    }
  } else if (seqMiniIndicator) {
    seqMiniIndicator.style.display = 'none';
  }

  // 2. Static Cache Key (clear, guidelines, drum zones, base strokes + active redraw / selected badge)
  const showDrumZones =
    currentInstrumentId === 'onyx' ||
    strokeManager.activeStrokes.some((s) => s.instrumentId === 'onyx' && (s.selected || s.hovered));

  const hasSolo = strokeManager.hasSoloedStrokes;
  const isMultiSelection = strokeManager.selectedStrokeIds.length > 1;
  const isRedraw = inputHandler.isRedrawing || inputHandler.appMode === 'redraw';
  const redrawingId = inputHandler.activeRedrawStrokeId || (isRedraw ? strokeManager.selectedStrokeId : null);
  const activeRedrawKey = activeDrawingPoints.length > 0 && redrawingId ? redrawingId : '';
  const qConfig = quantizer.getConfig();

  let singleSelProgressKey = '';
  if (!isMultiSelection && strokeManager.selectedStrokeId) {
    const selStroke = strokeManager.getStroke(strokeManager.selectedStrokeId);
    if (selStroke) {
      const totalLen = Math.max(1, selStroke.lut.totalLength);
      const progressPct = Math.round((selStroke.playhead.currentDistance / totalLen) * 100);
      const speedKey =
        selStroke.timingMode === 'timer' || selStroke.speedMode === 'timer'
          ? `t${Math.round(selStroke.duration ?? 30)}`
          : `s${(selStroke.speedMultiplier ?? 1).toFixed(2)}`;
      const travKey = selStroke.traversal ?? 'restart';
      const pitchKey =
        (selStroke.isPoint || selStroke.instrumentId === 'onyx') && selStroke.playhead.lastPitch
          ? `${selStroke.playhead.lastPitch.noteName}:${Math.round(selStroke.playhead.lastPitch.frequency)}`
          : '';
      singleSelProgressKey = `${selStroke.id}:${progressPct}:${speedKey}:${travKey}:${pitchKey}`;
    }
  }

  const staticCacheKey = [
    Math.round(renderer.width),
    Math.round(renderer.height),
    renderer.isDarkMode ? 1 : 0,
    Math.round(quantizer.scrollY * 10),
    qConfig.scale.id,
    qConfig.root.name,
    qConfig.octaveSpan,
    showDrumZones ? 1 : 0,
    hasSolo ? 1 : 0,
    isMultiSelection ? 1 : 0,
    strokeManager.sceneVersion,
    activeRedrawKey,
    singleSelProgressKey,
  ].join('|');

  renderer.renderStaticLayer(staticCacheKey, () => {
    renderer.clear();
    renderer.drawGuidelines(quantizer.getGuidelines(renderer.height));
    renderer.drawDrumZones(showDrumZones, quantizer);
    renderer.drawWorldLayer(quantizer.scrollY, () => {
      for (const stroke of strokeManager.activeStrokes) {
        const isBeingRedrawn = activeDrawingPoints.length > 0 && redrawingId === stroke.id;
        renderer.drawStroke(stroke, hasSolo, isMultiSelection, isBeingRedrawn);
      }
    });
  });

  // 4. Beat Grid & 4-beat visual measure tracker
  renderer.drawBeatGrid(strokeManager.measureProgress, beatGridVisible);
  renderer.drawBeatTracker(strokeManager.measureProgress, strokeManager.measureBeatIndex);

  // Audio band energies computed once per frame for reactive spectrum + playheads
  const freqData = soundEngine.isReady ? soundEngine.getFrequencyData() : null;
  const bands = soundEngine.isReady ? soundEngine.getBandEnergies() : null;

  // 5. Render dynamic playheads & active drawing gesture in world coordinate layer
  renderer.drawWorldLayer(quantizer.scrollY, () => {
    for (const stroke of strokeManager.activeStrokes) {
      let bandBoost = 0;
      if (bands) {
        if (stroke.instrumentId === 'onyx') {
          bandBoost = bands.low;
        } else if (stroke.style === 'dotted') {
          bandBoost = bands.high;
        } else {
          bandBoost = bands.mid;
        }
      }
      renderer.drawPlayhead(stroke, nowMs, hasSolo, bandBoost);
    }

    if (activeDrawingPoints.length > 0) {
      let gestureColor = getInstrumentColor(currentInstrumentId, renderer.isDarkMode);
      if (isRedraw && redrawingId) {
        const targetStroke = strokeManager.getStroke(redrawingId);
        if (targetStroke) {
          gestureColor = renderer.getStrokeColor(targetStroke);
        }
      }
      renderer.drawActiveGesture(activeDrawingPoints, gestureColor);
    }
  });

  // 5c. Disappearing live trail
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

  // 7. Audio-Reactive Ambient Spectrum & Glow (multi-band + master)
  if (freqData && bands) {
    renderer.drawAudioReactiveSpectrum(freqData, bands.master, bands);
  }

  // 8. Canvas Marquee Selection Box & Empty-Canvas Ghost Hint
  renderer.drawMarqueeSelection(inputHandler.marqueeRect);
  renderer.drawEmptyCanvasGhostHint(
    nowMs,
    strokeManager.activeStrokes.length === 0 && activeDrawingPoints.length === 0
  );

  animFrameId = requestAnimationFrame(animationLoop);
}

strokeManager.onTriggerSpark = (x: number, y: number, color: string, count = 6, _instrumentId?: string) => {
  const screenY = quantizer.worldToScreenY(y, renderer.height);
  renderer.spawnSparks(x, screenY, color, count);
};

inputHandler.onLiveTrigger = (x: number, y: number, color: string) => {
  renderer.spawnSparks(x, y, color, 8, 1.2);
};

// URL Composition Loader (?track=... or #score=...)
async function checkSharedCompositionUrl(): Promise<boolean> {
  const urlParams = new URLSearchParams(window.location.search);
  const trackId = urlParams.get('track');
  if (trackId) {
    showToast('Loading shared track...');
    const scoreData = await fetchSharedTrack(trackId);
    if (scoreData) {
      currentLoadedTemplateId = '';
      await loadComposition(scoreData);
      showToast(`Loaded score "${scoreData.name || 'Shared Score'}"`);
      return true;
    }
    showToast('Could not load shared track.', 'error');
  }

  const hash = window.location.hash;
  if (hash.startsWith('#score=')) {
    const encoded = hash.slice('#score='.length);
    const parsedComp = decodeCompositionBase64Url(encoded);
    if (parsedComp) {
      currentLoadedTemplateId = '';
      await loadComposition(parsedComp);
      showToast(`Loaded score "${parsedComp.name || 'Shared Score'}"`);
      return true;
    }
    showToast('Shared score link could not be decoded.', 'error');
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
updateBreathingTooltip();

(async () => {
  const loadedFromUrl = await checkSharedCompositionUrl();
  if (!loadedFromUrl) {
    await loadTemplate('cathedralSolitude', false);
  }
  targetScrollY = quantizer.scrollY;
  updateStats();
  updateTrackActionsVisibility();
  if (typeof document === 'undefined' || !document.hidden) {
    animFrameId = requestAnimationFrame(animationLoop);
  } else {
    startBackgroundAudioTicker();
  }
})();
