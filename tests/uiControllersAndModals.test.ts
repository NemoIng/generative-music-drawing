import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

import { activateModalFocusTrap } from '../src/ui/modalFocus';
import {
  showConfirmDialog,
  cancelConfirmDialog,
  isConfirmDialogOpen,
} from '../src/ui/confirmModal';
import {
  OnboardingController,
  ONBOARDING_STORAGE_KEY,
} from '../src/ui/onboarding';
import { ABSnapshotManager } from '../src/ui/abSnapshot';
import { PresetModalController } from '../src/ui/presetModalController';
import { RecordExportController } from '../src/ui/recordExportController';
import { SceneUiController } from '../src/ui/sceneUiController';
import { StudioDeckController } from '../src/ui/studioDeckController';
import { ViewModeManager } from '../src/ui/viewModes';
import { clearToastTimer } from '../src/ui/toast';
import { loadSavedPresets } from '../src/ui/storage';
import { StrokeManager } from '../src/engine/strokeManager';
import { SceneManager } from '../src/engine/sceneManager';
import { ScaleQuantizer } from '../src/audio/scaleQuantizer';
import { SoundEngine } from '../src/audio/audioContext';
import { MidiController } from '../src/audio/midiController';
import type { CanvasRenderer } from '../src/canvas/renderer';
import type { InputHandler } from '../src/canvas/inputHandler';
import type { SavedComposition } from '../src/engine/types';
import type { SplinePath } from '../src/math/types';

const INDEX_HTML_PATH = path.resolve(__dirname, '../index.html');
const INDEX_HTML = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');

function createHorizontalSpline(x0 = 60, x1 = 360, y = 220): SplinePath {
  const dx = (x1 - x0) / 3;
  return {
    isClosed: false,
    segments: [
      {
        p0: { x: x0, y },
        p1: { x: x0 + dx, y },
        p2: { x: x0 + 2 * dx, y },
        p3: { x: x1, y },
      },
    ],
  };
}

function makeComp(name: string, bpm = 120, instrumentId = 'indigo'): SavedComposition {
  return {
    version: 1,
    name,
    timestamp: 1700000000000,
    bpm,
    strokes: [
      {
        id: `stroke-${name}`,
        instrumentId,
        style: 'solid',
        path: createHorizontalSpline(),
      },
    ],
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('UI Controllers, Modals, Onboarding & Snapshots', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM(INDEX_HTML, {
      url: 'http://localhost/',
    });

    Object.defineProperty(dom.window, 'innerWidth', {
      value: 1280,
      configurable: true,
      writable: true,
    });

    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('localStorage', dom.window.localStorage);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('KeyboardEvent', dom.window.KeyboardEvent);
  });

  afterEach(() => {
    cancelConfirmDialog();
    clearToastTimer();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dom.window.close();
  });

  describe('modalFocus.ts', () => {
    it('remembers opener focus, focuses first modal control, wraps Tab/Shift+Tab, and restores focus on deactivate', () => {
      const openerBtn = document.getElementById('recordModalBtn') as HTMLButtonElement;
      const modal = document.getElementById('confirmModal')!;
      const cancelBtn = document.getElementById('confirmModalCancelBtn') as HTMLButtonElement;
      const okBtn = document.getElementById('confirmModalOkBtn') as HTMLButtonElement;

      openerBtn.focus();
      expect(document.activeElement).toBe(openerBtn);

      modal.classList.remove('hidden');
      const deactivate = activateModalFocusTrap(modal);

      expect(document.activeElement).toBe(cancelBtn);

      // Wrap forward: Tab from last -> first
      okBtn.focus();
      expect(document.activeElement).toBe(okBtn);
      const tabEvent = new dom.window.KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      okBtn.dispatchEvent(tabEvent);
      expect(tabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(cancelBtn);

      // Wrap backward: Shift+Tab from first -> last
      const shiftTabEvent = new dom.window.KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      cancelBtn.dispatchEvent(shiftTabEvent);
      expect(shiftTabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(okBtn);

      deactivate();
      expect(document.activeElement).toBe(openerBtn);

      // Keydown listener is removed after deactivate
      const postEvent = new dom.window.KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      openerBtn.dispatchEvent(postEvent);
      expect(postEvent.defaultPrevented).toBe(false);
    });
  });

  describe('confirmModal.ts', () => {
    it('populates title/message safely via textContent, toggles danger class, and resolves on OK/Cancel/backdrop/cancelConfirmDialog', async () => {
      const xssTitle = '<b>Danger</b>';
      const xssMessage = '<img src=x onerror=1> Delete item?';

      const okPromise = showConfirmDialog(
        {
          title: xssTitle,
          message: xssMessage,
          confirmLabel: 'Destroy',
          cancelLabel: 'Keep',
          danger: true,
        },
        document
      );

      expect(isConfirmDialogOpen(document)).toBe(true);

      const modal = document.getElementById('confirmModal')!;
      const titleEl = document.getElementById('confirmModalTitle')!;
      const msgEl = document.getElementById('confirmModalMessage')!;
      const okBtn = document.getElementById('confirmModalOkBtn') as HTMLButtonElement;
      const cancelBtn = document.getElementById('confirmModalCancelBtn') as HTMLButtonElement;
      const backdrop = modal.querySelector<HTMLElement>('.modal-backdrop')!;

      expect(titleEl.textContent).toBe(xssTitle);
      expect(titleEl.querySelector('b')).toBeNull();
      expect(msgEl.textContent).toBe(xssMessage);
      expect(msgEl.querySelector('img')).toBeNull();
      expect(okBtn.textContent).toBe('Destroy');
      expect(cancelBtn.textContent).toBe('Keep');
      expect(okBtn.classList.contains('action-btn-danger')).toBe(true);

      okBtn.click();
      await expect(okPromise).resolves.toBe(true);
      expect(isConfirmDialogOpen(document)).toBe(false);

      // Non-danger clears action-btn-danger and resolves false on Cancel
      const cancelPromise = showConfirmDialog(
        {
          title: 'Notice',
          message: 'Proceed?',
          danger: false,
        },
        document
      );
      expect(okBtn.classList.contains('action-btn-danger')).toBe(false);
      cancelBtn.click();
      await expect(cancelPromise).resolves.toBe(false);
      expect(isConfirmDialogOpen(document)).toBe(false);

      // Resolves false on backdrop click
      const backdropPromise = showConfirmDialog(
        {
          title: 'Backdrop Test',
          message: 'Click backdrop',
        },
        document
      );
      backdrop.click();
      await expect(backdropPromise).resolves.toBe(false);

      // Resolves false on cancelConfirmDialog()
      const apiCancelPromise = showConfirmDialog(
        {
          title: 'Programmatic Cancel',
          message: 'Cancel via helper',
        },
        document
      );
      expect(isConfirmDialogOpen(document)).toBe(true);
      cancelConfirmDialog();
      await expect(apiCancelPromise).resolves.toBe(false);
      expect(isConfirmDialogOpen(document)).toBe(false);
    });
  });

  describe('onboarding.ts', () => {
    it('runs 3-step tour on first visit, persists completion, skips on subsequent instantiation, and re-opens when forced', () => {
      const coachmark = document.getElementById('onboardingCoachmark')!;
      const badge = document.getElementById('onboardingStepBadge')!;
      const nextBtn = document.getElementById('onboardingNextBtn')!;

      const ctrl1 = new OnboardingController(document);
      expect(ctrl1.start()).toBe(true);
      expect(ctrl1.isActive()).toBe(true);
      expect(ctrl1.currentStepIndex()).toBe(0);
      expect(coachmark.classList.contains('hidden')).toBe(false);
      expect(badge.textContent).toBe('Step 1 of 3');
      expect(nextBtn.textContent).toBe('Next');

      // Out-of-order actions do not advance early
      ctrl1.notifyUserAction('selected_stroke');
      expect(ctrl1.currentStepIndex()).toBe(0);

      ctrl1.notifyUserAction('drew_stroke');
      expect(ctrl1.currentStepIndex()).toBe(1);
      expect(badge.textContent).toBe('Step 2 of 3');

      ctrl1.notifyUserAction('selected_stroke');
      expect(ctrl1.currentStepIndex()).toBe(2);
      expect(badge.textContent).toBe('Step 3 of 3');
      expect(nextBtn.textContent).toBe('Got it');

      ctrl1.notifyUserAction('tried_feature');
      expect(ctrl1.isActive()).toBe(false);
      expect(coachmark.classList.contains('hidden')).toBe(true);
      expect(dom.window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('1');

      // Second instantiation skips tour automatically
      const ctrl2 = new OnboardingController(document);
      expect(ctrl2.start()).toBe(false);
      expect(ctrl2.isActive()).toBe(false);
      expect(coachmark.classList.contains('hidden')).toBe(true);

      // start(true) forces tour to reopen at Step 1 of 3
      expect(ctrl2.start(true)).toBe(true);
      expect(ctrl2.isActive()).toBe(true);
      expect(ctrl2.currentStepIndex()).toBe(0);
      expect(badge.textContent).toBe('Step 1 of 3');
      expect(coachmark.classList.contains('hidden')).toBe(false);

      ctrl1.destroy();
      ctrl2.destroy();
    });
  });

  describe('abSnapshot.ts', () => {
    it('captures deep clones in Slot A, toggles B <-> A independently preserving edits in both slots, and resets on clear()', () => {
      const ab = new ABSnapshotManager();
      expect(ab.hasSnapshot()).toBe(false);
      expect(ab.getActiveSlot()).toBe('B');
      expect(ab.toggle(makeComp('Live'))).toBeNull();

      const compA = makeComp('Snapshot A', 40);
      ab.captureA(compA);
      // Mutate caller object after capture to verify deep clone isolation
      compA.bpm = 999;
      compA.strokes[0].instrumentId = 'onyx';

      expect(ab.hasSnapshot()).toBe(true);
      expect(ab.getActiveSlot()).toBe('B');

      // Edit in Slot B -> toggle to A
      const liveB1 = makeComp('Slot B Edit 1', 88, 'amber');
      const toA = ab.toggle(liveB1);
      expect(toA).not.toBeNull();
      expect(toA!.slot).toBe('A');
      expect(toA!.snapshot.name).toBe('Snapshot A');
      expect(toA!.snapshot.bpm).toBe(40);
      expect(toA!.snapshot.strokes[0].instrumentId).toBe('indigo');
      expect(ab.getActiveSlot()).toBe('A');

      // Edit in Slot A -> toggle back to B
      const editedA = makeComp('Slot A Edit 1', 55, 'spruce');
      const toB = ab.toggle(editedA);
      expect(toB).not.toBeNull();
      expect(toB!.slot).toBe('B');
      expect(toB!.snapshot.name).toBe('Slot B Edit 1');
      expect(toB!.snapshot.bpm).toBe(88);
      expect(toB!.snapshot.strokes[0].instrumentId).toBe('amber');
      expect(ab.getActiveSlot()).toBe('B');

      // Toggle back to A -> preserves Slot A Edit 1
      const toA2 = ab.toggle(makeComp('Slot B Edit 2', 110, 'rose'));
      expect(toA2!.slot).toBe('A');
      expect(toA2!.snapshot.name).toBe('Slot A Edit 1');
      expect(toA2!.snapshot.bpm).toBe(55);
      expect(toA2!.snapshot.strokes[0].instrumentId).toBe('spruce');

      ab.clear();
      expect(ab.hasSnapshot()).toBe(false);
      expect(ab.getActiveSlot()).toBe('B');
      expect(ab.toggle(makeComp('After Clear'))).toBeNull();
    });
  });

  describe('PresetModalController', () => {
    it('saves custom presets XSS-safely, updates dropdown & manager list, and respects confirmModal OK vs Cancel on delete', async () => {
      let currentName: string | null = null;
      let loadedTemplateId = 'cathedralSolitude';
      let dirty = true;

      const onPresetSaved = vi.fn();
      const onPresetDeleted = vi.fn();
      const onFallbackToTemplate = vi.fn((templateId: string) => {
        loadedTemplateId = templateId;
        currentName = 'Cathedral of Solitude';
      });

      const controller = new PresetModalController(
        {
          buildCurrentCompositionExport: (nameOverride) =>
            makeComp(nameOverride ?? currentName ?? 'Preset', 64),
          loadComposition: vi.fn(),
          getCurrentCompositionName: () => currentName,
          setCurrentCompositionName: (name) => {
            currentName = name;
          },
          setCurrentLoadedTemplateId: (id) => {
            loadedTemplateId = id;
          },
          setCompositionDirty: (val) => {
            dirty = val;
          },
          getTemplates: () => ({
            cathedralSolitude: { name: 'Cathedral of Solitude' },
          }),
          hasActiveStrokes: () => true,
          onFallbackToTemplate,
          onPresetSaved,
          onPresetDeleted,
        },
        document
      );

      controller.init();

      const topDeleteBtn = document.getElementById('topDeletePresetBtn') as HTMLButtonElement;
      expect(topDeleteBtn.disabled).toBe(true);

      // Open modal and enter an XSS-style preset name
      controller.openSavePresetModal(true);
      expect(controller.isOpen()).toBe(true);

      const xssPresetName = '<img src=x onerror=alert(1)> Nocturne';
      const nameInput = document.getElementById('savePresetNameInput') as HTMLInputElement;
      const saveCustomBtn = document.getElementById('saveCustomNameBtn') as HTMLButtonElement;
      nameInput.value = xssPresetName;
      nameInput.dispatchEvent(new dom.window.Event('input'));
      saveCustomBtn.click();

      expect(controller.isOpen()).toBe(false);
      expect(currentName).toBe(xssPresetName);
      expect(loadedTemplateId).toBe(`custom:${xssPresetName}`);
      expect(dirty).toBe(false);
      expect(onPresetSaved).toHaveBeenCalledTimes(1);
      expect(topDeleteBtn.disabled).toBe(false);

      // Dropdown updated safely
      const savedGroup = document.getElementById('savedTemplatesGroup')!;
      const savedOpts = Array.from(savedGroup.querySelectorAll('option'));
      expect(savedOpts).toHaveLength(1);
      expect(savedOpts[0].value).toBe(`custom:${xssPresetName}`);
      expect(savedOpts[0].textContent).toBe(xssPresetName);

      // Manager list rendered without HTML injection
      const listContainer = document.getElementById('savedPresetsListContainer')!;
      const countBadge = document.getElementById('savedPresetsCountBadge')!;
      expect(countBadge.textContent).toBe('1');
      expect(listContainer.querySelector('img')).toBeNull();
      expect(listContainer.querySelector('.saved-preset-item-name')?.textContent).toBe(
        xssPresetName
      );

      // Cancel deletion leaves preset intact
      const cancelPromise = controller.deleteCustomPresetAtIndex(0);
      expect(isConfirmDialogOpen(document)).toBe(true);
      (document.getElementById('confirmModalCancelBtn') as HTMLButtonElement).click();
      await expect(cancelPromise).resolves.toBe(false);
      expect(loadSavedPresets()).toHaveLength(1);
      expect(onPresetDeleted).not.toHaveBeenCalled();

      // Confirm deletion removes preset and falls back to template
      const confirmPromise = controller.deleteCustomPresetByName(xssPresetName);
      expect(isConfirmDialogOpen(document)).toBe(true);
      (document.getElementById('confirmModalOkBtn') as HTMLButtonElement).click();
      await expect(confirmPromise).resolves.toBe(true);

      expect(loadSavedPresets()).toHaveLength(0);
      expect(onPresetDeleted).toHaveBeenCalledWith(xssPresetName);
      expect(onFallbackToTemplate).toHaveBeenCalledWith('cathedralSolitude');
      expect(topDeleteBtn.disabled).toBe(true);
      expect(savedGroup.querySelectorAll('option')[0].disabled).toBe(true);
      expect(savedGroup.querySelectorAll('option')[0].textContent).toBe('(No saved presets yet)');

      controller.destroy();
    });
  });

  describe('RecordExportController', () => {
    it('opens/closes #recordModal with focus management, switches simulate/live tabs, and tracks #exportFormatSelect', () => {
      const soundEngine = new SoundEngine();
      const strokeManager = new StrokeManager(soundEngine);
      const quantizer = new ScaleQuantizer();

      const controller = new RecordExportController(
        {
          strokeManager,
          quantizer,
          soundEngine,
          getCanvasSize: () => ({ width: 800, height: 600 }),
          getCompositionName: () => 'Moonlight Sketch',
        },
        document
      );

      controller.init();

      const recordModalBtn = document.getElementById('recordModalBtn') as HTMLButtonElement;
      const recordModal = document.getElementById('recordModal')!;
      const closeBtn = document.getElementById('closeRecordModalBtn') as HTMLButtonElement;
      const tabSimBtn = document.getElementById('tabSimulateBtn') as HTMLButtonElement;
      const tabLiveBtn = document.getElementById('tabLiveBtn') as HTMLButtonElement;
      const tabSimPane = document.getElementById('tabSimulatePane')!;
      const tabLivePane = document.getElementById('tabLivePane')!;
      const formatSelect = document.getElementById('exportFormatSelect') as HTMLSelectElement;
      const startSimBtn = document.getElementById('startSimulateBtn') as HTMLButtonElement;

      recordModalBtn.focus();
      recordModalBtn.click();

      expect(controller.isOpen()).toBe(true);
      expect(recordModal.classList.contains('hidden')).toBe(false);
      expect(recordModal.contains(document.activeElement)).toBe(true);
      expect(tabSimBtn.classList.contains('active')).toBe(true);
      expect(tabSimPane.classList.contains('hidden')).toBe(false);
      expect(tabLivePane.classList.contains('hidden')).toBe(true);
      expect(startSimBtn.textContent).toBe('Simulate & Convert to MP3');

      // Switch to Live tab and back to Simulate tab
      tabLiveBtn.click();
      expect(tabLiveBtn.classList.contains('active')).toBe(true);
      expect(tabSimBtn.classList.contains('active')).toBe(false);
      expect(tabLivePane.classList.contains('hidden')).toBe(false);
      expect(tabSimPane.classList.contains('hidden')).toBe(true);

      tabSimBtn.click();
      expect(tabSimBtn.classList.contains('active')).toBe(true);
      expect(tabSimPane.classList.contains('hidden')).toBe(false);
      expect(tabLivePane.classList.contains('hidden')).toBe(true);

      // Format select switches between MP3 and WAV
      formatSelect.value = 'wav';
      formatSelect.dispatchEvent(new dom.window.Event('change'));
      expect(startSimBtn.textContent).toBe('Simulate & Export WAV');

      formatSelect.value = 'mp3';
      formatSelect.dispatchEvent(new dom.window.Event('change'));
      expect(startSimBtn.textContent).toBe('Simulate & Convert to MP3');

      // Closing restores focus to opener button
      closeBtn.click();
      expect(controller.isOpen()).toBe(false);
      expect(recordModal.classList.contains('hidden')).toBe(true);
      expect(document.activeElement).toBe(recordModalBtn);

      controller.destroy();
    });
  });

  describe('SceneUiController', () => {
    it('renders scene cards safely via textContent, marks pending scene with .is-queued-next-bar + Next Bar pill, and adds/duplicates scenes', () => {
      const soundEngine = new SoundEngine();
      const strokeManager = new StrokeManager(soundEngine);
      const quantizer = new ScaleQuantizer();
      const sceneManager = new SceneManager();

      let pendingSceneId: string | null = null;
      const onSwitchScene = vi.fn((sceneId: string) => {
        sceneManager.selectScene(sceneId);
      });
      const onLoadScene = vi.fn();
      const onSyncCompositionState = vi.fn();
      const onSwitchToScenesTab = vi.fn();

      const controller = new SceneUiController(
        {
          sceneManager,
          strokeManager,
          quantizer,
          soundEngine,
          getCanvasSize: () => ({ width: 800, height: 600 }),
          onLoadScene,
          onSwitchScene,
          onSyncCompositionState,
          onSwitchToScenesTab,
          getPendingSceneId: () => pendingSceneId,
        },
        document
      );

      controller.init();

      const firstScene = sceneManager.getCurrentScene();
      const xssSceneName = '<script>window.__xss=1</script> Drift';
      sceneManager.renameScene(firstScene.id, xssSceneName);
      controller.renderSceneCards();

      const cardsList = document.getElementById('sceneCardsList')!;
      expect(cardsList.querySelector('script')).toBeNull();
      expect(cardsList.querySelector('.scene-card-name')?.textContent).toBe(xssSceneName);

      // Add new scene via #sceneAddBtn
      const addBtn = document.getElementById('sceneAddBtn') as HTMLButtonElement;
      addBtn.click();
      expect(sceneManager.getScenes()).toHaveLength(2);
      expect(onSwitchScene).toHaveBeenCalledTimes(1);

      const secondScene = sceneManager.getCurrentScene();
      // Keep first scene active while queuing second scene for next bar
      sceneManager.selectScene(firstScene.id);
      pendingSceneId = secondScene.id;
      controller.renderSceneCards();

      const firstCard = cardsList.querySelector<HTMLElement>(`[data-scene-id="${firstScene.id}"]`)!;
      const queuedCard = cardsList.querySelector<HTMLElement>(`[data-scene-id="${secondScene.id}"]`)!;

      expect(firstCard.classList.contains('active')).toBe(true);
      expect(firstCard.classList.contains('is-queued-next-bar')).toBe(false);
      expect(firstCard.querySelector('.queued-bar-pill')).toBeNull();

      expect(queuedCard.classList.contains('is-queued-next-bar')).toBe(true);
      const pill = queuedCard.querySelector('.queued-bar-pill.is-queued-next-bar');
      expect(pill).not.toBeNull();
      expect(pill?.textContent).toBe('Next Bar');

      // Duplicate current scene via #sceneDupBtn
      const dupBtn = document.getElementById('sceneDupBtn') as HTMLButtonElement;
      dupBtn.click();
      expect(sceneManager.getScenes()).toHaveLength(3);
      expect(onSwitchScene).toHaveBeenCalledTimes(2);
      expect(sceneManager.getCurrentScene().name).toBe(`${xssSceneName} (Copy)`);

      controller.destroy();
    });
  });

  describe('StudioDeckController', () => {
    it('toggles collapsible rail, updates history badge, handles A/B snapshots, wires Studio controls, and renders queued mute pills', async () => {
      const soundEngine = new SoundEngine();
      const strokeManager = new StrokeManager(soundEngine);
      const quantizer = new ScaleQuantizer();
      const midiController = new MidiController();
      const abSnapshot = new ABSnapshotManager();

      const viewModeManager = new ViewModeManager({
        onViewChange: vi.fn(),
        onResizeRequired: vi.fn(),
      });
      viewModeManager.initDOM({
        app: document.getElementById('app'),
        studioDeck: document.getElementById('studioDeck'),
        zenDock: document.getElementById('zenPillDock'),
      });

      const rendererMock = {
        width: 800,
        height: 600,
        resize: vi.fn(),
        getStrokeColor: vi.fn(() => '#2563eb'),
      } as unknown as CanvasRenderer;

      const inputHandlerMock = {
        appMode: 'draw',
        isRedrawing: false,
      } as unknown as InputHandler;

      const onApplySnapshot = vi.fn((snapshot: SavedComposition) => {
        strokeManager.setBpm(snapshot.bpm ?? 100);
      });
      const onBeatGridChange = vi.fn();
      const onQuantizedChange = vi.fn();
      const onCompositionDirty = vi.fn();

      const controller = new StudioDeckController(
        {
          strokeManager,
          renderer: rendererMock,
          quantizer,
          soundEngine,
          inputHandler: inputHandlerMock,
          viewModeManager,
          midiController,
          abSnapshot,
          buildCurrentCompositionSnapshot: () =>
            strokeManager.exportComposition('Studio Live', undefined, undefined, 800, 600),
          onCompositionDirty,
          onSyncCompositionState: vi.fn(),
          onUpdateTrackActionsVisibility: vi.fn(),
          onSetAppMode: vi.fn(),
          onDuplicateStroke: vi.fn(() => null),
          onApplySnapshot,
          onBeatGridChange,
          onQuantizedChange,
          onMidiCcTargetApplied: vi.fn(),
        },
        document
      );

      controller.init();

      // 1. Collapsible rail (#studioDeckCollapseBtn)
      const studioDeck = document.getElementById('studioDeck')!;
      const appEl = document.getElementById('app')!;
      const collapseBtn = document.getElementById('studioDeckCollapseBtn') as HTMLButtonElement;

      expect(collapseBtn.getAttribute('aria-expanded')).toBe('true');
      expect(studioDeck.classList.contains('is-rail-collapsed')).toBe(false);

      collapseBtn.click();
      expect(studioDeck.classList.contains('is-rail-collapsed')).toBe(true);
      expect(appEl.classList.contains('studio-deck-collapsed')).toBe(true);
      expect(collapseBtn.getAttribute('aria-expanded')).toBe('false');
      expect(collapseBtn.textContent).toBe('‹');

      collapseBtn.click();
      expect(studioDeck.classList.contains('is-rail-collapsed')).toBe(false);
      expect(appEl.classList.contains('studio-deck-collapsed')).toBe(false);
      expect(collapseBtn.getAttribute('aria-expanded')).toBe('true');
      expect(collapseBtn.textContent).toBe('›');

      // 2. History count badge (#historyCountBadge)
      const historyBadge = document.getElementById('historyCountBadge')!;
      expect(historyBadge.textContent).toBe('Undo 0');

      const stroke1 = strokeManager.addStroke(
        createHorizontalSpline(40, 340, 200),
        'solid',
        'indigo',
        120,
        quantizer,
        600
      );
      strokeManager.addStroke(
        createHorizontalSpline(60, 360, 320),
        'dotted',
        'amber',
        120,
        quantizer,
        600
      );
      controller.updateHistoryBadge();
      expect(historyBadge.textContent).toBe('Undo 2');

      strokeManager.undo();
      controller.updateHistoryBadge();
      expect(historyBadge.textContent).toBe('Undo 1');

      // 3. A/B Snapshot buttons (#abCaptureBtn, #abCompareBtn)
      const abCaptureBtn = document.getElementById('abCaptureBtn') as HTMLButtonElement;
      const abCompareBtn = document.getElementById('abCompareBtn') as HTMLButtonElement;
      expect(abCompareBtn.disabled).toBe(true);

      strokeManager.setBpm(48);
      abCaptureBtn.click();
      expect(abCaptureBtn.classList.contains('active')).toBe(true);
      expect(abCompareBtn.disabled).toBe(false);
      expect(abCompareBtn.textContent).toBe('Slot B');

      strokeManager.setBpm(96);
      abCompareBtn.click();
      await flushMicrotasks();

      expect(onApplySnapshot).toHaveBeenCalledTimes(1);
      expect(strokeManager.currentBpm).toBe(48);
      expect(abCompareBtn.textContent).toBe('Slot A');
      expect(abCompareBtn.classList.contains('is-slot-a')).toBe(true);

      abCompareBtn.click();
      await flushMicrotasks();

      expect(onApplySnapshot).toHaveBeenCalledTimes(2);
      expect(strokeManager.currentBpm).toBe(96);
      expect(abCompareBtn.textContent).toBe('Slot B');
      expect(abCompareBtn.classList.contains('is-slot-b')).toBe(true);

      // 4. Studio Articulation slider (#studioArticulationSlider)
      strokeManager.selectStroke(stroke1.id);
      controller.renderAllMixers();

      const artSlider = document.getElementById('studioArticulationSlider') as HTMLInputElement;
      const artVal = document.getElementById('studioArticulationVal')!;
      artSlider.dispatchEvent(new dom.window.Event('pointerdown'));
      artSlider.value = '160';
      artSlider.dispatchEvent(new dom.window.Event('input'));
      artSlider.dispatchEvent(new dom.window.Event('change'));

      expect(artVal.textContent).toBe('160%');
      expect(stroke1.articulation).toBeCloseTo(1.6, 5);
      expect(historyBadge.textContent).toBe('Undo 2');

      // 5. Studio Master Swing slider (#studioMasterSwingSlider)
      const swingSlider = document.getElementById('studioMasterSwingSlider') as HTMLInputElement;
      const swingVal = document.getElementById('studioMasterSwingVal')!;
      swingSlider.value = '45';
      swingSlider.dispatchEvent(new dom.window.Event('input'));

      expect(strokeManager.swing).toBeCloseTo(0.45, 5);
      expect(swingVal.textContent).toBe('45%');

      // 6. Beat Grid toggle (#beatGridToggle)
      const beatGridToggle = document.getElementById('beatGridToggle') as HTMLButtonElement;
      beatGridToggle.click();
      expect(beatGridToggle.classList.contains('active')).toBe(true);
      expect(beatGridToggle.getAttribute('aria-pressed')).toBe('true');
      expect(beatGridToggle.textContent).toBe('Beat Grid On');
      expect(onBeatGridChange).toHaveBeenLastCalledWith(true);

      beatGridToggle.click();
      expect(beatGridToggle.classList.contains('active')).toBe(false);
      expect(beatGridToggle.getAttribute('aria-pressed')).toBe('false');
      expect(beatGridToggle.textContent).toBe('Beat Grid Off');
      expect(onBeatGridChange).toHaveBeenLastCalledWith(false);

      // 7. Quantized Trigger toggle (#quantizedTriggerToggle) & queued mute pill on layer card
      const quantToggle = document.getElementById('quantizedTriggerToggle') as HTMLButtonElement;
      quantToggle.click();
      expect(strokeManager.quantizedTriggering).toBe(true);
      expect(quantToggle.classList.contains('active')).toBe(true);
      expect(quantToggle.getAttribute('aria-pressed')).toBe('true');
      expect(quantToggle.textContent).toBe('Next Bar On');
      expect(onQuantizedChange).toHaveBeenLastCalledWith(true);

      const mixerList = document.getElementById('studioMixerList')!;
      const muteBtn = mixerList.querySelector<HTMLButtonElement>(
        `[data-stroke-id="${stroke1.id}"] [data-action="mute"]`
      )!;
      expect(muteBtn).not.toBeNull();
      muteBtn.click();

      expect(strokeManager.getPendingMuteIds().has(stroke1.id)).toBe(true);

      const updatedCard = mixerList.querySelector<HTMLElement>(`[data-stroke-id="${stroke1.id}"]`)!;
      const updatedMuteBtn = updatedCard.querySelector<HTMLButtonElement>('[data-action="mute"]')!;
      const queuedPill = updatedCard.querySelector('.queued-bar-pill.is-queued-next-bar');

      expect(updatedCard.classList.contains('is-queued-next-bar')).toBe(true);
      expect(updatedMuteBtn.classList.contains('is-queued-next-bar')).toBe(true);
      expect(queuedPill).not.toBeNull();
      expect(queuedPill?.textContent).toBe('Next Bar');

      // 8. Multi-Selection Inspector (#dockedMultiSelectContent): Sync to Same Speed & Match First
      const stroke2 = strokeManager.addStroke(
        createHorizontalSpline(80, 380, 360),
        'dotted',
        'amber',
        120,
        quantizer,
        600,
        1.0,
        'freeform',
        'restart',
        50,
        0.5,
        'timer',
        undefined,
        undefined,
        'timer'
      );
      strokeManager.setStrokeTimingMode(stroke1.id, 'speed', 800, false);
      strokeManager.setStrokeSpeed(stroke1.id, 1.5, false);
      strokeManager.selectMultipleStrokes([stroke1.id, stroke2.id]);
      controller.updateStudioDockedInspector();

      const multiContent = document.getElementById('dockedMultiSelectContent')!;
      const multiSpeedSlider = document.getElementById('studioMultiSpeedSlider') as HTMLInputElement;
      const syncSpeedBtn = document.getElementById('studioMultiSyncSpeedBtn') as HTMLButtonElement;
      const matchFirstBtn = document.getElementById('studioMultiMatchFirstBtn') as HTMLButtonElement;
      const timingStateBadge = document.getElementById('studioMultiTimingState')!;

      expect(multiContent.style.display).toBe('flex');
      expect(timingStateBadge.textContent).toBe('Mixed');

      multiSpeedSlider.value = '1.2';
      syncSpeedBtn.click();
      controller.renderAllMixers();
      expect(stroke1.timingMode).toBe('speed');
      expect(stroke1.speedMultiplier).toBe(1.2);
      expect(stroke2.timingMode).toBe('speed');
      expect(stroke2.speedMultiplier).toBe(1.2);
      expect(timingStateBadge.textContent).toBe('1.20x');

      const tagsAfterSync = Array.from(mixerList.querySelectorAll('.layer-tag')).map((el) => el.textContent);
      expect(tagsAfterSync).toEqual(['1.20x', '1.20x']);

      // Undo restores both back to original mixed modes
      expect(strokeManager.undo()).toBe(true);
      controller.renderAllMixers();
      expect(stroke1.speedMultiplier).toBe(1.5);
      expect(stroke2.timingMode).toBe('timer');
      expect(stroke2.duration).toBe(50);

      const tagsAfterUndo = Array.from(mixerList.querySelectorAll('.layer-tag')).map((el) => el.textContent);
      expect(tagsAfterUndo).toEqual(['1.50x', '50s']);

      // Match First aligns stroke2 to stroke1's 1.50x
      matchFirstBtn.click();
      expect(stroke2.timingMode).toBe('speed');
      expect(stroke2.speedMultiplier).toBe(1.5);

      controller.destroy();
    });
  });
});
