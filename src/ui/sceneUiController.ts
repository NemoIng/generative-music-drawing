import type { SceneManager, SceneData, SceneSequenceTickResult } from '../engine/sceneManager';
import type { StrokeManager } from '../engine/strokeManager';
import type { ScaleQuantizer } from '../audio/scaleQuantizer';
import type { SoundEngine } from '../audio/audioContext';
import type { MorphCurveMode } from '../engine/types';

export interface SceneUiDeps {
  sceneManager: SceneManager;
  strokeManager: StrokeManager;
  quantizer: ScaleQuantizer;
  soundEngine: SoundEngine;
  getCanvasSize: () => { width: number; height: number };
  onLoadScene: (scene: SceneData) => void;
  onSwitchScene: (sceneId: string) => void;
  onSyncCompositionState: () => void;
  onSwitchToScenesTab: () => void;
  getPendingSceneId: () => string | null;
  getSceneCountForBadge?: () => number;
}

export class SceneUiController {
  private cleanups: Array<() => void> = [];
  private cardCleanups: Array<() => void> = [];

  constructor(
    private readonly deps: SceneUiDeps,
    private readonly root: Document = document
  ) {}

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

  private clearCardCleanups(): void {
    while (this.cardCleanups.length > 0) {
      this.cardCleanups.pop()?.();
    }
  }

  private exportCurrentStrokes() {
    const { width, height } = this.deps.getCanvasSize();
    return this.deps.strokeManager.exportComposition(
      this.deps.sceneManager.getCurrentScene().name,
      undefined,
      undefined,
      width,
      height
    ).strokes;
  }

  private syncBpmDisplays(bpm: number): void {
    const bpmSlider = this.root.getElementById('bpmSlider') as HTMLInputElement | null;
    const bpmVal = this.root.getElementById('bpmVal');
    const studioMasterBpmSlider = this.root.getElementById('studioMasterBpmSlider') as HTMLInputElement | null;
    const studioMasterBpmVal = this.root.getElementById('studioMasterBpmVal');

    if (bpmSlider) bpmSlider.value = bpm.toString();
    if (bpmVal) bpmVal.textContent = `${bpm} BPM`;
    if (studioMasterBpmSlider) studioMasterBpmSlider.value = bpm.toString();
    if (studioMasterBpmVal) studioMasterBpmVal.textContent = `${bpm} BPM`;
  }

  public init(): void {
    this.destroy();

    const sceneAddBtn = this.root.getElementById('sceneAddBtn');
    const sceneDupBtn = this.root.getElementById('sceneDupBtn');
    const sceneDelBtn = this.root.getElementById('sceneDelBtn');
    const sceneMorphSlider = this.root.getElementById('sceneMorphSlider') as HTMLInputElement | null;
    const sceneMorphVal = this.root.getElementById('sceneMorphVal');
    const sceneMorphCurveSelect = this.root.getElementById('sceneMorphCurveSelect') as HTMLSelectElement | null;
    const sceneMorphBlendButtons = this.root.querySelectorAll<HTMLButtonElement>('#sceneMorphBlendSwitch .seg-btn');
    const scenePlaySeqBtn = this.root.getElementById('scenePlaySeqBtn');
    const seqMiniIndicator = this.root.getElementById('seqMiniIndicator');

    this.listen(sceneAddBtn, 'click', () => {
      this.deps.sceneManager.updateCurrentScene({
        strokes: this.exportCurrentStrokes(),
        bpm: this.deps.strokeManager.currentBpm,
      });
      const newScene = this.deps.sceneManager.addScene();
      this.deps.onSwitchScene(newScene.id);
    });

    this.listen(sceneDupBtn, 'click', () => {
      this.deps.sceneManager.updateCurrentScene({
        strokes: this.exportCurrentStrokes(),
        bpm: this.deps.strokeManager.currentBpm,
      });
      const dup = this.deps.sceneManager.duplicateCurrentScene();
      this.deps.onSwitchScene(dup.id);
    });

    this.listen(sceneDelBtn, 'click', () => {
      const currentId = this.deps.sceneManager.getCurrentScene().id;
      const deleted = this.deps.sceneManager.deleteScene(currentId);
      if (deleted) {
        this.deps.onLoadScene(this.deps.sceneManager.getCurrentScene());
      }
    });

    this.listen(sceneMorphSlider, 'input', () => {
      if (!sceneMorphSlider) return;
      const s = parseInt(sceneMorphSlider.value, 10);
      if (!Number.isNaN(s)) {
        if (sceneMorphVal) sceneMorphVal.textContent = `${s}s`;
        this.deps.sceneManager.setMorphDuration(s);
      }
    });

    sceneMorphBlendButtons.forEach((btn) => {
      this.listen(btn, 'click', () => {
        const mode = btn.getAttribute('data-blend') as MorphCurveMode | null;
        if (!mode) return;
        sceneMorphBlendButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.deps.sceneManager.setMorphCurveMode(mode);
        if (sceneMorphCurveSelect) {
          sceneMorphCurveSelect.value = mode;
        }
      });
    });

    this.listen(sceneMorphCurveSelect, 'change', () => {
      if (!sceneMorphCurveSelect) return;
      const mode = sceneMorphCurveSelect.value as MorphCurveMode;
      this.deps.sceneManager.setMorphCurveMode(mode);
      sceneMorphBlendButtons.forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-blend') === mode);
      });
    });

    this.listen(scenePlaySeqBtn, 'click', () => {
      if (this.deps.sceneManager.isSequencing()) {
        this.deps.sceneManager.stopSequence();
        this.deps.strokeManager.cancelSceneCrossfade();
      } else {
        this.deps.sceneManager.updateCurrentScene({
          strokes: this.exportCurrentStrokes(),
          bpm: this.deps.strokeManager.currentBpm,
        });
        this.deps.sceneManager.startSequence();
      }
      this.updateSequencePlayButton();
      this.renderSceneCards();
    });

    this.listen(seqMiniIndicator, 'click', (e) => {
      const target = e.target as HTMLElement | null;
      const miniTrack = target?.closest('.seq-mini-bar-track') as HTMLElement | null;
      if (miniTrack) {
        const rect = miniTrack.getBoundingClientRect();
        const clickX = (e as MouseEvent).clientX - rect.left;
        const ratio = rect.width > 0 ? Math.max(0, Math.min(0.99, clickX / rect.width)) : 0;
        this.deps.sceneManager.seekCurrentScene(ratio);
        return;
      }
      this.deps.onSwitchToScenesTab();
    });

    this.updateSequencePlayButton();
    this.renderSceneCards();
  }

  public updateSequencePlayButton(): void {
    const isSeq = this.deps.sceneManager.isSequencing();
    const scenePlaySeqBtn = this.root.getElementById('scenePlaySeqBtn');
    const sceneSeqPlayText = this.root.getElementById('sceneSeqPlayText');
    const seqMiniIndicator = this.root.getElementById('seqMiniIndicator');

    if (sceneSeqPlayText) {
      sceneSeqPlayText.textContent = isSeq ? 'Stop Sequence' : 'Play Sequence';
    }
    scenePlaySeqBtn?.classList.toggle('active', isSeq);
    if (!isSeq && seqMiniIndicator) {
      seqMiniIndicator.style.display = 'none';
    }
  }

  public renderSceneCards(): void {
    const sceneCardsList = this.root.getElementById('sceneCardsList');
    const scenes = this.deps.sceneManager.getScenes();
    const sceneCountBadge =
      this.root.getElementById('sceneCountBadge') ?? this.root.getElementById('studioScenesCount');
    if (sceneCountBadge) {
      const count = this.deps.getSceneCountForBadge ? this.deps.getSceneCountForBadge() : scenes.length;
      sceneCountBadge.textContent = String(count);
    }

    if (!sceneCardsList) return;

    this.clearCardCleanups();
    const currentScene = this.deps.sceneManager.getCurrentScene();
    const pendingSceneId = this.deps.getPendingSceneId();
    sceneCardsList.textContent = '';

    scenes.forEach((scene) => {
      const card = this.root.createElement('div');
      const isActive = scene.id === currentScene.id;
      const isQueuedNextBar = pendingSceneId !== null && scene.id === pendingSceneId;
      card.className = `scene-card${isActive ? ' active' : ''}${isQueuedNextBar ? ' is-queued-next-bar' : ''}`;
      card.setAttribute('data-scene-id', scene.id);
      card.setAttribute('draggable', 'true');

      const strokeCount = isActive ? this.deps.strokeManager.activeStrokes.length : scene.strokes.length;

      // Top row
      const topEl = this.root.createElement('div');
      topEl.className = 'scene-card-top';

      const nameEl = this.root.createElement('span');
      nameEl.className = 'scene-card-name';
      nameEl.setAttribute('contenteditable', 'true');
      nameEl.setAttribute('spellcheck', 'false');
      nameEl.title = 'Click to rename scene';
      nameEl.textContent = scene.name;
      topEl.appendChild(nameEl);

      if (isActive) {
        const badgeEl = this.root.createElement('span');
        badgeEl.className = 'scene-card-badge';
        badgeEl.id = `badge_${scene.id}`;
        badgeEl.textContent = 'Active';
        topEl.appendChild(badgeEl);
      }

      if (isQueuedNextBar) {
        const nextBarPill = this.root.createElement('span');
        nextBarPill.className = 'queued-bar-pill is-queued-next-bar';
        nextBarPill.textContent = 'Next Bar';
        topEl.appendChild(nextBarPill);
      }

      // Meta row
      const metaEl = this.root.createElement('div');
      metaEl.className = 'scene-card-meta';

      const countChip = this.root.createElement('span');
      countChip.className = 'scene-card-chip';
      countChip.textContent = `${strokeCount} lines`;

      const durLabel = this.root.createElement('label');
      durLabel.className = 'scene-card-chip scene-card-chip-input has-tooltip';
      durLabel.setAttribute('data-tooltip', 'Hold Length: Duration in seconds before transitioning (5s - 300s)');
      const durInput = this.root.createElement('input');
      durInput.type = 'number';
      durInput.className = 'scene-card-duration-input';
      durInput.min = '5';
      durInput.max = '300';
      durInput.step = '1';
      durInput.value = String(scene.durationSec);
      durLabel.append(durInput, this.root.createTextNode('s'));

      const bpmLabel = this.root.createElement('label');
      bpmLabel.className = 'scene-card-chip scene-card-chip-input has-tooltip';
      bpmLabel.setAttribute('data-tooltip', 'Scene Tempo: BPM for this movement (10 - 240 BPM)');
      const bpmInput = this.root.createElement('input');
      bpmInput.type = 'number';
      bpmInput.className = 'scene-card-bpm-input';
      bpmInput.min = '10';
      bpmInput.max = '240';
      bpmInput.step = '1';
      bpmInput.value = String(scene.bpm || 32);
      bpmLabel.append(bpmInput, this.root.createTextNode(' BPM'));

      metaEl.append(countChip, durLabel, bpmLabel);

      // Progress track
      const trackEl = this.root.createElement('div');
      trackEl.className = 'scene-progress-track';
      trackEl.id = `track_${scene.id}`;
      trackEl.title = 'Click along the countdown bar to speed up & audition morphing';

      const progressEl = this.root.createElement('div');
      progressEl.className = 'scene-progress-bar';
      progressEl.id = `progress_${scene.id}`;
      trackEl.appendChild(progressEl);

      card.append(topEl, metaEl, trackEl);

      // Interactive duration input
      const applyDur = () => {
        let val = parseInt(durInput.value, 10);
        if (Number.isNaN(val) || val < 5) val = 5;
        if (val > 300) val = 300;
        durInput.value = val.toString();
        this.deps.sceneManager.setSceneDuration(scene.id, val);
        this.deps.onSyncCompositionState();
      };
      this.listen(durInput, 'click', (e) => e.stopPropagation(), this.cardCleanups);
      this.listen(durInput, 'mousedown', (e) => e.stopPropagation(), this.cardCleanups);
      this.listen(
        durInput,
        'focus',
        () => {
          card.setAttribute('draggable', 'false');
        },
        this.cardCleanups
      );
      this.listen(
        durInput,
        'blur',
        () => {
          card.setAttribute('draggable', 'true');
          applyDur();
        },
        this.cardCleanups
      );
      this.listen(
        durInput,
        'keydown',
        (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            durInput.blur();
          }
        },
        this.cardCleanups
      );

      // Interactive BPM input
      const applyBpm = () => {
        let val = parseInt(bpmInput.value, 10);
        if (Number.isNaN(val) || val < 10) val = 10;
        if (val > 240) val = 240;
        bpmInput.value = val.toString();
        this.deps.sceneManager.setSceneBpm(scene.id, val);
        if (scene.id === this.deps.sceneManager.getCurrentScene().id) {
          this.deps.strokeManager.setBpm(val);
          this.syncBpmDisplays(val);
        }
        this.deps.onSyncCompositionState();
      };
      this.listen(bpmInput, 'click', (e) => e.stopPropagation(), this.cardCleanups);
      this.listen(bpmInput, 'mousedown', (e) => e.stopPropagation(), this.cardCleanups);
      this.listen(
        bpmInput,
        'focus',
        () => {
          card.setAttribute('draggable', 'false');
        },
        this.cardCleanups
      );
      this.listen(
        bpmInput,
        'blur',
        () => {
          card.setAttribute('draggable', 'true');
          applyBpm();
        },
        this.cardCleanups
      );
      this.listen(
        bpmInput,
        'keydown',
        (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            bpmInput.blur();
          }
        },
        this.cardCleanups
      );

      // Interactive countdown bar seeking
      this.listen(
        trackEl,
        'click',
        (e) => {
          e.stopPropagation();
          const rect = trackEl.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const ratio = rect.width > 0 ? Math.max(0, Math.min(0.99, clickX / rect.width)) : 0;

          if (scene.id !== this.deps.sceneManager.getCurrentScene().id) {
            this.deps.onSwitchScene(scene.id);
          }

          if (!this.deps.sceneManager.isSequencing()) {
            this.deps.sceneManager.updateCurrentScene({
              strokes: this.exportCurrentStrokes(),
              bpm: this.deps.strokeManager.currentBpm,
            });
            this.deps.sceneManager.startSequence();
            this.updateSequencePlayButton();
          }

          this.deps.sceneManager.seekCurrentScene(ratio);
          progressEl.style.width = `${(ratio * 100).toFixed(1)}%`;
        },
        this.cardCleanups
      );

      // Drag-and-drop reordering
      this.listen(
        card,
        'dragstart',
        (e) => {
          const active = this.root.activeElement;
          if (active === nameEl || active === durInput || active === bpmInput) {
            e.preventDefault();
            return;
          }
          card.classList.add('dragging');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', scene.id);
          }
        },
        this.cardCleanups
      );

      this.listen(
        card,
        'dragend',
        () => {
          card.classList.remove('dragging');
          this.root.querySelectorAll('.scene-card').forEach((c) => c.classList.remove('drag-over'));
        },
        this.cardCleanups
      );

      this.listen(
        card,
        'dragover',
        (e) => {
          e.preventDefault();
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
          }
          card.classList.add('drag-over');
        },
        this.cardCleanups
      );

      this.listen(
        card,
        'dragleave',
        () => {
          card.classList.remove('drag-over');
        },
        this.cardCleanups
      );

      this.listen(
        card,
        'drop',
        (e) => {
          e.preventDefault();
          card.classList.remove('drag-over');
          const sourceId = e.dataTransfer?.getData('text/plain');
          if (sourceId && sourceId !== scene.id) {
            const reordered = this.deps.sceneManager.reorderScene(sourceId, scene.id);
            if (reordered) {
              this.deps.onSyncCompositionState();
              this.renderSceneCards();
            }
          }
        },
        this.cardCleanups
      );

      // Click on card body to switch scene
      this.listen(
        card,
        'click',
        (e) => {
          const target = e.target as HTMLElement | null;
          if (
            target &&
            (target.classList.contains('scene-card-name') ||
              target.closest('.scene-progress-track') ||
              target.closest('.scene-card-chip-input'))
          ) {
            return;
          }
          if (scene.id !== this.deps.sceneManager.getCurrentScene().id) {
            this.deps.onSwitchScene(scene.id);
          }
        },
        this.cardCleanups
      );

      // Editable name blur event (disable drag while editing text)
      this.listen(
        nameEl,
        'focus',
        () => {
          card.setAttribute('draggable', 'false');
        },
        this.cardCleanups
      );
      this.listen(
        nameEl,
        'blur',
        () => {
          card.setAttribute('draggable', 'true');
          if (nameEl.textContent) {
            this.deps.sceneManager.renameScene(scene.id, nameEl.textContent.trim());
            this.deps.onSyncCompositionState();
          }
        },
        this.cardCleanups
      );
      this.listen(
        nameEl,
        'keydown',
        (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            nameEl.blur();
          }
        },
        this.cardCleanups
      );

      sceneCardsList.appendChild(card);
    });
  }

  public updateSeqMiniIndicator(seq: SceneSequenceTickResult): void {
    const seqMiniIndicator = this.root.getElementById('seqMiniIndicator');
    if (!seqMiniIndicator) return;

    const appEl = this.root.getElementById('app');
    const studioDeck = this.root.getElementById('studioDeck');
    const studioTabBtnScenes = this.root.getElementById('studioTabBtnScenes');
    const isStudioView =
      !appEl?.classList.contains('view-zen') && (!studioDeck || studioDeck.style.display !== 'none');
    const isScenesTabActive = Boolean(isStudioView && studioTabBtnScenes?.classList.contains('active'));

    if (isScenesTabActive || !this.deps.sceneManager.isSequencing()) {
      seqMiniIndicator.style.display = 'none';
      return;
    }

    seqMiniIndicator.style.display = 'flex';
    seqMiniIndicator.classList.toggle('is-morphing', seq.isMorphing);

    const seqMiniName = this.root.getElementById('seqMiniName');
    const seqMiniState = this.root.getElementById('seqMiniState');
    const seqMiniProgressText = this.root.getElementById('seqMiniProgressText');
    const seqMiniBarFill = this.root.getElementById('seqMiniBarFill');

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

  public destroy(): void {
    this.clearCardCleanups();
    while (this.cleanups.length > 0) {
      this.cleanups.pop()?.();
    }
  }
}
