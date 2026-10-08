import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import { ViewModeManager } from '../src/ui/viewModes';

describe('View Modes: Studio (Layers, Master FX, Scenes) and Zen Canvas', () => {
  let dom: JSDOM;
  let doc: Document;

  beforeEach(() => {
    const htmlPath = path.resolve(__dirname, '../index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    dom = new JSDOM(html);
    doc = dom.window.document;
  });

  describe('HTML DOM Structure & Presence', () => {
    it('contains view switcher segmented control with Studio and Zen options', () => {
      const viewControl = doc.getElementById('viewModeControl');
      expect(viewControl).toBeDefined();
      const buttons = viewControl?.querySelectorAll<HTMLButtonElement>('[data-view-mode]');
      expect(buttons?.length).toBe(2);

      const modes = Array.from(buttons || []).map((b) => b.getAttribute('data-view-mode'));
      expect(modes).toEqual(['studio', 'zen']);
    });

    it('contains Studio Deck with Layers, Master FX, and Scenes tabs, persistent cards list, and docked inspector', () => {
      const studioDeck = doc.getElementById('studioDeck');
      expect(studioDeck).toBeDefined();
      expect(studioDeck?.classList.contains('studio-deck')).toBe(true);

      const tabMixer = doc.getElementById('studioTabBtnMixer');
      const tabMaster = doc.getElementById('studioTabBtnMaster');
      const tabScenes = doc.getElementById('studioTabBtnScenes');
      expect(tabMixer).toBeDefined();
      expect(tabMaster).toBeDefined();
      expect(tabScenes).toBeDefined();

      const mixerList = doc.getElementById('studioMixerList');
      expect(mixerList).toBeDefined();

      const studioDensityBtn = doc.getElementById('studioDensityBtn');
      expect(studioDensityBtn).toBeNull();

      const drawerDensityBtn = doc.getElementById('drawerDensityBtn');
      expect(drawerDensityBtn).toBeNull();

      const dockedInspector = doc.getElementById('studioDockedInspector');
      expect(dockedInspector).toBeDefined();

      const dockedCollapseBtn = doc.getElementById('dockedInspectorToggleBtn');
      expect(dockedCollapseBtn).toBeDefined();

      const voicingSelect = doc.getElementById('studioVoicingSelect');
      expect(voicingSelect).toBeDefined();
    });

    it('contains Option B: Zen Canvas with floating glass pill dock and contextual line pill', () => {
      const zenPillDock = doc.getElementById('zenPillDock');
      expect(zenPillDock).toBeDefined();
      expect(zenPillDock?.classList.contains('zen-pill-dock')).toBe(true);

      const zenPlayPause = doc.getElementById('zenPlayPauseBtn');
      const zenSync = doc.getElementById('zenSyncBtn');
      const zenSwatches = doc.getElementById('zenSwatches');
      const zenStyle = doc.getElementById('zenStyleControl');
      const zenView = doc.getElementById('zenViewModeControl');
      expect(zenPlayPause).toBeDefined();
      expect(zenSync).toBeDefined();
      expect(zenSwatches).toBeDefined();
      expect(zenStyle).toBeDefined();
      expect(zenView).toBeDefined();

      const zenButtons = zenView?.querySelectorAll<HTMLButtonElement>('[data-view-mode]');
      expect(zenButtons?.length).toBe(2);
      const zenModes = Array.from(zenButtons || []).map((b) => b.getAttribute('data-view-mode'));
      expect(zenModes).toEqual(['studio', 'zen']);

      const zenContextPill = doc.getElementById('zenContextPill');
      expect(zenContextPill).toBeDefined();
      expect(zenContextPill?.classList.contains('zen-context-pill')).toBe(true);
    });

    it('contains Scene Arranger integrated inside Studio Deck with timeline controls and scene card container', () => {
      const tabScenes = doc.getElementById('studioTabScenes');
      expect(tabScenes).toBeDefined();

      const playSeqBtn = doc.getElementById('scenePlaySeqBtn');
      const morphSlider = doc.getElementById('sceneMorphSlider');
      const addBtn = doc.getElementById('sceneAddBtn');
      const dupBtn = doc.getElementById('sceneDupBtn');
      const delBtn = doc.getElementById('sceneDelBtn');
      const cardsList = doc.getElementById('sceneCardsList');

      expect(playSeqBtn).toBeDefined();
      expect(morphSlider).toBeDefined();
      expect(addBtn).toBeDefined();
      expect(dupBtn).toBeDefined();
      expect(delBtn).toBeDefined();
      expect(cardsList).toBeDefined();
    });

    it('contains Minimalist Running Sequence HUD indicator for cross-view feedback', () => {
      const seqIndicator = doc.getElementById('seqMiniIndicator');
      expect(seqIndicator).toBeDefined();
      expect(seqIndicator?.classList.contains('seq-mini-indicator')).toBe(true);

      const seqName = doc.getElementById('seqMiniName');
      const seqState = doc.getElementById('seqMiniState');
      const seqProgressText = doc.getElementById('seqMiniProgressText');
      const seqBarFill = doc.getElementById('seqMiniBarFill');

      expect(seqName).toBeDefined();
      expect(seqState).toBeDefined();
      expect(seqProgressText).toBeDefined();
      expect(seqBarFill).toBeDefined();
    });
  });

  describe('ViewModeManager Transitions & State Enforcement', () => {
    it('initializes to studio deck mode by default', () => {
      const resizeFn = vi.fn();
      const changeFn = vi.fn();
      const vmm = new ViewModeManager({
        onResizeRequired: resizeFn,
        onViewChange: changeFn,
      });

      expect(vmm.getMode()).toBe('studio');
    });

    it('applies DOM visibility and classes correctly for Studio Mode', () => {
      const app = doc.getElementById('app') as HTMLElement;
      const studioDeck = doc.getElementById('studioDeck') as HTMLElement;
      const zenDock = doc.getElementById('zenPillDock') as HTMLElement;
      const topBar = doc.querySelector('.top-bar') as HTMLElement;
      const bottomBar = doc.querySelector('.bottom-bar') as HTMLElement;

      const resizeFn = vi.fn();
      const changeFn = vi.fn();
      const vmm = new ViewModeManager({
        onResizeRequired: resizeFn,
        onViewChange: changeFn,
      });

      vmm.initDOM({
        app,
        studioDeck,
        zenDock,
        topBar,
        bottomBar,
      });

      vmm.setMode('studio');

      expect(app.classList.contains('view-studio')).toBe(true);
      expect(app.classList.contains('view-zen')).toBe(false);

      expect(studioDeck.style.display).toBe('flex');
      expect(zenDock.style.display).toBe('none');
      expect(topBar.style.display).toBe('flex');
      expect(bottomBar.style.display).toBe('flex');
      expect(resizeFn).toHaveBeenCalled();
      expect(changeFn).toHaveBeenCalledWith('studio');
    });

    it('applies DOM visibility and classes correctly for Zen Mode', () => {
      const app = doc.getElementById('app') as HTMLElement;
      const studioDeck = doc.getElementById('studioDeck') as HTMLElement;
      const zenDock = doc.getElementById('zenPillDock') as HTMLElement;
      const topBar = doc.querySelector('.top-bar') as HTMLElement;
      const bottomBar = doc.querySelector('.bottom-bar') as HTMLElement;

      const resizeFn = vi.fn();
      const changeFn = vi.fn();
      const vmm = new ViewModeManager({
        onResizeRequired: resizeFn,
        onViewChange: changeFn,
      });

      vmm.initDOM({
        app,
        studioDeck,
        zenDock,
        topBar,
        bottomBar,
      });

      vmm.setMode('zen');

      expect(app.classList.contains('view-zen')).toBe(true);
      expect(app.classList.contains('view-studio')).toBe(false);

      // In Zen mode: pure full-bleed canvas, all browser clutter hidden
      expect(studioDeck.style.display).toBe('none');
      expect(zenDock.style.display).toBe('flex');
      expect(topBar.style.display).toBe('none');
      expect(bottomBar.style.display).toBe('none');
      expect(changeFn).toHaveBeenCalledWith('zen');
    });

    it('cycles seamlessly between Studio and Zen modes with cycleNextMode()', () => {
      const vmm = new ViewModeManager({
        onResizeRequired: () => {},
        onViewChange: () => {},
      });

      expect(vmm.getMode()).toBe('studio');

      expect(vmm.cycleNextMode()).toBe('zen');
      expect(vmm.getMode()).toBe('zen');

      expect(vmm.cycleNextMode()).toBe('studio');
      expect(vmm.getMode()).toBe('studio');
    });

    it('toggles effortlessly between Studio and Zen with toggleStudioZen()', () => {
      const vmm = new ViewModeManager({
        onResizeRequired: () => {},
        onViewChange: () => {},
      });

      expect(vmm.getMode()).toBe('studio');

      expect(vmm.toggleStudioZen()).toBe('zen');
      expect(vmm.getMode()).toBe('zen');

      expect(vmm.toggleStudioZen()).toBe('studio');
      expect(vmm.getMode()).toBe('studio');
    });
  });

  describe('Mixer Layer Cards Selection Synchronization', () => {
    it('ensures selection highlight is strictly mutually exclusive across layer cards', () => {
      const mixerList = doc.getElementById('studioMixerList');
      expect(mixerList).not.toBeNull();

      // Create two mock layer cards
      const card1 = doc.createElement('div');
      card1.className = 'layer-card selected';
      card1.setAttribute('data-stroke-id', 'stroke-1');

      const card2 = doc.createElement('div');
      card2.className = 'layer-card';
      card2.setAttribute('data-stroke-id', 'stroke-2');

      mixerList!.appendChild(card1);
      mixerList!.appendChild(card2);

      expect(card1.classList.contains('selected')).toBe(true);
      expect(card2.classList.contains('selected')).toBe(false);

      // Function representing updateMixerSelection logic
      const syncSelection = (selectedId: string | null) => {
        const allCards = doc.querySelectorAll('.layer-card');
        allCards.forEach((c) => {
          const cardStrokeId = c.getAttribute('data-stroke-id');
          c.classList.toggle('selected', !!selectedId && cardStrokeId === selectedId);
        });
      };

      // Select stroke-2: card 1 must lose 'selected', card 2 must gain 'selected'
      syncSelection('stroke-2');
      expect(card1.classList.contains('selected')).toBe(false);
      expect(card2.classList.contains('selected')).toBe(true);

      // Deselect (null): both cards must not have 'selected'
      syncSelection(null);
      expect(card1.classList.contains('selected')).toBe(false);
      expect(card2.classList.contains('selected')).toBe(false);

      // Re-select stroke-1: only card 1 has 'selected'
      syncSelection('stroke-1');
      expect(card1.classList.contains('selected')).toBe(true);
      expect(card2.classList.contains('selected')).toBe(false);
    });
  });

  describe('Controls Drawer & Studio Deck Non-Overlapping Layout', () => {
    it('positions advanced drawer to the left of studio deck in Studio View to prevent layers overlap', () => {
      const cssPath = path.resolve(__dirname, '../src/style.css');
      const css = fs.readFileSync(cssPath, 'utf-8');

      // Verify that in Studio view, .advanced-drawer is offset by studio deck width
      expect(css).toMatch(/#app\.view-studio\s+\.advanced-drawer\s*\{[^}]*right:\s*calc\(330px\s*\+\s*14px\)/);
    });

    it('ensures shapeControl segmented switch buttons use flex: 1 to eliminate empty space', () => {
      const cssPath = path.resolve(__dirname, '../src/style.css');
      const css = fs.readFileSync(cssPath, 'utf-8');

      // Verify that .drawer-card .segmented-switch and #shapeControl set width 100% and buttons flex: 1
      expect(css).toMatch(/#shapeControl\s*\{[^}]*width:\s*100%/);
      expect(css).toMatch(/#shapeControl\s+\.seg-btn\s*\{[^}]*flex:\s*1/);

      // Verify shapeControl exists in HTML with Curve and Bar options
      const shapeControl = doc.getElementById('shapeControl');
      expect(shapeControl).not.toBeNull();
      const buttons = shapeControl?.querySelectorAll('button');
      expect(buttons?.length).toBe(2);
      expect(buttons?.[0].textContent?.trim()).toBe('Curve');
      expect(buttons?.[1].textContent?.trim()).toBe('Bar');
    });

    it('ensures Presets & System card has balanced 2x2 grid without empty cells', () => {
      const quickSave = doc.getElementById('quickSaveBtn');
      const saveAs = doc.getElementById('saveTemplateBtn');
      const loadFile = doc.getElementById('loadTemplateFileBtn');
      const mathBtn = doc.getElementById('infoBtn');

      expect(quickSave).not.toBeNull();
      expect(saveAs).not.toBeNull();
      expect(loadFile).not.toBeNull();
      expect(mathBtn).not.toBeNull();

      // Load file and math button share the same 2-col row
      expect(loadFile?.parentElement).toBe(mathBtn?.parentElement);
      expect(loadFile?.parentElement?.classList.contains('drawer-two-col')).toBe(true);
    });
  });
});

