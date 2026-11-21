import type { StrokeManager } from '../engine/strokeManager';
import type { CanvasRenderer } from '../canvas/renderer';
import type { ScaleQuantizer } from '../audio/scaleQuantizer';
import type { SoundEngine, ReverbType } from '../audio/audioContext';
import type { InputHandler } from '../canvas/inputHandler';
import type { ViewModeManager } from './viewModes';
import type {
  MidiController,
  MidiChannelMode,
  MidiLearnTarget,
} from '../audio/midiController';
import type { ABSnapshotManager, ABSlot } from './abSnapshot';
import type {
  BreathingMode,
  DrawnStroke,
  HarmonizerMode,
  SavedComposition,
  TimingMode,
  TraversalMode,
  WaveShapeType,
  XAxisModulationMode,
} from '../engine/types';
import type { SplinePath } from '../math/types';
import type { WaveParams } from '../math/waveShape';
import { SCALES, ROOT_NOTES } from '../audio/scales';
import { getInstrument } from '../audio/instruments';
import { STORAGE_KEYS, readStorageKey, writeStorageKey } from './storage';
import { bindSliderUndo } from './sliderUndo';
import { showToast } from './toast';

export interface StudioDeckDeps {
  strokeManager: StrokeManager;
  renderer: CanvasRenderer;
  quantizer: ScaleQuantizer;
  soundEngine: SoundEngine;
  inputHandler: InputHandler;
  viewModeManager: ViewModeManager;
  midiController: MidiController;
  abSnapshot: ABSnapshotManager;
  buildCurrentCompositionSnapshot: () => SavedComposition;
  onCompositionDirty: (dirty: boolean) => void;
  onSyncCompositionState: () => void;
  onUpdateTrackActionsVisibility: () => void;
  onSetAppMode: (mode: 'draw' | 'redraw' | 'live') => void;
  onDuplicateStroke: (strokeId: string) => DrawnStroke | null;
  onApplySnapshot: (snapshot: SavedComposition) => Promise<void> | void;
  onBeatGridChange: (visible: boolean) => void;
  onQuantizedChange: (enabled: boolean) => void;
  onMidiCcTargetApplied: () => void;
  onRenderSceneCards?: () => void;
}

interface WaveReshapeSnapshot {
  strokeId: string;
  oldPath: SplinePath;
  oldWaveParams?: WaveParams;
}

interface MultiTimingInitialRecord {
  strokeId: string;
  oldTimingMode: TimingMode;
  oldSpeed: number;
  oldDuration: number;
}

export class StudioDeckController {
  private cleanups: Array<() => void> = [];
  private mixerCardCleanups: Array<() => void> = [];
  private isInspectorCollapsed = false;
  private isDeckCollapsed = false;
  private beatGridVisible = false;
  private midiDevicesHandler: (() => void) | null = null;
  private midiCcHandler: ((target: MidiLearnTarget, normalizedValue: number, cc: number) => void) | null = null;

  constructor(
    private readonly deps: StudioDeckDeps,
    private readonly root: Document = document
  ) {
    this.isInspectorCollapsed = readStorageKey(STORAGE_KEYS.INSPECTOR_COLLAPSED) === 'true';
  }

  private listen<K extends keyof HTMLElementEventMap>(
    el: EventTarget | null | undefined,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    bucket: Array<() => void> = this.cleanups
  ): void {
    if (!el) return;
    const listener = handler as EventListener;
    el.addEventListener(type, listener);
    bucket.push(() => el.removeEventListener(type, listener));
  }

  private cloneSplinePath(path: SplinePath): SplinePath {
    return {
      isClosed: path.isClosed,
      segments: path.segments.map((seg) => ({
        p0: { ...seg.p0 },
        p1: { ...seg.p1 },
        p2: { ...seg.p2 },
        p3: { ...seg.p3 },
      })),
    };
  }

  private cloneWaveParams(wp?: WaveParams): WaveParams | undefined {
    if (!wp) return undefined;
    return {
      ...wp,
      baseP0: { ...wp.baseP0 },
      baseP1: { ...wp.baseP1 },
    };
  }

  private formatStrokeTimingTag(stroke: DrawnStroke): string {
    const isTimer = stroke.timingMode === 'timer' || stroke.speedMode === 'timer';
    if (isTimer) {
      return `${Math.round(stroke.duration ?? 30)}s`;
    }
    return `${(stroke.speedMultiplier ?? 1.0).toFixed(2)}x`;
  }

  private getEffectiveWavePeriods(stroke?: DrawnStroke): number {
    const studioWavePeriodSlider = this.root.getElementById('studioWavePeriodSlider') as HTMLInputElement | null;
    return stroke?.waveParams?.periods ?? (Number(studioWavePeriodSlider?.value) || 2);
  }

  private getEffectiveWaveShape(stroke?: DrawnStroke): WaveShapeType {
    const studioWaveShapeSelect = this.root.getElementById('studioWaveShapeSelect') as HTMLSelectElement | null;
    if (studioWaveShapeSelect?.value) {
      return studioWaveShapeSelect.value as WaveShapeType;
    }
    const studioWaveShapeButtons = this.root.querySelectorAll<HTMLButtonElement>(
      '#studioWaveShapeGroup [data-wave-shape]'
    );
    const activeBtn = Array.from(studioWaveShapeButtons).find((b) => b.classList.contains('active'));
    const btnShape = activeBtn?.getAttribute('data-wave-shape') as WaveShapeType | null;
    return btnShape ?? stroke?.waveParams?.shapeType ?? 'sine';
  }

  private captureWaveReshapeSnapshot(): WaveReshapeSnapshot | undefined {
    const id = this.deps.strokeManager.selectedStrokeId;
    const stroke = id ? this.deps.strokeManager.getStroke(id) : undefined;
    if (!stroke) return undefined;
    return {
      strokeId: stroke.id,
      oldPath: this.cloneSplinePath(stroke.path),
      oldWaveParams: this.cloneWaveParams(stroke.waveParams),
    };
  }

  private syncBpmUI(bpm: number): void {
    const bpmSlider = this.root.getElementById('bpmSlider') as HTMLInputElement | null;
    const bpmVal = this.root.getElementById('bpmVal');
    const studioMasterBpmSlider = this.root.getElementById('studioMasterBpmSlider') as HTMLInputElement | null;
    const studioMasterBpmVal = this.root.getElementById('studioMasterBpmVal');

    if (bpmSlider) bpmSlider.value = bpm.toString();
    if (bpmVal) bpmVal.textContent = `${bpm} BPM`;
    if (studioMasterBpmSlider) studioMasterBpmSlider.value = bpm.toString();
    if (studioMasterBpmVal) studioMasterBpmVal.textContent = `${bpm} BPM`;
  }

  private syncReverbUI(mix: number): void {
    const pct = Math.round(mix * 100);
    const spaceSlider = this.root.getElementById('spaceSlider') as HTMLInputElement | null;
    const spaceVal = this.root.getElementById('spaceVal');
    const studioMasterReverbSlider = this.root.getElementById('studioMasterReverbSlider') as HTMLInputElement | null;
    const studioMasterReverbVal = this.root.getElementById('studioMasterReverbVal');

    if (spaceSlider) spaceSlider.value = pct.toString();
    if (spaceVal) spaceVal.textContent = `${pct}%`;
    if (studioMasterReverbSlider) studioMasterReverbSlider.value = pct.toString();
    if (studioMasterReverbVal) studioMasterReverbVal.textContent = `${pct}%`;
  }

  private syncStereoWidthUI(width: number): void {
    const pct = Math.round(width * 100);
    const text = pct === 100 ? '100% (Stereo)' : (pct === 0 ? '0% (Mono)' : `${pct}%`);
    const stereoWidthSlider = this.root.getElementById('stereoWidthSlider') as HTMLInputElement | null;
    const stereoWidthVal = this.root.getElementById('stereoWidthVal');
    const studioStereoWidthSlider = this.root.getElementById('studioStereoWidthSlider') as HTMLInputElement | null;
    const studioStereoWidthVal = this.root.getElementById('studioStereoWidthVal');

    if (stereoWidthSlider) stereoWidthSlider.value = pct.toString();
    if (stereoWidthVal) stereoWidthVal.textContent = text;
    if (studioStereoWidthSlider) studioStereoWidthSlider.value = pct.toString();
    if (studioStereoWidthVal) studioStereoWidthVal.textContent = text;
  }

  private syncTapeWarmthUI(warmth: number): void {
    const pct = Math.round(warmth * 100);
    const tapeWarmthSlider = this.root.getElementById('tapeWarmthSlider') as HTMLInputElement | null;
    const tapeWarmthVal = this.root.getElementById('tapeWarmthVal');
    const studioTapeWarmthSlider = this.root.getElementById('studioTapeWarmthSlider') as HTMLInputElement | null;
    const studioTapeWarmthVal = this.root.getElementById('studioTapeWarmthVal');

    if (tapeWarmthSlider) tapeWarmthSlider.value = pct.toString();
    if (tapeWarmthVal) tapeWarmthVal.textContent = pct === 0 ? '0% (Clean)' : `${pct}%`;
    if (studioTapeWarmthSlider) studioTapeWarmthSlider.value = pct.toString();
    if (studioTapeWarmthVal) studioTapeWarmthVal.textContent = `${pct}%`;
  }

  private syncDuckingUI(depth: number): void {
    const pct = Math.round(depth * 100);
    const duckingSlider = this.root.getElementById('duckingSlider') as HTMLInputElement | null;
    const duckingVal = this.root.getElementById('duckingVal');
    const studioDuckingSlider = this.root.getElementById('studioDuckingSlider') as HTMLInputElement | null;
    const studioDuckingVal = this.root.getElementById('studioDuckingVal');

    if (duckingSlider) duckingSlider.value = pct.toString();
    if (duckingVal) duckingVal.textContent = pct === 0 ? '0% (Off)' : `${pct}%`;
    if (studioDuckingSlider) studioDuckingSlider.value = pct.toString();
    if (studioDuckingVal) studioDuckingVal.textContent = `${pct}%`;
  }

  private syncMasterFxControls(): void {
    const { strokeManager, soundEngine } = this.deps;
    this.syncBpmUI(strokeManager.currentBpm);
    this.syncReverbUI(soundEngine.reverbMix);

    const revType = soundEngine.reverbType;
    const reverbTypeSelect = this.root.getElementById('reverbTypeSelect') as HTMLSelectElement | null;
    const studioReverbTypeSelect = this.root.getElementById('studioReverbTypeSelect') as HTMLSelectElement | null;
    if (reverbTypeSelect) reverbTypeSelect.value = revType;
    if (studioReverbTypeSelect) studioReverbTypeSelect.value = revType;

    this.syncStereoWidthUI(soundEngine.stereoWidth);
    this.syncTapeWarmthUI(soundEngine.tapeWarmth);
    this.syncDuckingUI(soundEngine.duckingDepth);

    const scaleSelect = this.root.getElementById('scaleSelect') as HTMLSelectElement | null;
    const rootSelect = this.root.getElementById('rootSelect') as HTMLSelectElement | null;
    const xAxisSelect = this.root.getElementById('xAxisSelect') as HTMLSelectElement | null;
    const breathingSelect = this.root.getElementById('breathingSelect') as HTMLSelectElement | null;
    const studioScaleSelect = this.root.getElementById('studioScaleSelect') as HTMLSelectElement | null;
    const studioRootSelect = this.root.getElementById('studioRootSelect') as HTMLSelectElement | null;
    const studioXAxisSelect = this.root.getElementById('studioXAxisSelect') as HTMLSelectElement | null;
    const studioBreathingSelect = this.root.getElementById('studioBreathingSelect') as HTMLSelectElement | null;

    if (studioScaleSelect && scaleSelect) studioScaleSelect.value = scaleSelect.value;
    if (studioRootSelect && rootSelect) studioRootSelect.value = rootSelect.value;
    if (studioXAxisSelect && xAxisSelect) studioXAxisSelect.value = xAxisSelect.value;
    if (studioBreathingSelect && breathingSelect) studioBreathingSelect.value = breathingSelect.value;

    this.syncMasterSwingAndPerformanceUI(
      strokeManager.swing,
      this.beatGridVisible,
      strokeManager.quantizedTriggering
    );
  }

  private applyMidiControlChange(target: MidiLearnTarget, normalizedValue: number): void {
    const val = Math.max(0, Math.min(1, normalizedValue));
    const { strokeManager, soundEngine } = this.deps;

    switch (target) {
      case 'bpm': {
        const bpm = Math.round(10 + val * 230);
        strokeManager.setBpm(bpm);
        this.syncBpmUI(bpm);
        break;
      }
      case 'reverb': {
        soundEngine.setReverbMix(val);
        this.syncReverbUI(val);
        break;
      }
      case 'stereoWidth': {
        const width = val * 2;
        soundEngine.setStereoWidth(width);
        this.syncStereoWidthUI(width);
        break;
      }
      case 'tapeWarmth': {
        soundEngine.setTapeWarmth(val);
        this.syncTapeWarmthUI(val);
        break;
      }
      case 'ducking': {
        soundEngine.setDuckingDepth(val);
        this.syncDuckingUI(val);
        break;
      }
      case 'swing': {
        const swing = Math.round(val * 75) / 100;
        strokeManager.setSwing(swing);
        this.syncMasterSwingAndPerformanceUI(
          strokeManager.swing,
          this.beatGridVisible,
          strokeManager.quantizedTriggering
        );
        break;
      }
      case 'selectedFilter': {
        if (strokeManager.selectedStrokeId) {
          strokeManager.setStrokeFilterCutoff(strokeManager.selectedStrokeId, val, false);
          this.updateStudioDockedInspector();
        }
        break;
      }
      case 'selectedDistortion': {
        if (strokeManager.selectedStrokeId) {
          strokeManager.setStrokeDistortion(strokeManager.selectedStrokeId, val, false);
          this.updateStudioDockedInspector();
        }
        break;
      }
      case 'selectedVolume': {
        if (strokeManager.selectedStrokeId) {
          const selectedId = strokeManager.selectedStrokeId;
          strokeManager.setStrokeVolume(selectedId, val, false);
          const pct = Math.round(val * 100);
          const zenContextVolSlider = this.root.getElementById('zenContextVolSlider') as HTMLInputElement | null;
          if (zenContextVolSlider) {
            zenContextVolSlider.value = String(pct);
          }
          const studioMixerList = this.root.getElementById('studioMixerList');
          const card = studioMixerList?.querySelector<HTMLElement>(`[data-stroke-id="${selectedId}"]`);
          const cardVolSlider = card?.querySelector<HTMLInputElement>('.layer-vol-slider');
          const cardVolVal = card?.querySelector<HTMLElement>('.layer-vol-val');
          if (cardVolSlider) cardVolSlider.value = String(pct);
          if (cardVolVal) cardVolVal.textContent = `${pct}%`;
        }
        break;
      }
      default: {
        const _exhaustive: never = target;
        void _exhaustive;
      }
    }

    this.deps.onCompositionDirty(true);
    this.deps.onMidiCcTargetApplied();
  }

  private isStudioMixerVisible(): boolean {
    const mode = this.deps.viewModeManager.getMode();
    if (mode !== 'studio') return false;
    const studioTabBtnMixer = this.root.getElementById('studioTabBtnMixer');
    if (studioTabBtnMixer && !studioTabBtnMixer.classList.contains('active')) return false;
    return true;
  }

  private createLayerCard(
    stroke: DrawnStroke,
    idx: number,
    hasSolo: boolean
  ): { card: HTMLElement; cleanup: () => void } {
    const { strokeManager, renderer, inputHandler } = this.deps;
    const pendingMuteIds = strokeManager.getPendingMuteIds();
    const isQueuedMute = pendingMuteIds.has(stroke.id);

    const card = this.root.createElement('div');
    const isSelected = strokeManager.isStrokeSelected(stroke.id);
    const isDimmed = (hasSolo && !stroke.soloed) || Boolean(stroke.muted);

    card.className = `layer-card${isSelected ? ' selected' : ''}${isDimmed ? ' dimmed' : ''}${isQueuedMute ? ' is-queued-next-bar' : ''}`;
    card.setAttribute('data-stroke-id', stroke.id);

    const inst = getInstrument(stroke.instrumentId);
    const instName = inst.name;
    const color = renderer.getStrokeColor(stroke);
    const volPct = Math.round((stroke.volume ?? 1.0) * 100);
    const revPct = Math.round((stroke.reverb ?? strokeManager.defaultStrokeReverb) * 100);
    const timingTag = this.formatStrokeTimingTag(stroke);

    // Top row (identity + actions) built safely via createElement / textContent
    const topRow = this.root.createElement('div');
    topRow.className = 'layer-card-top';

    const identity = this.root.createElement('div');
    identity.className = 'layer-identity';

    const dotEl = this.root.createElement('span');
    dotEl.className = 'layer-dot';
    dotEl.style.background = color;

    const nameEl = this.root.createElement('span');
    nameEl.className = 'layer-name';
    const displayName = `#${idx + 1} ${instName}`;
    nameEl.title = displayName;
    nameEl.textContent = displayName;

    const tagEl = this.root.createElement('span');
    tagEl.className = 'layer-tag';
    tagEl.textContent = timingTag;

    identity.append(dotEl, nameEl, tagEl);

    if (isQueuedMute) {
      const queuedPill = this.root.createElement('span');
      queuedPill.className = 'queued-bar-pill is-queued-next-bar';
      queuedPill.textContent = 'Next Bar';
      identity.appendChild(queuedPill);
    }

    const actions = this.root.createElement('div');
    actions.className = 'layer-actions';

    const redrawBtn = this.root.createElement('button');
    redrawBtn.type = 'button';
    redrawBtn.className = `layer-btn${inputHandler.isRedrawing && strokeManager.selectedStrokeId === stroke.id ? ' active' : ''}`;
    redrawBtn.setAttribute('data-action', 'redraw');
    redrawBtn.title = 'Re-draw line path (R)';
    redrawBtn.textContent = '↻';

    const muteCardBtn = this.root.createElement('button');
    muteCardBtn.type = 'button';
    muteCardBtn.className = `layer-btn${stroke.muted ? ' active-mute' : ''}${isQueuedMute ? ' is-queued-next-bar' : ''}`;
    muteCardBtn.setAttribute('data-action', 'mute');
    muteCardBtn.title = strokeManager.quantizedTriggering ? 'Queue Mute on Next Bar (M)' : 'Mute line (M)';
    muteCardBtn.textContent = 'M';

    const soloCardBtn = this.root.createElement('button');
    soloCardBtn.type = 'button';
    soloCardBtn.className = `layer-btn${stroke.soloed ? ' active-solo' : ''}`;
    soloCardBtn.setAttribute('data-action', 'solo');
    soloCardBtn.title = 'Solo line (S)';
    soloCardBtn.textContent = 'S';

    const dupBtn = this.root.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'layer-btn';
    dupBtn.setAttribute('data-action', 'duplicate');
    dupBtn.title = 'Duplicate line (⌘D)';
    dupBtn.textContent = '⧉';

    const delBtn = this.root.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'layer-btn text-danger';
    delBtn.setAttribute('data-action', 'delete');
    delBtn.title = 'Delete line (Backspace)';
    delBtn.textContent = '✕';

    actions.append(redrawBtn, muteCardBtn, soloCardBtn, dupBtn, delBtn);
    topRow.append(identity, actions);

    // Controls row (Vol & Rev sliders)
    const controlsRow = this.root.createElement('div');
    controlsRow.className = 'layer-controls-row';

    const volGroup = this.root.createElement('div');
    volGroup.className = 'layer-slider-group';
    const volLabel = this.root.createElement('span');
    volLabel.className = 'layer-slider-label';
    volLabel.textContent = 'Vol';
    const volSlider = this.root.createElement('input');
    volSlider.type = 'range';
    volSlider.className = 'minimal-slider layer-vol-slider';
    volSlider.min = '0';
    volSlider.max = '100';
    volSlider.step = '1';
    volSlider.value = String(volPct);
    const volVal = this.root.createElement('span');
    volVal.className = 'layer-slider-val layer-vol-val';
    volVal.textContent = `${volPct}%`;
    volGroup.append(volLabel, volSlider, volVal);

    const revGroup = this.root.createElement('div');
    revGroup.className = 'layer-slider-group';
    const revLabel = this.root.createElement('span');
    revLabel.className = 'layer-slider-label';
    revLabel.textContent = 'Rev';
    const revSlider = this.root.createElement('input');
    revSlider.type = 'range';
    revSlider.className = 'minimal-slider layer-rev-slider';
    revSlider.min = '0';
    revSlider.max = '100';
    revSlider.step = '1';
    revSlider.value = String(revPct);
    const revVal = this.root.createElement('span');
    revVal.className = 'layer-slider-val layer-rev-val';
    revVal.textContent = `${revPct}%`;
    revGroup.append(revLabel, revSlider, revVal);

    controlsRow.append(volGroup, revGroup);
    card.append(topRow, controlsRow);

    const cardListeners: Array<() => void> = [];

    this.listen(
      card,
      'pointerdown',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.closest('button') || target.closest('input'))) return;
        const studioTabBtnMaster = this.root.getElementById('studioTabBtnMaster');
        if (studioTabBtnMaster?.classList.contains('active')) {
          this.switchStudioDeckTab('mixer');
        }
        if (e.metaKey || e.ctrlKey) {
          strokeManager.toggleSelectStroke(stroke.id);
        } else {
          strokeManager.selectStroke(stroke.id);
        }
        this.deps.onUpdateTrackActionsVisibility();
        this.updateMixerSelection();
      },
      cardListeners
    );

    this.listen(
      redrawBtn,
      'click',
      (e) => {
        e.stopPropagation();
        strokeManager.selectStroke(stroke.id);
        if (inputHandler.appMode === 'redraw') {
          this.deps.onSetAppMode('draw');
        } else {
          this.deps.onSetAppMode('redraw');
        }
      },
      cardListeners
    );

    this.listen(
      muteCardBtn,
      'click',
      (e) => {
        e.stopPropagation();
        if (strokeManager.quantizedTriggering) {
          strokeManager.queueToggleMute(stroke.id);
          if (strokeManager.paused) {
            this.deps.onSyncCompositionState();
          } else {
            this.renderAllMixers();
          }
        } else {
          strokeManager.toggleMute(stroke.id);
          this.deps.onSyncCompositionState();
        }
      },
      cardListeners
    );

    this.listen(
      soloCardBtn,
      'click',
      (e) => {
        e.stopPropagation();
        strokeManager.toggleSolo(stroke.id);
        this.deps.onSyncCompositionState();
      },
      cardListeners
    );

    this.listen(
      dupBtn,
      'click',
      (e) => {
        e.stopPropagation();
        this.deps.onDuplicateStroke(stroke.id);
        this.deps.onSyncCompositionState();
      },
      cardListeners
    );

    this.listen(
      delBtn,
      'click',
      (e) => {
        e.stopPropagation();
        strokeManager.removeStroke(stroke.id);
        this.deps.onSyncCompositionState();
      },
      cardListeners
    );

    const stopPropagation = (e: Event) => e.stopPropagation();
    this.listen(volSlider, 'pointerdown', stopPropagation, cardListeners);
    const unbindVol = bindSliderUndo<number>(volSlider, {
      captureInitial: () => {
        const s = strokeManager.getStroke(stroke.id);
        return s ? (s.volume ?? 1.0) : undefined;
      },
      onInput: (val) => {
        const v = val / 100;
        volVal.textContent = `${Math.round(val)}%`;
        strokeManager.setStrokeVolume(stroke.id, v, false);
        this.deps.onCompositionDirty(true);
        const zenContextVolSlider = this.root.getElementById('zenContextVolSlider') as HTMLInputElement | null;
        if (stroke.id === strokeManager.selectedStrokeId && zenContextVolSlider) {
          zenContextVolSlider.value = String(Math.round(val));
        }
      },
      onCommit: (initial, val) => {
        const v = Math.max(0, Math.min(1, val / 100));
        strokeManager.setStrokeVolume(stroke.id, v, false);
        strokeManager.commitStrokePropertyUndo(stroke.id, 'volume', initial, v);
        this.deps.onCompositionDirty(true);
        this.updateHistoryBadge();
      },
    });

    this.listen(revSlider, 'pointerdown', stopPropagation, cardListeners);
    const unbindRev = bindSliderUndo<number>(revSlider, {
      captureInitial: () => {
        const s = strokeManager.getStroke(stroke.id);
        return s ? (s.reverb ?? strokeManager.defaultStrokeReverb) : undefined;
      },
      onInput: (val) => {
        const r = val / 100;
        revVal.textContent = `${Math.round(val)}%`;
        strokeManager.setStrokeReverb(stroke.id, r, false);
        this.deps.onCompositionDirty(true);
      },
      onCommit: (initial, val) => {
        const r = Math.max(0, Math.min(1, Math.round(val) / 100));
        strokeManager.setStrokeReverb(stroke.id, r, false);
        strokeManager.commitStrokePropertyUndo(stroke.id, 'reverb', initial, r);
        this.deps.onCompositionDirty(true);
        this.updateHistoryBadge();
      },
    });

    const cleanup = () => {
      while (cardListeners.length > 0) {
        cardListeners.pop()?.();
      }
      unbindVol();
      unbindRev();
    };

    return { card, cleanup };
  }

  public init(): void {
    this.destroy();

    const { strokeManager, renderer, quantizer, soundEngine, inputHandler, midiController, abSnapshot } = this.deps;

    // 1. Studio Deck Tab Switching & Rail Collapse
    const studioTabBtnMixer = this.root.getElementById('studioTabBtnMixer');
    const studioTabBtnMaster = this.root.getElementById('studioTabBtnMaster');
    const studioTabBtnScenes = this.root.getElementById('studioTabBtnScenes');
    const studioDeckCollapseBtn = this.root.getElementById('studioDeckCollapseBtn');

    this.listen(studioTabBtnMixer, 'click', () => {
      if (this.isDeckCollapsed) this.setDeckCollapsed(false);
      this.switchStudioDeckTab('mixer');
    });
    this.listen(studioTabBtnMaster, 'click', () => {
      if (this.isDeckCollapsed) this.setDeckCollapsed(false);
      this.switchStudioDeckTab('master');
    });
    this.listen(studioTabBtnScenes, 'click', () => {
      if (this.isDeckCollapsed) this.setDeckCollapsed(false);
      this.switchStudioDeckTab('scenes');
    });

    this.listen(studioDeckCollapseBtn, 'click', (e) => {
      e.stopPropagation();
      this.setDeckCollapsed(!this.isDeckCollapsed);
    });

    const win = this.root.defaultView;
    if (win && win.innerWidth > 0 && win.innerWidth <= 1024) {
      this.setDeckCollapsed(true);
    }

    // 2. Utility Strip: History Badge & A/B Snapshot Comparison
    const abCaptureBtn = this.root.getElementById('abCaptureBtn');
    const abCompareBtn = this.root.getElementById('abCompareBtn');

    this.listen(abCaptureBtn, 'click', () => {
      abSnapshot.captureA(this.deps.buildCurrentCompositionSnapshot());
      this.updateABSnapshotButtons();
      showToast('Captured Snapshot A');
    });

    this.listen(abCompareBtn, 'click', () => {
      const result = abSnapshot.toggle(this.deps.buildCurrentCompositionSnapshot());
      if (!result) return;
      void Promise.resolve(this.deps.onApplySnapshot(result.snapshot)).then(() => {
        this.updateABSnapshotButtons();
      });
    });

    // 3. Studio Master FX & Performance Controls
    const studioMasterBpmSlider = this.root.getElementById('studioMasterBpmSlider') as HTMLInputElement | null;
    const studioMasterSwingSlider = this.root.getElementById('studioMasterSwingSlider') as HTMLInputElement | null;
    const studioMasterReverbSlider = this.root.getElementById('studioMasterReverbSlider') as HTMLInputElement | null;
    const studioReverbTypeSelect = this.root.getElementById('studioReverbTypeSelect') as HTMLSelectElement | null;
    const studioStereoWidthSlider = this.root.getElementById('studioStereoWidthSlider') as HTMLInputElement | null;
    const studioTapeWarmthSlider = this.root.getElementById('studioTapeWarmthSlider') as HTMLInputElement | null;
    const studioDuckingSlider = this.root.getElementById('studioDuckingSlider') as HTMLInputElement | null;
    const studioScaleSelect = this.root.getElementById('studioScaleSelect') as HTMLSelectElement | null;
    const studioRootSelect = this.root.getElementById('studioRootSelect') as HTMLSelectElement | null;
    const studioXAxisSelect = this.root.getElementById('studioXAxisSelect') as HTMLSelectElement | null;
    const studioBreathingSelect = this.root.getElementById('studioBreathingSelect') as HTMLSelectElement | null;
    const beatGridToggle = this.root.getElementById('beatGridToggle');
    const quantizedTriggerToggle = this.root.getElementById('quantizedTriggerToggle');
    const studioSyncBtn = this.root.getElementById('studioSyncBtn');
    const studioRandomizeBtn = this.root.getElementById('studioRandomizeBtn');
    const studioMuteAllBtn = this.root.getElementById('studioMuteAllBtn');
    const studioUnmuteAllBtn = this.root.getElementById('studioUnmuteAllBtn');

    this.listen(studioMasterBpmSlider, 'input', () => {
      if (!studioMasterBpmSlider) return;
      const bpm = parseInt(studioMasterBpmSlider.value, 10);
      strokeManager.setBpm(bpm);
      this.syncBpmUI(bpm);
      this.deps.onCompositionDirty(true);
    });

    this.listen(studioMasterSwingSlider, 'input', () => {
      if (!studioMasterSwingSlider) return;
      const rawVal = parseFloat(studioMasterSwingSlider.value);
      if (Number.isNaN(rawVal)) return;
      const isUnit = parseFloat(studioMasterSwingSlider.max || '75') <= 1.0;
      const swing = isUnit ? rawVal : rawVal / 100;
      strokeManager.setSwing(swing);
      const studioMasterSwingVal = this.root.getElementById('studioMasterSwingVal');
      if (studioMasterSwingVal) {
        studioMasterSwingVal.textContent = `${Math.round(strokeManager.swing * 100)}%`;
      }
      this.deps.onCompositionDirty(true);
    });

    this.listen(studioMasterReverbSlider, 'input', () => {
      if (!studioMasterReverbSlider) return;
      const pct = parseInt(studioMasterReverbSlider.value, 10);
      soundEngine.setReverbMix(pct / 100);
      this.syncReverbUI(pct / 100);
      this.deps.onCompositionDirty(true);
    });

    this.listen(studioReverbTypeSelect, 'change', () => {
      if (!studioReverbTypeSelect) return;
      const type = studioReverbTypeSelect.value as ReverbType;
      soundEngine.setReverbType(type);
      const reverbTypeSelect = this.root.getElementById('reverbTypeSelect') as HTMLSelectElement | null;
      if (reverbTypeSelect) reverbTypeSelect.value = type;
      this.deps.onCompositionDirty(true);
    });

    this.listen(studioStereoWidthSlider, 'input', () => {
      if (!studioStereoWidthSlider) return;
      const pct = parseInt(studioStereoWidthSlider.value, 10);
      soundEngine.setStereoWidth(pct / 100);
      this.syncStereoWidthUI(pct / 100);
      this.deps.onCompositionDirty(true);
    });

    this.listen(studioTapeWarmthSlider, 'input', () => {
      if (!studioTapeWarmthSlider) return;
      const pct = parseInt(studioTapeWarmthSlider.value, 10);
      soundEngine.setTapeWarmth(pct / 100);
      this.syncTapeWarmthUI(pct / 100);
      this.deps.onCompositionDirty(true);
    });

    this.listen(studioDuckingSlider, 'input', () => {
      if (!studioDuckingSlider) return;
      const pct = parseInt(studioDuckingSlider.value, 10);
      soundEngine.setDuckingDepth(pct / 100);
      this.syncDuckingUI(pct / 100);
      this.deps.onCompositionDirty(true);
    });

    this.listen(studioScaleSelect, 'change', () => {
      if (!studioScaleSelect) return;
      const scaleKey = studioScaleSelect.value;
      const scaleSelect = this.root.getElementById('scaleSelect') as HTMLSelectElement | null;
      if (scaleSelect) scaleSelect.value = scaleKey;
      if (SCALES[scaleKey]) {
        quantizer.updateConfig({ scale: SCALES[scaleKey] });
        this.deps.onCompositionDirty(true);
        this.deps.onMidiCcTargetApplied();
      }
    });

    this.listen(studioRootSelect, 'change', () => {
      if (!studioRootSelect) return;
      const rootKey = studioRootSelect.value;
      const rootSelect = this.root.getElementById('rootSelect') as HTMLSelectElement | null;
      if (rootSelect) rootSelect.value = rootKey;
      if (ROOT_NOTES[rootKey]) {
        quantizer.updateConfig({ root: ROOT_NOTES[rootKey] });
        this.deps.onCompositionDirty(true);
        this.deps.onMidiCcTargetApplied();
      }
    });

    this.listen(studioXAxisSelect, 'change', () => {
      if (!studioXAxisSelect) return;
      const mode = studioXAxisSelect.value as XAxisModulationMode;
      const xAxisSelect = this.root.getElementById('xAxisSelect') as HTMLSelectElement | null;
      if (xAxisSelect) xAxisSelect.value = mode;
      strokeManager.setXAxisModulationMode(mode);
      this.deps.onCompositionDirty(true);
    });

    this.listen(studioBreathingSelect, 'change', () => {
      if (!studioBreathingSelect) return;
      const mode = studioBreathingSelect.value as BreathingMode;
      const breathingSelect = this.root.getElementById('breathingSelect') as HTMLSelectElement | null;
      if (breathingSelect) breathingSelect.value = mode;
      strokeManager.setBreathingMode(mode);
      this.deps.onCompositionDirty(true);
    });

    if (beatGridToggle) {
      const isCheckbox =
        beatGridToggle.tagName.toUpperCase() === 'INPUT' &&
        (beatGridToggle as HTMLInputElement).type === 'checkbox';
      this.listen(beatGridToggle, isCheckbox ? 'change' : 'click', () => {
        const next = isCheckbox
          ? (beatGridToggle as HTMLInputElement).checked
          : !this.beatGridVisible;
        this.beatGridVisible = next;
        this.syncMasterSwingAndPerformanceUI(
          strokeManager.swing,
          next,
          strokeManager.quantizedTriggering
        );
        this.deps.onBeatGridChange(next);
        this.deps.onCompositionDirty(true);
      });
    }

    if (quantizedTriggerToggle) {
      const isCheckbox =
        quantizedTriggerToggle.tagName.toUpperCase() === 'INPUT' &&
        (quantizedTriggerToggle as HTMLInputElement).type === 'checkbox';
      this.listen(quantizedTriggerToggle, isCheckbox ? 'change' : 'click', () => {
        const next = isCheckbox
          ? (quantizedTriggerToggle as HTMLInputElement).checked
          : !strokeManager.quantizedTriggering;
        strokeManager.setQuantizedTriggering(next);
        this.syncMasterSwingAndPerformanceUI(
          strokeManager.swing,
          this.beatGridVisible,
          next
        );
        this.deps.onQuantizedChange(next);
        this.deps.onCompositionDirty(true);
        this.renderAllMixers();
      });
    }

    this.listen(studioSyncBtn, 'click', () => {
      strokeManager.resyncAllPlayheads();
    });

    this.listen(studioRandomizeBtn, 'click', () => {
      strokeManager.randomizeAllPlayheads(quantizer, renderer.height);
    });

    this.listen(studioMuteAllBtn, 'click', () => {
      strokeManager.activeStrokes.forEach((s) => strokeManager.setStrokeMuted(s.id, true));
      this.deps.onSyncCompositionState();
    });

    this.listen(studioUnmuteAllBtn, 'click', () => {
      strokeManager.activeStrokes.forEach((s) => strokeManager.setStrokeMuted(s.id, false));
      this.deps.onSyncCompositionState();
    });

    // 4. Web MIDI I/O Panel Controls
    const midiEnableBtn = this.root.getElementById('midiEnableBtn');
    const midiOutputSelect = this.root.getElementById('midiOutputSelect') as HTMLSelectElement | null;
    const midiInputSelect = this.root.getElementById('midiInputSelect') as HTMLSelectElement | null;
    const midiChannelSelect = this.root.getElementById('midiChannelSelect') as HTMLSelectElement | null;
    const midiLearnTargetSelect = this.root.getElementById('midiLearnTargetSelect') as HTMLSelectElement | null;
    const midiLearnBtn = this.root.getElementById('midiLearnBtn');

    this.listen(midiEnableBtn, 'click', () => {
      if (midiController.isEnabled()) {
        midiController.disable();
        this.refreshMidiUi();
        return;
      }
      void midiController.enable().then((res) => {
        if (!res.supported) {
          showToast('Web MIDI API is unavailable or permission was denied.', 'error');
        }
        this.refreshMidiUi();
      });
    });

    this.listen(midiOutputSelect, 'change', () => {
      if (!midiOutputSelect) return;
      midiController.setOutput(midiOutputSelect.value || null);
    });

    this.listen(midiInputSelect, 'change', () => {
      if (!midiInputSelect) return;
      midiController.setInput(midiInputSelect.value || null);
    });

    this.listen(midiChannelSelect, 'change', () => {
      if (!midiChannelSelect) return;
      midiController.setChannelMode((midiChannelSelect.value || 'auto') as MidiChannelMode);
    });

    this.listen(midiLearnBtn, 'click', () => {
      if (midiController.getLearningTarget() !== null) {
        midiController.cancelMidiLearn();
        this.refreshMidiUi();
        return;
      }
      const target = (midiLearnTargetSelect?.value || 'bpm') as MidiLearnTarget;
      midiController.startMidiLearn(target, (cc, learnedTarget) => {
        showToast(`Mapped CC #${cc} to ${learnedTarget}`);
        this.refreshMidiUi();
      });
      this.refreshMidiUi();
    });

    this.midiDevicesHandler = () => {
      this.refreshMidiUi();
    };
    midiController.onDevicesChange = this.midiDevicesHandler;

    this.midiCcHandler = (target: MidiLearnTarget, normalizedValue: number) => {
      this.applyMidiControlChange(target, normalizedValue);
    };
    midiController.onControlChange = this.midiCcHandler;

    // 5. Docked Line Inspector Controls
    const studioVoicingSelect = this.root.getElementById('studioVoicingSelect') as HTMLSelectElement | null;
    const studioTimingToggle = this.root.getElementById('studioTimingToggle');
    const studioTimingModeLabel = this.root.getElementById('studioTimingModeLabel');
    const studioTimingSlider = this.root.getElementById('studioTimingSlider') as HTMLInputElement | null;
    const studioTimingVal = this.root.getElementById('studioTimingVal');
    const studioTraversalSwitch = this.root.getElementById('studioTraversalSwitch');
    const studioWaveShapeSelect = this.root.getElementById('studioWaveShapeSelect') as HTMLSelectElement | null;
    const studioWaveShapeButtons = this.root.querySelectorAll<HTMLButtonElement>(
      '#studioWaveShapeGroup [data-wave-shape]'
    );
    const studioWaveSineBtn = this.root.getElementById('studioWaveSineBtn');
    const studioWaveAmpSlider = this.root.getElementById('studioWaveAmpSlider') as HTMLInputElement | null;
    const studioWaveAmpVal = this.root.getElementById('studioWaveAmpVal');
    const studioWavePeriodSlider = this.root.getElementById('studioWavePeriodSlider') as HTMLInputElement | null;
    const studioWavePeriodVal = this.root.getElementById('studioWavePeriodVal');
    const studioFluctuationSlider = this.root.getElementById('studioFluctuationSlider') as HTMLInputElement | null;
    const studioFluctuationVal = this.root.getElementById('studioFluctuationVal');
    const studioDistortionSlider = this.root.getElementById('studioDistortionSlider') as HTMLInputElement | null;
    const studioDistortionVal = this.root.getElementById('studioDistortionVal');
    const studioFilterSlider = this.root.getElementById('studioFilterSlider') as HTMLInputElement | null;
    const studioFilterVal = this.root.getElementById('studioFilterVal');
    const studioLofiSlider = this.root.getElementById('studioLofiSlider') as HTMLInputElement | null;
    const studioLofiVal = this.root.getElementById('studioLofiVal');
    const studioArticulationSlider = this.root.getElementById('studioArticulationSlider') as HTMLInputElement | null;
    const studioArticulationVal = this.root.getElementById('studioArticulationVal');
    const studioRedrawTrackBtn = this.root.getElementById('studioRedrawTrackBtn');
    const studioDupTrackBtn = this.root.getElementById('studioDupTrackBtn');
    const studioDelTrackBtn = this.root.getElementById('studioDelTrackBtn');
    const studioDeselectTrackBtn = this.root.getElementById('studioDeselectTrackBtn');
    const dockedInspectorToggleBtn = this.root.getElementById('dockedInspectorToggleBtn');
    const studioDockedInspector = this.root.getElementById('studioDockedInspector');
    const dockedInspectorHeader = studioDockedInspector?.querySelector('.docked-inspector-header') ?? null;

    this.listen(studioVoicingSelect, 'change', () => {
      if (!studioVoicingSelect || !strokeManager.selectedStrokeId) return;
      const mode = studioVoicingSelect.value as HarmonizerMode;
      strokeManager.setStrokeHarmonizer(strokeManager.selectedStrokeId, mode);
      this.deps.onCompositionDirty(true);
      this.deps.onUpdateTrackActionsVisibility();
      this.updateHistoryBadge();
    });

    studioTimingToggle?.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
      this.listen(b, 'click', () => {
        if (!strokeManager.selectedStrokeId) return;
        const mode = b.getAttribute('data-timing-mode') as 'speed' | 'timer' | null;
        if (!mode) return;
        strokeManager.setStrokeTimingMode(strokeManager.selectedStrokeId, mode, renderer.width);
        if (studioTimingModeLabel) {
          studioTimingModeLabel.textContent = mode === 'timer' ? 'Timer' : 'Speed';
        }
        this.deps.onCompositionDirty(true);
        this.deps.onUpdateTrackActionsVisibility();
        this.renderAllMixers();
        this.updateHistoryBadge();
      });
    });

    if (studioTimingSlider) {
      const unbindTiming = bindSliderUndo<{ strokeId: string; isTimer: boolean; initialValue: number }>(
        studioTimingSlider,
        {
          captureInitial: () => {
            const stroke = strokeManager.selectedStrokeId
              ? strokeManager.getStroke(strokeManager.selectedStrokeId)
              : undefined;
            if (!stroke) return undefined;
            const isTimer = stroke.timingMode === 'timer' || stroke.speedMode === 'timer';
            return {
              strokeId: stroke.id,
              isTimer,
              initialValue: isTimer ? (stroke.duration ?? 30) : (stroke.speedMultiplier ?? 1.0),
            };
          },
          onInput: (val) => {
            const stroke = strokeManager.selectedStrokeId
              ? strokeManager.getStroke(strokeManager.selectedStrokeId)
              : undefined;
            if (!stroke) return;
            const isTimer = stroke.timingMode === 'timer' || stroke.speedMode === 'timer';
            if (isTimer) {
              const dur = Math.round(val);
              if (studioTimingVal) studioTimingVal.textContent = `${dur}s`;
              strokeManager.setStrokeDuration(stroke.id, dur, false);
            } else {
              if (studioTimingVal) studioTimingVal.textContent = `${val.toFixed(2)}x`;
              strokeManager.setStrokeSpeed(stroke.id, val, false);
            }
            this.updateMixerCardTimingTag(stroke);
            this.deps.onCompositionDirty(true);
          },
          onCommit: (initial, val) => {
            if (initial.isTimer) {
              const dur = Math.max(1, Math.min(300, Math.round(val)));
              strokeManager.setStrokeDuration(initial.strokeId, dur, false);
              strokeManager.commitStrokePropertyUndo(initial.strokeId, 'duration', initial.initialValue, dur);
            } else {
              const spd = Math.max(0.05, Math.min(5.0, Math.round(val * 100) / 100));
              strokeManager.setStrokeSpeed(initial.strokeId, spd, false);
              strokeManager.commitStrokePropertyUndo(initial.strokeId, 'speedMultiplier', initial.initialValue, spd);
            }
            this.deps.onCompositionDirty(true);
            this.renderAllMixers();
            this.updateHistoryBadge();
          },
        }
      );
      this.cleanups.push(unbindTiming);
    }

    studioTraversalSwitch?.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
      this.listen(b, 'click', () => {
        if (!strokeManager.selectedStrokeId) return;
        const trav = b.getAttribute('data-track-traversal') as TraversalMode | null;
        if (!trav) return;
        strokeManager.setStrokeTraversal(strokeManager.selectedStrokeId, trav);
        this.deps.onCompositionDirty(true);
        this.deps.onUpdateTrackActionsVisibility();
        this.renderAllMixers();
        this.updateHistoryBadge();
      });
    });

    this.listen(studioWaveShapeSelect, 'change', () => {
      if (!studioWaveShapeSelect || !strokeManager.selectedStrokeId) return;
      const stroke = strokeManager.getStroke(strokeManager.selectedStrokeId);
      if (!stroke) return;
      const shape = studioWaveShapeSelect.value as WaveShapeType;
      const amp =
        stroke.waveParams && stroke.waveParams.amplitude > 0
          ? stroke.waveParams.amplitude
          : Math.max(10, studioWaveAmpSlider ? parseFloat(studioWaveAmpSlider.value) || 20 : 20);
      const periods = this.getEffectiveWavePeriods(stroke);
      strokeManager.restructureStrokeWave(stroke.id, amp, periods, shape, true);
      this.deps.onCompositionDirty(true);
      this.deps.onUpdateTrackActionsVisibility();
      this.updateHistoryBadge();
    });

    studioWaveShapeButtons.forEach((btn) => {
      this.listen(btn, 'click', () => {
        if (!strokeManager.selectedStrokeId) return;
        const stroke = strokeManager.getStroke(strokeManager.selectedStrokeId);
        if (!stroke) return;
        const shape = btn.getAttribute('data-wave-shape') as WaveShapeType | null;
        if (!shape) return;
        const amp =
          stroke.waveParams && stroke.waveParams.amplitude > 0
            ? stroke.waveParams.amplitude
            : Math.max(10, studioWaveAmpSlider ? parseFloat(studioWaveAmpSlider.value) || 20 : 20);
        const periods = this.getEffectiveWavePeriods(stroke);
        strokeManager.restructureStrokeWave(stroke.id, amp, periods, shape, true);
        this.deps.onCompositionDirty(true);
        this.deps.onUpdateTrackActionsVisibility();
        this.updateHistoryBadge();
      });
    });

    this.listen(studioWaveSineBtn, 'click', () => {
      if (!strokeManager.selectedStrokeId) return;
      const stroke = strokeManager.getStroke(strokeManager.selectedStrokeId);
      if (!stroke) return;
      const hasWave = (stroke.waveParams?.amplitude ?? 0) > 0;
      const periods = this.getEffectiveWavePeriods(stroke);
      const shape = this.getEffectiveWaveShape(stroke);
      strokeManager.restructureStrokeWave(stroke.id, hasWave ? 0 : 20, periods, shape, true);
      this.deps.onCompositionDirty(true);
      this.deps.onUpdateTrackActionsVisibility();
      this.updateHistoryBadge();
    });

    if (studioWaveAmpSlider) {
      const unbindAmp = bindSliderUndo<WaveReshapeSnapshot>(studioWaveAmpSlider, {
        captureInitial: () => this.captureWaveReshapeSnapshot(),
        onInput: (amp) => {
          const stroke = strokeManager.selectedStrokeId
            ? strokeManager.getStroke(strokeManager.selectedStrokeId)
            : undefined;
          if (!stroke) return;
          if (studioWaveAmpVal) studioWaveAmpVal.textContent = `${Math.round(amp)}px`;
          if (studioWaveSineBtn) studioWaveSineBtn.classList.toggle('active', amp > 0);
          const shape = this.getEffectiveWaveShape(stroke);
          const periods = this.getEffectiveWavePeriods(stroke);
          strokeManager.restructureStrokeWave(stroke.id, amp, periods, shape, false);
          this.deps.onCompositionDirty(true);
        },
        onCommit: (initial, amp) => {
          const stroke = strokeManager.getStroke(initial.strokeId);
          if (!stroke) return;
          const shape = this.getEffectiveWaveShape(stroke);
          const periods = this.getEffectiveWavePeriods(stroke);
          strokeManager.restructureStrokeWave(stroke.id, amp, periods, shape, false);
          const unchanged =
            initial.oldWaveParams &&
            stroke.waveParams &&
            Math.abs(initial.oldWaveParams.amplitude - stroke.waveParams.amplitude) < 0.001 &&
            Math.abs(initial.oldWaveParams.periods - stroke.waveParams.periods) < 0.001 &&
            initial.oldWaveParams.shapeType === stroke.waveParams.shapeType;
          if (!unchanged) {
            strokeManager.commitStrokeReshapeUndo(
              stroke.id,
              initial.oldPath,
              stroke.path,
              initial.oldWaveParams,
              this.cloneWaveParams(stroke.waveParams)
            );
          }
          this.deps.onCompositionDirty(true);
          this.updateHistoryBadge();
        },
      });
      this.cleanups.push(unbindAmp);
    }

    if (studioWavePeriodSlider) {
      const unbindPeriod = bindSliderUndo<WaveReshapeSnapshot>(studioWavePeriodSlider, {
        captureInitial: () => this.captureWaveReshapeSnapshot(),
        onInput: (periods) => {
          const stroke = strokeManager.selectedStrokeId
            ? strokeManager.getStroke(strokeManager.selectedStrokeId)
            : undefined;
          if (!stroke) return;
          if (studioWavePeriodVal) {
            studioWavePeriodVal.textContent = Number.isInteger(periods) ? `${periods}` : periods.toFixed(1);
          }
          const shape = this.getEffectiveWaveShape(stroke);
          const amp =
            stroke.waveParams?.amplitude ??
            (studioWaveAmpSlider ? parseFloat(studioWaveAmpSlider.value) || 0 : 0);
          strokeManager.restructureStrokeWave(stroke.id, amp, periods, shape, false);
          this.deps.onCompositionDirty(true);
        },
        onCommit: (initial, periods) => {
          const stroke = strokeManager.getStroke(initial.strokeId);
          if (!stroke) return;
          const shape = this.getEffectiveWaveShape(stroke);
          const amp =
            stroke.waveParams?.amplitude ??
            (studioWaveAmpSlider ? parseFloat(studioWaveAmpSlider.value) || 0 : 0);
          strokeManager.restructureStrokeWave(stroke.id, amp, periods, shape, false);
          const unchanged =
            initial.oldWaveParams &&
            stroke.waveParams &&
            Math.abs(initial.oldWaveParams.amplitude - stroke.waveParams.amplitude) < 0.001 &&
            Math.abs(initial.oldWaveParams.periods - stroke.waveParams.periods) < 0.001 &&
            initial.oldWaveParams.shapeType === stroke.waveParams.shapeType;
          if (!unchanged) {
            strokeManager.commitStrokeReshapeUndo(
              stroke.id,
              initial.oldPath,
              stroke.path,
              initial.oldWaveParams,
              this.cloneWaveParams(stroke.waveParams)
            );
          }
          this.deps.onCompositionDirty(true);
          this.updateHistoryBadge();
        },
      });
      this.cleanups.push(unbindPeriod);
    }

    if (studioFluctuationSlider) {
      const isUnitRange = parseFloat(studioFluctuationSlider.max || '100') <= 1.5;
      const unbindFluc = bindSliderUndo<{ strokeId: string; initialValue: number }>(studioFluctuationSlider, {
        captureInitial: () => {
          const s = strokeManager.selectedStrokeId
            ? strokeManager.getStroke(strokeManager.selectedStrokeId)
            : undefined;
          return s
            ? {
                strokeId: s.id,
                initialValue:
                  typeof s.fluctuation === 'number' ? s.fluctuation : strokeManager.defaultStrokeFluctuation,
              }
            : undefined;
        },
        onInput: (val) => {
          if (!strokeManager.selectedStrokeId) return;
          const fluc = isUnitRange ? val : Math.round(val) / 100;
          if (studioFluctuationVal) {
            studioFluctuationVal.textContent = isUnitRange ? fluc.toFixed(2) : `${Math.round(fluc * 100)}%`;
          }
          strokeManager.setStrokeFluctuation(strokeManager.selectedStrokeId, fluc, false);
          this.deps.onCompositionDirty(true);
        },
        onCommit: (initial, val) => {
          const fluc = Math.max(0, Math.min(1, Math.round((isUnitRange ? val : val / 100) * 100) / 100));
          strokeManager.setStrokeFluctuation(initial.strokeId, fluc, false);
          strokeManager.commitStrokePropertyUndo(initial.strokeId, 'fluctuation', initial.initialValue, fluc);
          this.deps.onCompositionDirty(true);
          this.updateHistoryBadge();
        },
      });
      this.cleanups.push(unbindFluc);
    }

    if (studioDistortionSlider) {
      const unbindDist = bindSliderUndo<{ strokeId: string; initialValue: number }>(studioDistortionSlider, {
        captureInitial: () => {
          const s = strokeManager.selectedStrokeId
            ? strokeManager.getStroke(strokeManager.selectedStrokeId)
            : undefined;
          return s
            ? { strokeId: s.id, initialValue: typeof s.distortion === 'number' ? s.distortion : 0.0 }
            : undefined;
        },
        onInput: (val) => {
          if (!strokeManager.selectedStrokeId) return;
          const d = val / 100;
          if (studioDistortionVal) studioDistortionVal.textContent = `${Math.round(d * 100)}%`;
          strokeManager.setStrokeDistortion(strokeManager.selectedStrokeId, d, false);
          this.deps.onCompositionDirty(true);
        },
        onCommit: (initial, val) => {
          const d = Math.max(0, Math.min(1, Math.round(val) / 100));
          strokeManager.setStrokeDistortion(initial.strokeId, d, false);
          strokeManager.commitStrokePropertyUndo(initial.strokeId, 'distortion', initial.initialValue, d);
          this.deps.onCompositionDirty(true);
          this.updateHistoryBadge();
        },
      });
      this.cleanups.push(unbindDist);
    }

    if (studioFilterSlider) {
      const unbindFilter = bindSliderUndo<{ strokeId: string; initialValue: number }>(studioFilterSlider, {
        captureInitial: () => {
          const s = strokeManager.selectedStrokeId
            ? strokeManager.getStroke(strokeManager.selectedStrokeId)
            : undefined;
          return s
            ? { strokeId: s.id, initialValue: typeof s.filterCutoff === 'number' ? s.filterCutoff : 1.0 }
            : undefined;
        },
        onInput: (val) => {
          if (!strokeManager.selectedStrokeId) return;
          const c = val / 100;
          if (studioFilterVal) studioFilterVal.textContent = `${Math.round(c * 100)}%`;
          strokeManager.setStrokeFilterCutoff(strokeManager.selectedStrokeId, c, false);
          this.deps.onCompositionDirty(true);
        },
        onCommit: (initial, val) => {
          const c = Math.max(0, Math.min(1, Math.round(val) / 100));
          strokeManager.setStrokeFilterCutoff(initial.strokeId, c, false);
          strokeManager.commitStrokePropertyUndo(initial.strokeId, 'filterCutoff', initial.initialValue, c);
          this.deps.onCompositionDirty(true);
          this.updateHistoryBadge();
        },
      });
      this.cleanups.push(unbindFilter);
    }

    if (studioLofiSlider) {
      const unbindLofi = bindSliderUndo<{ strokeId: string; initialValue: number }>(studioLofiSlider, {
        captureInitial: () => {
          const s = strokeManager.selectedStrokeId
            ? strokeManager.getStroke(strokeManager.selectedStrokeId)
            : undefined;
          return s ? { strokeId: s.id, initialValue: typeof s.lofi === 'number' ? s.lofi : 0.0 } : undefined;
        },
        onInput: (val) => {
          if (!strokeManager.selectedStrokeId) return;
          const cr = val / 100;
          if (studioLofiVal) studioLofiVal.textContent = `${Math.round(cr * 100)}%`;
          strokeManager.setStrokeLofi(strokeManager.selectedStrokeId, cr, false);
          this.deps.onCompositionDirty(true);
        },
        onCommit: (initial, val) => {
          const cr = Math.max(0, Math.min(1, Math.round(val) / 100));
          strokeManager.setStrokeLofi(initial.strokeId, cr, false);
          strokeManager.commitStrokePropertyUndo(initial.strokeId, 'lofi', initial.initialValue, cr);
          this.deps.onCompositionDirty(true);
          this.updateHistoryBadge();
        },
      });
      this.cleanups.push(unbindLofi);
    }

    if (studioArticulationSlider) {
      const unbindArticulation = bindSliderUndo<{ strokeId: string; initialValue: number }>(
        studioArticulationSlider,
        {
          captureInitial: () => {
            const s = strokeManager.selectedStrokeId
              ? strokeManager.getStroke(strokeManager.selectedStrokeId)
              : undefined;
            return s
              ? {
                  strokeId: s.id,
                  initialValue: typeof s.articulation === 'number' ? s.articulation : 1.0,
                }
              : undefined;
          },
          onInput: (val) => {
            if (!strokeManager.selectedStrokeId) return;
            const art = Math.max(0.2, Math.min(2.5, val / 100));
            if (studioArticulationVal) {
              studioArticulationVal.textContent = `${Math.round(art * 100)}%`;
            }
            strokeManager.setStrokeArticulation(strokeManager.selectedStrokeId, art, false);
            this.deps.onCompositionDirty(true);
          },
          onCommit: (initial, val) => {
            const art = Math.max(0.2, Math.min(2.5, Math.round(val) / 100));
            strokeManager.setStrokeArticulation(initial.strokeId, art, false);
            strokeManager.commitStrokePropertyUndo(initial.strokeId, 'articulation', initial.initialValue, art);
            this.deps.onCompositionDirty(true);
            this.updateHistoryBadge();
          },
        }
      );
      this.cleanups.push(unbindArticulation);
    }

    this.listen(studioRedrawTrackBtn, 'click', () => {
      if (strokeManager.selectedStrokeId) {
        if (inputHandler.appMode === 'redraw') {
          this.deps.onSetAppMode('draw');
        } else {
          this.deps.onSetAppMode('redraw');
        }
      }
    });

    this.listen(studioDupTrackBtn, 'click', () => {
      if (strokeManager.selectedStrokeId) {
        this.deps.onDuplicateStroke(strokeManager.selectedStrokeId);
        this.deps.onSyncCompositionState();
      }
    });

    this.listen(studioDelTrackBtn, 'click', () => {
      if (strokeManager.selectedStrokeId) {
        strokeManager.deleteSelected();
        this.deps.onSyncCompositionState();
      }
    });

    this.listen(studioDeselectTrackBtn, 'click', () => {
      strokeManager.selectStroke(null);
      this.deps.onUpdateTrackActionsVisibility();
      this.renderAllMixers();
    });

    // 5b. Multi-Selection Speed Sync & Actions
    const studioMultiSpeedSlider = this.root.getElementById('studioMultiSpeedSlider') as HTMLInputElement | null;
    const studioMultiSpeedVal = this.root.getElementById('studioMultiSpeedVal');
    const studioMultiTimingState = this.root.getElementById('studioMultiTimingState');
    const studioMultiSyncSpeedBtn = this.root.getElementById('studioMultiSyncSpeedBtn');
    const studioMultiMatchFirstBtn = this.root.getElementById('studioMultiMatchFirstBtn');
    const studioMultiDelBtn = this.root.getElementById('studioMultiDelBtn');
    const studioMultiDeselectBtn = this.root.getElementById('studioMultiDeselectBtn');

    if (studioMultiSpeedSlider) {
      const unbindMultiSpeed = bindSliderUndo<MultiTimingInitialRecord[]>(studioMultiSpeedSlider, {
        captureInitial: () => {
          const ids = strokeManager.selectedStrokeIds;
          if (ids.length <= 1) return undefined;
          const initial: MultiTimingInitialRecord[] = [];
          for (const id of ids) {
            const s = strokeManager.getStroke(id);
            if (!s) continue;
            initial.push({
              strokeId: s.id,
              oldTimingMode: s.timingMode ?? (s.speedMode === 'timer' ? 'timer' : 'speed'),
              oldSpeed: s.speedMultiplier ?? 1.0,
              oldDuration: s.duration ?? 30,
            });
          }
          return initial.length > 0 ? initial : undefined;
        },
        onInput: (val) => {
          const ids = strokeManager.selectedStrokeIds;
          if (ids.length <= 1) return;
          const spd = Math.max(0.05, Math.min(5.0, Math.round(val * 100) / 100));
          if (studioMultiSpeedVal) studioMultiSpeedVal.textContent = `${spd.toFixed(2)}x`;
          if (studioMultiTimingState) studioMultiTimingState.textContent = `${spd.toFixed(2)}x`;
          strokeManager.syncStrokesToSameSpeed(ids, spd, false);
          for (const id of ids) {
            const s = strokeManager.getStroke(id);
            if (s) this.updateMixerCardTimingTag(s);
          }
          this.deps.onCompositionDirty(true);
        },
        onCommit: (initial, val) => {
          const spd = Math.max(0.05, Math.min(5.0, Math.round(val * 100) / 100));
          const ids = initial.map((r) => r.strokeId);
          strokeManager.syncStrokesToSameSpeed(ids, spd, false);
          strokeManager.commitBatchTimingUndo(
            initial.map((r) => ({
              strokeId: r.strokeId,
              oldTimingMode: r.oldTimingMode,
              newTimingMode: 'speed',
              oldSpeed: r.oldSpeed,
              newSpeed: spd,
              oldDuration: r.oldDuration,
              newDuration: r.oldDuration,
            }))
          );
          this.deps.onCompositionDirty(true);
          this.deps.onUpdateTrackActionsVisibility();
          this.renderAllMixers();
          this.updateHistoryBadge();
        },
      });
      this.cleanups.push(unbindMultiSpeed);
    }

    this.listen(studioMultiSyncSpeedBtn, 'click', () => {
      const ids = strokeManager.selectedStrokeIds;
      if (ids.length <= 1) return;
      const targetSpeed = Math.max(0.05, Math.min(5.0, parseFloat(studioMultiSpeedSlider?.value || '1.0') || 1.0));
      strokeManager.syncStrokesToSameSpeed(ids, targetSpeed, true);
      this.deps.onSyncCompositionState();
      this.updateStudioDockedInspector();
      showToast(`Synced ${ids.length} lines to ${targetSpeed.toFixed(2)}x`);
    });

    this.listen(studioMultiMatchFirstBtn, 'click', () => {
      const ids = strokeManager.selectedStrokeIds;
      if (ids.length <= 1) return;
      const first = strokeManager.getStroke(ids[0]);
      if (!first) return;
      const isTimer = first.timingMode === 'timer' || first.speedMode === 'timer';
      if (isTimer) {
        const dur = Math.round(first.duration ?? 30);
        strokeManager.syncStrokesToSameDuration(ids, dur, true);
        showToast(`Matched ${ids.length} lines to ${dur}s`);
      } else {
        const spd = first.speedMultiplier ?? 1.0;
        strokeManager.syncStrokesToSameSpeed(ids, spd, true);
        showToast(`Matched ${ids.length} lines to ${spd.toFixed(2)}x`);
      }
      this.deps.onSyncCompositionState();
      this.updateStudioDockedInspector();
    });

    this.listen(studioMultiDelBtn, 'click', () => {
      if (strokeManager.selectedStrokeIds.length > 0) {
        strokeManager.deleteSelected();
        this.deps.onSyncCompositionState();
      }
    });

    this.listen(studioMultiDeselectBtn, 'click', () => {
      strokeManager.selectStroke(null);
      this.deps.onUpdateTrackActionsVisibility();
      this.renderAllMixers();
    });

    this.listen(dockedInspectorToggleBtn, 'click', (e) => {
      e.stopPropagation();
      this.isInspectorCollapsed = !this.isInspectorCollapsed;
      writeStorageKey(STORAGE_KEYS.INSPECTOR_COLLAPSED, this.isInspectorCollapsed.toString());
      this.updateStudioDockedInspector();
    });

    this.listen(dockedInspectorHeader, 'click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button')) return;
      if (strokeManager.selectedStrokeId || strokeManager.selectedStrokeIds.length > 1) {
        this.isInspectorCollapsed = !this.isInspectorCollapsed;
        writeStorageKey(STORAGE_KEYS.INSPECTOR_COLLAPSED, this.isInspectorCollapsed.toString());
        this.updateStudioDockedInspector();
      }
    });

    // Initial sync
    this.syncMasterFxControls();
    this.refreshMidiUi();
    this.updateHistoryBadge();
    this.updateABSnapshotButtons();
    this.updateStudioDockedInspector();
  }

  public switchStudioDeckTab(tab: 'mixer' | 'master' | 'scenes'): void {
    const studioTabBtnMixer = this.root.getElementById('studioTabBtnMixer');
    const studioTabBtnMaster = this.root.getElementById('studioTabBtnMaster');
    const studioTabBtnScenes = this.root.getElementById('studioTabBtnScenes');
    const studioTabMixer = this.root.getElementById('studioTabMixer');
    const studioTabMaster = this.root.getElementById('studioTabMaster');
    const studioTabScenes = this.root.getElementById('studioTabScenes');

    studioTabBtnMixer?.classList.toggle('active', tab === 'mixer');
    studioTabBtnMaster?.classList.toggle('active', tab === 'master');
    studioTabBtnScenes?.classList.toggle('active', tab === 'scenes');

    if (studioTabMixer) studioTabMixer.style.display = tab === 'mixer' ? 'flex' : 'none';
    if (studioTabMaster) studioTabMaster.style.display = tab === 'master' ? 'flex' : 'none';
    if (studioTabScenes) studioTabScenes.style.display = tab === 'scenes' ? 'flex' : 'none';

    if (tab === 'mixer') {
      this.renderAllMixers();
    } else if (tab === 'scenes') {
      this.deps.onRenderSceneCards?.();
    } else if (tab === 'master') {
      this.syncMasterFxControls();
      this.refreshMidiUi();
    }
  }

  public setDeckCollapsed(collapsed: boolean): void {
    this.isDeckCollapsed = collapsed;
    const studioDeck = this.root.getElementById('studioDeck');
    const appEl = this.root.getElementById('app');
    const collapseBtn = this.root.getElementById('studioDeckCollapseBtn');

    studioDeck?.classList.toggle('is-rail-collapsed', collapsed);
    appEl?.classList.toggle('studio-deck-collapsed', collapsed);

    if (collapseBtn) {
      collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      collapseBtn.setAttribute('aria-label', collapsed ? 'Expand Studio Deck' : 'Collapse Studio Deck');
      collapseBtn.setAttribute('title', collapsed ? 'Expand Studio Deck' : 'Collapse Studio Deck');
      collapseBtn.textContent = collapsed ? '‹' : '›';
    }

    this.deps.renderer.resize();
  }

  public updateHistoryBadge(): void {
    const badge = this.root.getElementById('historyCountBadge');
    if (!badge) return;

    const count = this.deps.strokeManager.undoCount;
    const redoCount = this.deps.strokeManager.redoCount;
    const lastUndo = this.deps.strokeManager.lastUndoLabel;

    badge.textContent = `Undo ${count}`;
    if (lastUndo) {
      badge.title = `Last edit: ${lastUndo}${redoCount > 0 ? ` • Redo: ${redoCount}` : ''}`;
    } else if (redoCount > 0) {
      badge.title = `Undo 0 • Redo: ${redoCount}`;
    } else {
      badge.title = 'Undo / Redo history depth';
    }
  }

  public updateABSnapshotButtons(): void {
    const abCaptureBtn = this.root.getElementById('abCaptureBtn') as HTMLButtonElement | null;
    const abCompareBtn = this.root.getElementById('abCompareBtn') as HTMLButtonElement | null;
    const hasSnap = this.deps.abSnapshot.hasSnapshot();
    const activeSlot: ABSlot = this.deps.abSnapshot.getActiveSlot();

    if (abCaptureBtn) {
      abCaptureBtn.classList.toggle('active', hasSnap);
      abCaptureBtn.title = hasSnap
        ? 'Overwrite Snapshot A with current composition'
        : 'Capture live composition into Snapshot A';
    }

    if (abCompareBtn) {
      abCompareBtn.disabled = !hasSnap;
      abCompareBtn.classList.toggle('is-slot-a', hasSnap && activeSlot === 'A');
      abCompareBtn.classList.toggle('is-slot-b', hasSnap && activeSlot === 'B');
      abCompareBtn.textContent = hasSnap ? `Slot ${activeSlot}` : 'A / B';
      abCompareBtn.title = hasSnap
        ? `Currently auditioning Slot ${activeSlot} — click to compare A / B`
        : 'Capture Snapshot A first to compare A / B';
    }
  }

  public syncMasterSwingAndPerformanceUI(swing: number, beatGrid: boolean, quantized: boolean): void {
    this.beatGridVisible = beatGrid;

    const swingSlider = this.root.getElementById('studioMasterSwingSlider') as HTMLInputElement | null;
    const swingVal = this.root.getElementById('studioMasterSwingVal');
    const clampedSwing = Math.max(0, Math.min(0.75, swing));
    const swingPct = Math.round(clampedSwing * 100);

    if (swingSlider) {
      const isUnit = parseFloat(swingSlider.max || '75') <= 1.0;
      swingSlider.value = isUnit ? clampedSwing.toFixed(2) : String(swingPct);
    }
    if (swingVal) {
      swingVal.textContent = `${swingPct}%`;
    }

    const beatGridToggle = this.root.getElementById('beatGridToggle');
    if (beatGridToggle) {
      const isCheckbox =
        beatGridToggle.tagName.toUpperCase() === 'INPUT' &&
        (beatGridToggle as HTMLInputElement).type === 'checkbox';
      if (isCheckbox) {
        (beatGridToggle as HTMLInputElement).checked = beatGrid;
      } else {
        beatGridToggle.classList.toggle('active', beatGrid);
        beatGridToggle.setAttribute('aria-pressed', beatGrid ? 'true' : 'false');
        beatGridToggle.textContent = beatGrid ? 'Beat Grid On' : 'Beat Grid Off';
      }
    }

    const quantizedTriggerToggle = this.root.getElementById('quantizedTriggerToggle');
    if (quantizedTriggerToggle) {
      const isCheckbox =
        quantizedTriggerToggle.tagName.toUpperCase() === 'INPUT' &&
        (quantizedTriggerToggle as HTMLInputElement).type === 'checkbox';
      if (isCheckbox) {
        (quantizedTriggerToggle as HTMLInputElement).checked = quantized;
      } else {
        quantizedTriggerToggle.classList.toggle('active', quantized);
        quantizedTriggerToggle.setAttribute('aria-pressed', quantized ? 'true' : 'false');
        quantizedTriggerToggle.textContent = quantized ? 'Next Bar On' : 'Next Bar Off';
      }
    }
  }

  public refreshMidiUi(): void {
    const { midiController } = this.deps;
    const supported = midiController.isSupported();
    const enabled = midiController.isEnabled();
    const outputs = midiController.getOutputs();
    const inputs = midiController.getInputs();

    const midiStatusBadge = this.root.getElementById('midiStatusBadge');
    const midiEnableBtn = this.root.getElementById('midiEnableBtn') as HTMLButtonElement | null;
    const midiOutputSelect = this.root.getElementById('midiOutputSelect') as HTMLSelectElement | null;
    const midiInputSelect = this.root.getElementById('midiInputSelect') as HTMLSelectElement | null;
    const midiChannelSelect = this.root.getElementById('midiChannelSelect') as HTMLSelectElement | null;
    const midiLearnBtn = this.root.getElementById('midiLearnBtn') as HTMLButtonElement | null;

    if (midiStatusBadge) {
      if (!supported) {
        midiStatusBadge.textContent = 'Unsupported';
      } else if (enabled) {
        midiStatusBadge.textContent = outputs.length > 0 ? `On (${outputs.length})` : 'On';
      } else {
        midiStatusBadge.textContent = 'Off';
      }
    }

    if (midiEnableBtn) {
      midiEnableBtn.disabled = !supported;
      midiEnableBtn.classList.toggle('active', enabled);
      midiEnableBtn.textContent = enabled ? 'Disable Web MIDI' : 'Enable Web MIDI';
    }

    if (midiOutputSelect) {
      const prevOut = midiOutputSelect.value;
      midiOutputSelect.textContent = '';

      const noneOpt = this.root.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = 'No MIDI Output';
      midiOutputSelect.appendChild(noneOpt);

      outputs.forEach((out) => {
        const opt = this.root.createElement('option');
        opt.value = out.id;
        opt.textContent = out.manufacturer ? `${out.name} (${out.manufacturer})` : out.name;
        midiOutputSelect.appendChild(opt);
      });

      if (prevOut && outputs.some((o) => o.id === prevOut)) {
        midiOutputSelect.value = prevOut;
      } else if (enabled && outputs.length > 0) {
        midiOutputSelect.value = outputs[0].id;
      } else {
        midiOutputSelect.value = '';
      }
    }

    if (midiInputSelect) {
      const prevIn = midiInputSelect.value;
      midiInputSelect.textContent = '';

      const noneOpt = this.root.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = 'No MIDI Input';
      const allOpt = this.root.createElement('option');
      allOpt.value = 'all';
      allOpt.textContent = 'All Inputs';
      midiInputSelect.append(noneOpt, allOpt);

      inputs.forEach((inp) => {
        const opt = this.root.createElement('option');
        opt.value = inp.id;
        opt.textContent = inp.manufacturer ? `${inp.name} (${inp.manufacturer})` : inp.name;
        midiInputSelect.appendChild(opt);
      });

      if (prevIn === '' || prevIn === 'all' || inputs.some((i) => i.id === prevIn)) {
        midiInputSelect.value = prevIn || 'all';
      } else {
        midiInputSelect.value = 'all';
      }
    }

    if (midiChannelSelect) {
      midiChannelSelect.value = midiController.getChannelMode();
    }

    if (midiLearnBtn) {
      const isLearning = midiController.getLearningTarget() !== null;
      midiLearnBtn.classList.toggle('is-learning', isLearning);
      midiLearnBtn.textContent = isLearning ? 'Listening...' : 'Learn CC';
      midiLearnBtn.disabled = !enabled;
    }
  }

  public renderAllMixers(): void {
    const strokes = this.deps.strokeManager.activeStrokes;
    const layerCountBadge = this.root.getElementById('layerCountBadge');
    const studioLayerCount = this.root.getElementById('studioLayerCount');
    const studioMixerList = this.root.getElementById('studioMixerList');

    if (layerCountBadge) {
      layerCountBadge.textContent = strokes.length.toString();
    }
    if (studioLayerCount) {
      studioLayerCount.textContent = strokes.length.toString();
    }

    this.updateHistoryBadge();

    if (!studioMixerList) return;
    if (!this.isStudioMixerVisible()) {
      if (this.deps.viewModeManager.getMode() === 'studio') {
        this.updateStudioDockedInspector();
      }
      return;
    }

    while (this.mixerCardCleanups.length > 0) {
      this.mixerCardCleanups.pop()?.();
    }
    studioMixerList.textContent = '';

    if (strokes.length === 0) {
      const emptyEl = this.root.createElement('div');
      emptyEl.className = 'mixer-empty-state';
      emptyEl.textContent = 'No lines drawn yet. Draw on the canvas to add ambient sound layers.';
      studioMixerList.appendChild(emptyEl);
      this.updateStudioDockedInspector();
      return;
    }

    const hasSolo = this.deps.strokeManager.hasSoloedStrokes;
    const sortedStrokes = this.deps.strokeManager.getStrokesSortedByFieldY();
    sortedStrokes.forEach((stroke, idx) => {
      const { card, cleanup } = this.createLayerCard(stroke, idx, hasSolo);
      this.mixerCardCleanups.push(cleanup);
      studioMixerList.appendChild(card);
    });

    this.updateStudioDockedInspector();
    this.updateMixerSelection();
  }

  public updateMixerSelection(): void {
    const selectedIds = new Set(this.deps.strokeManager.selectedStrokeIds);
    const allCards = this.root.querySelectorAll('.layer-card');
    allCards.forEach((card) => {
      const cardStrokeId = card.getAttribute('data-stroke-id');
      const isSelected = Boolean(cardStrokeId && selectedIds.has(cardStrokeId));
      card.classList.toggle('selected', isSelected);
    });
  }

  public updateMixerCardTimingTag(stroke: DrawnStroke): void {
    const studioMixerList = this.root.getElementById('studioMixerList');
    if (!studioMixerList) return;
    for (const child of Array.from(studioMixerList.children)) {
      if (child.getAttribute('data-stroke-id') === stroke.id) {
        const tag = child.querySelector('.layer-tag');
        if (tag) {
          tag.textContent = this.formatStrokeTimingTag(stroke);
        }
        break;
      }
    }
  }

  public updateStudioDockedInspector(): void {
    const { strokeManager, renderer, inputHandler } = this.deps;
    const studioDockedInspector = this.root.getElementById('studioDockedInspector');
    if (!studioDockedInspector) return;

    const dockedInspectorToggleBtn = this.root.getElementById('dockedInspectorToggleBtn');
    const studioInspectorContent = this.root.getElementById('dockedInspectorContent');
    const studioMultiSelectContent = this.root.getElementById('dockedMultiSelectContent');
    const studioBadgeDot = this.root.getElementById('dockedBadgeDot');
    const studioInspectorLabel = this.root.getElementById('dockedInspectorLabel');
    const studioInspectorSub = this.root.getElementById('dockedInspectorSub');

    const selectedId = strokeManager.selectedStrokeId;
    const selectedCount = strokeManager.selectedStrokeIds.length;

    if (!selectedId) {
      if (studioInspectorContent) studioInspectorContent.style.display = 'none';
      if (selectedCount > 1) {
        studioDockedInspector.classList.remove('is-empty');
        studioDockedInspector.classList.add('has-selection');
        if (dockedInspectorToggleBtn) {
          dockedInspectorToggleBtn.style.display = 'inline-flex';
          dockedInspectorToggleBtn.textContent = this.isInspectorCollapsed ? '▲' : '▼';
          dockedInspectorToggleBtn.setAttribute(
            'title',
            this.isInspectorCollapsed
              ? 'Expand Multi-Selection Inspector'
              : 'Collapse Multi-Selection Inspector'
          );
        }
        studioDockedInspector.classList.toggle('is-collapsed', this.isInspectorCollapsed);
        if (studioMultiSelectContent) {
          studioMultiSelectContent.style.display = this.isInspectorCollapsed ? 'none' : 'flex';
        }
        if (studioBadgeDot) studioBadgeDot.style.background = 'var(--accent)';
        if (studioInspectorLabel) studioInspectorLabel.textContent = 'Multi-Selection';
        if (studioInspectorSub) studioInspectorSub.textContent = `${selectedCount} lines selected`;

        const selectedStrokes = strokeManager.selectedStrokeIds
          .map((id) => strokeManager.getStroke(id))
          .filter((s): s is DrawnStroke => Boolean(s));
        const speedStrokes = selectedStrokes.filter(
          (s) => (s.timingMode ?? (s.speedMode === 'timer' ? 'timer' : 'speed')) === 'speed'
        );
        const allSpeed = speedStrokes.length === selectedStrokes.length && selectedStrokes.length > 0;
        const uniformSpeed =
          allSpeed &&
          speedStrokes.every(
            (s) => Math.abs((s.speedMultiplier ?? 1.0) - (speedStrokes[0].speedMultiplier ?? 1.0)) < 0.005
          );
        const initSpeedRaw = uniformSpeed
          ? (speedStrokes[0].speedMultiplier ?? 1.0)
          : speedStrokes.length > 0
            ? speedStrokes.reduce((acc, s) => acc + (s.speedMultiplier ?? 1.0), 0) / speedStrokes.length
            : 1.0;
        const initSpeed = Math.max(0.1, Math.min(4.0, Math.round(initSpeedRaw * 20) / 20));

        const timingStateBadge = this.root.getElementById('studioMultiTimingState');
        const multiSpeedSlider = this.root.getElementById('studioMultiSpeedSlider') as HTMLInputElement | null;
        const multiSpeedVal = this.root.getElementById('studioMultiSpeedVal');
        if (timingStateBadge) {
          timingStateBadge.textContent = uniformSpeed
            ? `${(speedStrokes[0].speedMultiplier ?? 1.0).toFixed(2)}x`
            : 'Mixed';
        }
        if (multiSpeedSlider) multiSpeedSlider.value = initSpeed.toString();
        if (multiSpeedVal) multiSpeedVal.textContent = `${initSpeed.toFixed(2)}x`;
      } else {
        studioDockedInspector.classList.add('is-empty');
        studioDockedInspector.classList.remove('has-selection', 'is-collapsed');
        if (dockedInspectorToggleBtn) dockedInspectorToggleBtn.style.display = 'none';
        if (studioMultiSelectContent) studioMultiSelectContent.style.display = 'none';
        if (studioBadgeDot) studioBadgeDot.style.background = 'transparent';
        if (studioInspectorSub) studioInspectorSub.textContent = 'Select a line to inspect';
        if (studioInspectorLabel) studioInspectorLabel.textContent = 'Line Inspector';
      }
      return;
    }

    if (studioMultiSelectContent) studioMultiSelectContent.style.display = 'none';

    const stroke = strokeManager.activeStrokes.find((s) => s.id === selectedId);
    if (!stroke) return;

    studioDockedInspector.classList.remove('is-empty');
    studioDockedInspector.classList.add('has-selection');
    if (dockedInspectorToggleBtn) {
      dockedInspectorToggleBtn.style.display = 'inline-flex';
      dockedInspectorToggleBtn.textContent = this.isInspectorCollapsed ? '▲' : '▼';
      dockedInspectorToggleBtn.setAttribute(
        'title',
        this.isInspectorCollapsed
          ? 'Expand Line Inspector'
          : 'Collapse Line Inspector (show more lines)'
      );
    }

    if (this.isInspectorCollapsed) {
      studioDockedInspector.classList.add('is-collapsed');
      if (studioInspectorContent) studioInspectorContent.style.display = 'none';
    } else {
      studioDockedInspector.classList.remove('is-collapsed');
      if (studioInspectorContent) studioInspectorContent.style.display = 'flex';
    }

    const sortedStrokes = strokeManager.getStrokesSortedByFieldY();
    const idx = sortedStrokes.indexOf(stroke);
    const inst = getInstrument(stroke.instrumentId);
    const color = renderer.getStrokeColor(stroke);

    if (studioInspectorLabel) studioInspectorLabel.textContent = inst.name;
    if (studioInspectorSub) studioInspectorSub.textContent = `Line #${idx + 1} (${stroke.style})`;
    if (studioBadgeDot) studioBadgeDot.style.background = color;

    const studioVoicingSelect = this.root.getElementById('studioVoicingSelect') as HTMLSelectElement | null;
    if (studioVoicingSelect) {
      studioVoicingSelect.value = stroke.harmonizer ?? 'single';
    }

    const studioTimingModeLabel = this.root.getElementById('studioTimingModeLabel');
    const studioTimingToggle = this.root.getElementById('studioTimingToggle');
    const studioTimingSlider = this.root.getElementById('studioTimingSlider') as HTMLInputElement | null;
    const studioTimingVal = this.root.getElementById('studioTimingVal');

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

    const studioTraversalSwitch = this.root.getElementById('studioTraversalSwitch');
    const studioWaveShapeSelect = this.root.getElementById('studioWaveShapeSelect') as HTMLSelectElement | null;
    const studioWaveShapeButtons = this.root.querySelectorAll<HTMLButtonElement>(
      '#studioWaveShapeGroup [data-wave-shape]'
    );
    const studioWaveAmpSlider = this.root.getElementById('studioWaveAmpSlider') as HTMLInputElement | null;
    const studioWaveAmpVal = this.root.getElementById('studioWaveAmpVal');
    const studioWavePeriodSlider = this.root.getElementById('studioWavePeriodSlider') as HTMLInputElement | null;
    const studioWavePeriodVal = this.root.getElementById('studioWavePeriodVal');
    const studioWaveSineBtn = this.root.getElementById('studioWaveSineBtn');

    const studioTraversalRow = studioTraversalSwitch?.closest('.docked-row') as HTMLElement | null;
    const studioWaveGroup = (studioWaveShapeSelect ?? studioWaveAmpSlider)?.closest('.docked-group') as HTMLElement | null;
    if (studioTraversalRow) studioTraversalRow.style.display = stroke.isPoint ? 'none' : '';
    if (studioWaveGroup) studioWaveGroup.style.display = stroke.isPoint ? 'none' : '';

    const isBounce = stroke.traversal === 'bounce' || (stroke.traversal as string) === 'pingpong';
    studioTraversalSwitch?.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
      b.classList.toggle('active', (b.getAttribute('data-track-traversal') === 'bounce') === isBounce);
    });

    const waveShape = stroke.waveParams?.shapeType ?? 'sine';
    if (studioWaveShapeSelect) {
      studioWaveShapeSelect.value = waveShape;
    }
    studioWaveShapeButtons.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-wave-shape') === waveShape);
    });

    if (studioWaveAmpSlider && studioWaveAmpVal) {
      const amp = stroke.waveParams?.amplitude ?? 0;
      studioWaveAmpSlider.value = amp.toString();
      studioWaveAmpVal.textContent = `${Math.round(amp)}px`;
    }
    if (studioWavePeriodSlider && studioWavePeriodVal) {
      const periods = stroke.waveParams?.periods ?? 2;
      studioWavePeriodSlider.value = periods.toString();
      studioWavePeriodVal.textContent = Number.isInteger(periods) ? `${periods}` : periods.toFixed(1);
    }
    if (studioWaveSineBtn) {
      studioWaveSineBtn.classList.toggle('active', (stroke.waveParams?.amplitude ?? 0) > 0);
    }

    const studioFluctuationSlider = this.root.getElementById('studioFluctuationSlider') as HTMLInputElement | null;
    const studioFluctuationVal = this.root.getElementById('studioFluctuationVal');
    const fluc =
      typeof stroke.fluctuation === 'number'
        ? stroke.fluctuation
        : strokeManager.defaultStrokeFluctuation;
    if (studioFluctuationSlider && studioFluctuationVal) {
      const isUnitRange = parseFloat(studioFluctuationSlider.max || '100') <= 1.5;
      studioFluctuationSlider.value = isUnitRange ? fluc.toFixed(2) : Math.round(fluc * 100).toString();
      studioFluctuationVal.textContent = isUnitRange ? fluc.toFixed(2) : `${Math.round(fluc * 100)}%`;
    }

    const studioDistortionSlider = this.root.getElementById('studioDistortionSlider') as HTMLInputElement | null;
    const studioDistortionVal = this.root.getElementById('studioDistortionVal');
    const dist = typeof stroke.distortion === 'number' ? stroke.distortion : 0.0;
    if (studioDistortionSlider && studioDistortionVal) {
      studioDistortionSlider.value = Math.round(dist * 100).toString();
      studioDistortionVal.textContent = `${Math.round(dist * 100)}%`;
    }

    const studioFilterSlider = this.root.getElementById('studioFilterSlider') as HTMLInputElement | null;
    const studioFilterVal = this.root.getElementById('studioFilterVal');
    const cutoff = typeof stroke.filterCutoff === 'number' ? stroke.filterCutoff : 1.0;
    if (studioFilterSlider && studioFilterVal) {
      studioFilterSlider.value = Math.round(cutoff * 100).toString();
      studioFilterVal.textContent = `${Math.round(cutoff * 100)}%`;
    }

    const studioLofiSlider = this.root.getElementById('studioLofiSlider') as HTMLInputElement | null;
    const studioLofiVal = this.root.getElementById('studioLofiVal');
    const lofi = typeof stroke.lofi === 'number' ? stroke.lofi : 0.0;
    if (studioLofiSlider && studioLofiVal) {
      studioLofiSlider.value = Math.round(lofi * 100).toString();
      studioLofiVal.textContent = `${Math.round(lofi * 100)}%`;
    }

    const studioArticulationSlider = this.root.getElementById('studioArticulationSlider') as HTMLInputElement | null;
    const studioArticulationVal = this.root.getElementById('studioArticulationVal');
    const art = typeof stroke.articulation === 'number' ? stroke.articulation : 1.0;
    const artPct = Math.round(Math.max(0.2, Math.min(2.5, art)) * 100);
    if (studioArticulationSlider && studioArticulationVal) {
      studioArticulationSlider.value = artPct.toString();
      studioArticulationVal.textContent = `${artPct}%`;
    }

    const studioRedrawTrackBtn = this.root.getElementById('studioRedrawTrackBtn');
    if (studioRedrawTrackBtn) {
      studioRedrawTrackBtn.classList.toggle('active', inputHandler.isRedrawing);
    }
  }

  public isDockedInspectorOpen(): boolean {
    return Boolean(
      (this.deps.strokeManager.selectedStrokeId || this.deps.strokeManager.selectedStrokeIds.length > 1) &&
        !this.isInspectorCollapsed
    );
  }

  public collapseDockedInspector(): void {
    this.isInspectorCollapsed = true;
    writeStorageKey(STORAGE_KEYS.INSPECTOR_COLLAPSED, 'true');
    this.updateStudioDockedInspector();
  }

  public destroy(): void {
    while (this.mixerCardCleanups.length > 0) {
      this.mixerCardCleanups.pop()?.();
    }
    while (this.cleanups.length > 0) {
      this.cleanups.pop()?.();
    }
    if (this.midiDevicesHandler && this.deps.midiController.onDevicesChange === this.midiDevicesHandler) {
      this.deps.midiController.onDevicesChange = undefined;
    }
    if (this.midiCcHandler && this.deps.midiController.onControlChange === this.midiCcHandler) {
      this.deps.midiController.onControlChange = undefined;
    }
    this.midiDevicesHandler = null;
    this.midiCcHandler = null;
  }
}
