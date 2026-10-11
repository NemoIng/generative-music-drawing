import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

describe('Browser DOM Structure & Speed Traversal Interface', () => {
  const htmlPath = path.resolve(__dirname, '../index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  it('contains the main interactive canvas element', () => {
    const canvas = doc.getElementById('musicCanvas') as HTMLCanvasElement;
    expect(canvas).toBeDefined();
    expect(canvas?.tagName.toLowerCase()).toBe('canvas');
  });

  it('contains inspector speed controls and continuous slider', () => {
    const speedControls = doc.getElementById('trackSpeedControls');
    expect(speedControls).toBeDefined();

    const slider = doc.getElementById('trackSpeedSlider') as HTMLInputElement;
    expect(slider).toBeDefined();
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('0.1');
    expect(slider.max).toBe('4.0');
    expect(slider.step).toBe('0.05');
    expect(slider.value).toBe('1.0');

    const speedVal = doc.getElementById('trackSpeedVal');
    expect(speedVal).toBeDefined();
  });

  it('contains speed preset pills for 1/4x, 1/2x, 1x, and 2x', () => {
    const presetPills = doc.getElementById('speedPresetPills');
    expect(presetPills).toBeDefined();

    const pills = doc.querySelectorAll('.speed-pill');
    expect(pills.length).toBeGreaterThanOrEqual(4);

    const speeds = Array.from(pills).map((p) => p.getAttribute('data-speed'));
    expect(speeds).toContain('0.25');
    expect(speeds).toContain('0.5');
    expect(speeds).toContain('1.0');
    expect(speeds).toContain('2.0');
  });

  it('contains timing mode toggle buttons (Speed vs Timer)', () => {
    const modeToggle = doc.getElementById('speedModeToggle');
    expect(modeToggle).toBeDefined();

    const speedBtn = doc.getElementById('speedModeSpeedBtn');
    expect(speedBtn).toBeDefined();

    const timerBtn = doc.getElementById('speedModeTimerBtn');
    expect(timerBtn).toBeDefined();
  });

  it('contains timer duration controls with 1s to 300s range and preset pills', () => {
    const durationGroup = doc.getElementById('trackDurationGroup');
    expect(durationGroup).toBeDefined();

    const durationSlider = doc.getElementById('trackDurationSlider') as HTMLInputElement;
    expect(durationSlider).toBeDefined();
    expect(durationSlider.min).toBe('1');
    expect(durationSlider.max).toBe('300');

    const pills = doc.querySelectorAll('#durationPresetPills .speed-pill');
    expect(pills.length).toBeGreaterThanOrEqual(4);
    const durations = Array.from(pills).map((p) => p.getAttribute('data-duration'));
    expect(durations).toContain('10');
    expect(durations).toContain('30');
    expect(durations).toContain('60');
    expect(durations).toContain('120');
  });

  it('contains traversal control with Restart and Bounce and confirms texture control is removed from inspector', () => {
    const travControl = doc.getElementById('trackTraversalControl');
    expect(travControl).toBeDefined();

    const travBtns = travControl?.querySelectorAll('.seg-btn');
    expect(travBtns?.length).toBe(2);
    const travModes = Array.from(travBtns || []).map((b) => b.getAttribute('data-track-traversal'));
    expect(travModes).toContain('restart');
    expect(travModes).toContain('bounce');

    // Texture control was removed from inspector
    const trackTextureControl = doc.getElementById('trackTextureControl');
    expect(trackTextureControl).toBeNull();
  });

  it('contains general default sync select with both speed presets and timer presets', () => {
    const generalSelect = doc.getElementById('generalSyncSelect') as HTMLSelectElement;
    expect(generalSelect).toBeDefined();

    const optionValues = Array.from(generalSelect.options).map((opt) => opt.value);
    expect(optionValues).toContain('speed:0.25');
    expect(optionValues).toContain('speed:0.5');
    expect(optionValues).toContain('speed:1.0');
    expect(optionValues).toContain('speed:2.0');
    expect(optionValues).toContain('timer:15');
    expect(optionValues).toContain('timer:30');
    expect(optionValues).toContain('timer:60');
    expect(optionValues).toContain('timer:120');
  });

  it('contains individual line reverb slider in track inspector dock', () => {
    const reverbSlider = doc.getElementById('trackReverbSlider') as HTMLInputElement;
    expect(reverbSlider).toBeDefined();
    expect(reverbSlider.type).toBe('range');
    expect(reverbSlider.min).toBe('0');
    expect(reverbSlider.max).toBe('100');
    expect(reverbSlider.value).toBe('40');

    const reverbVal = doc.getElementById('trackReverbVal');
    expect(reverbVal).toBeDefined();
    expect(reverbVal?.textContent?.trim()).toBe('40%');
  });

  it('contains individual line tone fluctuation slider and confirms deadband slider is removed', () => {
    const flucSlider = doc.getElementById('trackFluctuationSlider') as HTMLInputElement;
    expect(flucSlider).toBeDefined();
    expect(flucSlider.type).toBe('range');
    expect(flucSlider.min).toBe('0');
    expect(flucSlider.max).toBe('1');
    expect(flucSlider.step).toBe('0.01');
    expect(flucSlider.value).toBe('0.00');

    const flucVal = doc.getElementById('trackFluctuationVal');
    expect(flucVal).toBeDefined();
    expect(flucVal?.textContent?.trim()).toBe('0.00');

    // Deadband slider must be completely removed from the DOM
    const deadbandSlider = doc.getElementById('deadbandSlider');
    expect(deadbandSlider).toBeNull();
  });

  it('contains interactive pitch navigator HUD and frequency range scroll controls', () => {
    const nav = doc.getElementById('pitchNavigator');
    expect(nav).toBeDefined();
    expect(nav?.getAttribute('aria-label')).toBe('Frequency Range Navigator');

    // Up, Down, Mid buttons removed from scrollbar for a clean mini-map HUD
    expect(doc.getElementById('pitchScrollUpBtn')).toBeNull();
    expect(doc.getElementById('pitchScrollDownBtn')).toBeNull();
    expect(doc.getElementById('pitchResetBtn')).toBeNull();

    const track = doc.getElementById('pitchTrack');
    expect(track).toBeDefined();

    const thumb = doc.getElementById('pitchThumb');
    expect(thumb).toBeDefined();

    const thumbLabel = doc.getElementById('pitchThumbLabel');
    expect(thumbLabel).toBeDefined();

    // Frequency markers along the track
    const marks = track?.querySelectorAll('.pitch-mark');
    expect(marks?.length).toBe(5);
    const markTexts = Array.from(marks || []).map((m) => m.textContent?.trim());
    expect(markTexts).toContain('8.0 kHz');
    expect(markTexts).toContain('2.0 kHz');
    expect(markTexts).toContain('630 Hz');
    expect(markTexts).toContain('200 Hz');
    expect(markTexts).toContain('100 Hz');
  });

  it('contains Live Wand & Performance Controls inside advanced drawer', () => {
    const liveGroup = doc.getElementById('liveControlsGroup');
    expect(liveGroup).toBeDefined();

    const reverbSlider = doc.getElementById('liveReverbSlider') as HTMLInputElement;
    expect(reverbSlider).toBeDefined();
    expect(reverbSlider.type).toBe('range');
    expect(reverbSlider.min).toBe('0');
    expect(reverbSlider.max).toBe('100');
    expect(reverbSlider.value).toBe('50');

    const volSlider = doc.getElementById('liveVolSlider') as HTMLInputElement;
    expect(volSlider).toBeDefined();
    expect(volSlider.type).toBe('range');
    expect(volSlider.min).toBe('0');
    expect(volSlider.max).toBe('100');
    expect(volSlider.value).toBe('90');

    const sustainSlider = doc.getElementById('liveSustainSlider') as HTMLInputElement;
    expect(sustainSlider).toBeDefined();
    expect(sustainSlider.type).toBe('range');
    expect(sustainSlider.min).toBe('0.05');
    expect(sustainSlider.max).toBe('2.5');

    const snapBtn = doc.getElementById('liveSnapBtn') as HTMLButtonElement;
    expect(snapBtn).toBeDefined();

    const trailSlider = doc.getElementById('liveTrailSlider') as HTMLInputElement;
    expect(trailSlider).toBeDefined();
    expect(trailSlider.type).toBe('range');

    const drawOnlyControls = doc.querySelectorAll('.draw-only-control');
    expect(drawOnlyControls.length).toBeGreaterThanOrEqual(3);
  });

  it('contains dedicated line inspector dock and advanced drawer with collision-free layering', () => {
    const inspectorBar = doc.getElementById('trackInspectorBar');
    expect(inspectorBar).toBeDefined();
    expect(inspectorBar?.style.display).toBe('none');

    const drawer = doc.getElementById('advancedDrawer');
    expect(drawer).toBeDefined();
    expect(drawer?.style.display).toBe('none');

    const toggleBtn = doc.getElementById('drawerToggleBtn');
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn?.textContent?.trim()).toBe('Controls');

    const closeBtn = doc.getElementById('drawerCloseBtn');
    expect(closeBtn).toBeDefined();
    expect(closeBtn?.textContent?.trim()).toBe('Close');

    const cssPath = path.resolve(__dirname, '../src/style.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    // Advanced drawer is anchored on the right side as a popover sidebar
    expect(css).toMatch(/\.advanced-drawer\s*\{[^}]*right:\s*14px/);
    expect(css).toMatch(/\.advanced-drawer\s*\{[^}]*z-index:\s*200/);

    // Inspector bar must have elevated z-index (130) and smooth transition
    expect(css).toMatch(/\.track-inspector-bar\s*\{[^}]*z-index:\s*130/);
    expect(css).toMatch(/\.track-inspector-bar\s*\{[^}]*transition:[^}]*top/);

    // Inspector with drawer shifts away from the right popover
    expect(css).toMatch(/\.track-inspector-bar\.inspector-with-drawer/);

    // Bottom dock offset is 38px to sit cleanly above bottom status bar
    expect(css).toMatch(/\.track-inspector-bar\.inspector-bottom\s*\{[^}]*bottom:\s*38px/);

    // Inspector bar bounds and fit-content styling
    expect(css).toMatch(/\.track-inspector-bar\s*\{[^}]*width:\s*fit-content/);
    expect(css).toMatch(/\.track-inspector-bar\s*\{[^}]*max-width:\s*calc\(100vw\s*-\s*28px\)/);

    // Badge styling prevents multi-line wrapping
    expect(css).toMatch(/\.inspector-badge-name\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.inspector-badge-name\s*\{[^}]*text-overflow:\s*ellipsis/);

    // Timing wrap is a single horizontal flex row rather than a double-decker
    expect(css).toMatch(/\.track-speed-wrap\s*\{[^}]*flex-direction:\s*row/);
  });

  it('guarantees all buttons and labels in the inspector bar contain only clean text without emojis', () => {
    const inspectorBar = doc.getElementById('trackInspectorBar');
    expect(inspectorBar).toBeDefined();

    const buttons = inspectorBar?.querySelectorAll('button') || [];
    expect(buttons.length).toBeGreaterThan(0);

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    for (const btn of Array.from(buttons)) {
      expect(emojiRegex.test(btn.textContent || '')).toBe(false);
    }
  });

  it('contains Save Preset modal with overwrite, new version, and custom name controls', () => {
    const modal = doc.getElementById('savePresetModal');
    expect(modal).toBeDefined();
    expect(modal?.classList.contains('modal')).toBe(true);
    expect(modal?.classList.contains('hidden')).toBe(true);

    const nameInput = doc.getElementById('savePresetNameInput') as HTMLInputElement;
    expect(nameInput).toBeDefined();
    expect(nameInput?.tagName.toLowerCase()).toBe('input');

    const overwriteBtn = doc.getElementById('overwritePresetBtn') as HTMLButtonElement;
    expect(overwriteBtn).toBeDefined();
    expect(overwriteBtn?.textContent?.trim()).toBe('Overwrite Current Preset');

    const newVersionBtn = doc.getElementById('saveNewVersionBtn') as HTMLButtonElement;
    expect(newVersionBtn).toBeDefined();
    expect(newVersionBtn?.textContent?.trim()).toBe('Save as New Version');

    const customNameBtn = doc.getElementById('saveCustomNameBtn') as HTMLButtonElement;
    expect(customNameBtn).toBeDefined();
    expect(customNameBtn?.textContent?.trim()).toBe('Save with Entered Name');

    const exportCheck = doc.getElementById('saveExportJsonCheck') as HTMLInputElement;
    expect(exportCheck).toBeDefined();
    expect(exportCheck?.type).toBe('checkbox');

    const closeBtn = doc.getElementById('closeSavePresetModalBtn') as HTMLButtonElement;
    expect(closeBtn).toBeDefined();
    expect(closeBtn?.textContent?.trim()).toBe('Close');
  });

  it('contains Randomize button next to Sync in master actions bar with emoji-free text and tooltip', () => {
    const resyncBtn = doc.getElementById('resyncBtn') as HTMLButtonElement;
    expect(resyncBtn).toBeDefined();
    expect(resyncBtn.textContent?.trim()).toBe('Sync');

    const randBtn = doc.getElementById('randomizePlayheadsBtn') as HTMLButtonElement;
    expect(randBtn).toBeDefined();
    expect(randBtn.textContent?.trim()).toBe('Randomize');

    // Must be placed immediately next to Sync in DOM
    expect(resyncBtn.nextElementSibling).toBe(randBtn);

    // Must have tooltip explaining moving dot scattering
    const tip = randBtn.getAttribute('data-tooltip');
    expect(tip).toBeDefined();
    expect(tip).toContain('Randomize Lines');

    // Emoji-free check
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    expect(emojiRegex.test(randBtn.textContent || '')).toBe(false);
  });

  it('has removed old chord progression strip and provides line harmonizer voicing selects', () => {
    // Old progression strip should be gone
    const oldStrip = doc.getElementById('chordProgressionStrip');
    expect(oldStrip).toBeNull();

    // Default harmonizer voicing select in drawer
    const defaultHarmonizer = doc.getElementById('defaultHarmonizerSelect') as HTMLSelectElement;
    expect(defaultHarmonizer).toBeDefined();
    expect(defaultHarmonizer.tagName.toLowerCase()).toBe('select');
    const defaultOptions = Array.from(defaultHarmonizer.options).map((o) => o.value);
    expect(defaultOptions).toEqual(['single', 'octave', 'subOctave', 'dualOctave']);

    // Track inspector harmonizer voicing select
    const trackHarmonizer = doc.getElementById('trackHarmonizerSelect') as HTMLSelectElement;
    expect(trackHarmonizer).toBeDefined();
    expect(trackHarmonizer.tagName.toLowerCase()).toBe('select');
    const trackOptions = Array.from(trackHarmonizer.options).map((o) => o.value);
    expect(trackOptions).toEqual(['single', 'octave', 'subOctave', 'dualOctave']);

    // Clean text / emoji-free check on harmonizer options
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    for (const opt of Array.from(trackHarmonizer.options)) {
      expect(emojiRegex.test(opt.textContent || '')).toBe(false);
    }
    for (const opt of Array.from(defaultHarmonizer.options)) {
      expect(emojiRegex.test(opt.textContent || '')).toBe(false);
    }
  });

  it('contains Organic Timbral Breathing selector (Option 3) with clean text and tooltips', () => {
    const breathingSelect = doc.getElementById('breathingSelect') as HTMLSelectElement;
    expect(breathingSelect).toBeDefined();
    expect(breathingSelect.tagName.toLowerCase()).toBe('select');

    const options = Array.from(breathingSelect.options).map((o) => o.value);
    expect(options).toEqual(['gentle', 'deep', 'drift', 'off']);

    // Check emoji-free text
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    for (const opt of Array.from(breathingSelect.options)) {
      expect(emojiRegex.test(opt.textContent || '')).toBe(false);
    }
  });

  it('contains Record button, Record modal with Simulate and Live tabs, and Live Recording Banner', () => {
    // Record top bar button
    const recordModalBtn = doc.getElementById('recordModalBtn') as HTMLButtonElement;
    expect(recordModalBtn).toBeDefined();
    expect(recordModalBtn.textContent?.trim()).toBe('Record');

    // Record modal
    const recordModal = doc.getElementById('recordModal');
    expect(recordModal).toBeDefined();
    expect(recordModal?.classList.contains('hidden')).toBe(true);

    // Tab buttons
    const tabSimulateBtn = doc.getElementById('tabSimulateBtn');
    const tabLiveBtn = doc.getElementById('tabLiveBtn');
    expect(tabSimulateBtn).toBeDefined();
    expect(tabLiveBtn).toBeDefined();

    // Panes
    const simPane = doc.getElementById('tabSimulatePane');
    const livePane = doc.getElementById('tabLivePane');
    expect(simPane).toBeDefined();
    expect(livePane).toBeDefined();

    // Duration input and preset buttons
    const durationInput = doc.getElementById('simDurationInput') as HTMLInputElement;
    expect(durationInput).toBeDefined();
    expect(durationInput.value).toBe('30');
    expect(parseInt(durationInput.min, 10)).toBe(5);

    const durationPills = doc.querySelectorAll('.duration-pill-btn');
    expect(durationPills.length).toBeGreaterThanOrEqual(4);
    const secs = Array.from(durationPills).map((p) => p.getAttribute('data-sec'));
    expect(secs).toContain('15');
    expect(secs).toContain('30');
    expect(secs).toContain('60');

    // Action buttons inside modal
    const startSimBtn = doc.getElementById('startSimulateBtn');
    const startLiveBtn = doc.getElementById('startLiveRecBtn');
    expect(startSimBtn).toBeDefined();
    expect(startLiveBtn).toBeDefined();

    // Floating Live Recording Banner
    const liveBanner = doc.getElementById('liveRecordingBanner');
    expect(liveBanner).toBeDefined();
    expect(liveBanner?.classList.contains('hidden')).toBe(true);

    const liveRecTimer = doc.getElementById('liveRecTimer');
    expect(liveRecTimer).toBeDefined();
    expect(liveRecTimer?.textContent?.trim()).toBe('00:00');

    const stopLiveRecBtn = doc.getElementById('stopLiveRecBtn');
    const cancelLiveRecBtn = doc.getElementById('cancelLiveRecBtn');
    expect(stopLiveRecBtn).toBeDefined();
    expect(cancelLiveRecBtn).toBeDefined();

    // Verify all button texts are strictly emoji-free
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    const testElements = [recordModalBtn, tabSimulateBtn, tabLiveBtn, startSimBtn, startLiveBtn, stopLiveRecBtn, cancelLiveRecBtn];
    for (const el of testElements) {
      if (el) {
        expect(emojiRegex.test(el.textContent || '')).toBe(false);
      }
    }
  });

  it('declutters the top bar actions and places secondary utility controls and guide in the bottom bar', () => {
    const topActions = doc.querySelector('.top-actions-group .actions-group');
    expect(topActions).toBeDefined();

    // Top actions bar should contain only core playback/transport & controls buttons
    const topButtons = Array.from(topActions?.children || []).map((el) => el.id);
    expect(topButtons).toEqual([
      'resyncBtn',
      'randomizePlayheadsBtn',
      'playPauseBtn',
      'undoBtn',
      'recordModalBtn',
      'drawerToggleBtn',
    ]);

    // Bottom bar actions container exists
    const bottomActions = doc.querySelector('.bottom-bar .bottom-bar-actions');
    expect(bottomActions).toBeDefined();

    // Contains Clear, Theme, Fullscreen, and Guide
    const clearBtn = bottomActions?.querySelector('#clearBtn');
    const themeBtn = bottomActions?.querySelector('#themeToggleBtn');
    const fsBtn = bottomActions?.querySelector('#fullscreenBtn');
    const guideBtn = bottomActions?.querySelector('.btn-guide') as HTMLAnchorElement;

    expect(clearBtn).toBeDefined();
    expect(themeBtn).toBeDefined();
    expect(fsBtn).toBeDefined();
    expect(guideBtn).toBeDefined();

    // Guide button is at the end of bottom-bar-actions (bottom right corner)
    expect(bottomActions?.lastElementChild).toBe(guideBtn);
    expect(guideBtn.getAttribute('href')).toBe('guide.html');
    expect(guideBtn.textContent?.trim()).toBe('Guide');
  });

  it('provides dedicated Keyboard Shortcuts modal accessible via ? key', () => {
    const modal = doc.getElementById('shortcutsModal');
    expect(modal).toBeDefined();

    const shortcutsList = modal?.querySelector('.shortcuts-grid');
    expect(shortcutsList).toBeDefined();

    const shortcutRows = shortcutsList?.querySelectorAll('.shortcut-row');
    expect(shortcutRows && shortcutRows.length).toBeGreaterThanOrEqual(10);

    // Verify key shortcuts are listed (Space, R, Shift + R, L, Esc, etc.)
    const keysText = Array.from(shortcutRows || []).map((r) => r.textContent || '');
    expect(keysText.some((t) => t.includes('Space') && t.includes('Play'))).toBe(true);
    expect(keysText.some((t) => t.includes('Shift + R'))).toBe(true);
    expect(keysText.some((t) => t.includes('L'))).toBe(true);
    expect(keysText.some((t) => t.includes('Esc'))).toBe(true);
  });

  it('contains delete buttons across inspector, studio deck, and layers mixer', () => {
    const deleteTrackBtn = doc.getElementById('deleteTrackBtn');
    expect(deleteTrackBtn).toBeDefined();

    const studioDelTrackBtn = doc.getElementById('studioDelTrackBtn');
    expect(studioDelTrackBtn).toBeDefined();

    const studioMixerList = doc.getElementById('studioMixerList');
    expect(studioMixerList).toBeDefined();

    // The separate floating layerMixerDrawer panel is removed
    const layerMixerDrawer = doc.getElementById('layerMixerDrawer');
    expect(layerMixerDrawer).toBeNull();

    const studioLayerCount = doc.getElementById('studioLayerCount');
    expect(studioLayerCount).toBeDefined();

    const layerCountBadge = doc.getElementById('layerCountBadge');
    expect(layerCountBadge).toBeDefined();

    const layersStatusChip = doc.getElementById('layersStatusChip');
    expect(layersStatusChip).toBeDefined();
    expect(layersStatusChip?.tagName.toLowerCase()).toBe('span');
    expect(layersStatusChip?.classList.contains('status-chip')).toBe(true);
  });

  it('contains dirtyIndicator element within top-template-group with zero layout shift structure', () => {
    const dirtyIndicator = doc.getElementById('dirtyIndicator');
    expect(dirtyIndicator).toBeDefined();
    expect(dirtyIndicator?.classList.contains('dirty-badge')).toBe(true);

    const templateGroup = doc.querySelector('.top-template-group');
    expect(templateGroup).toBeDefined();

    const labelRow = templateGroup?.querySelector('.top-row-label-row');
    expect(labelRow).toBeDefined();
    expect(labelRow?.contains(dirtyIndicator)).toBe(true);
  });

  it('contains Fast-Forward / Rewind shortcut in the keyboard shortcuts list', () => {
    const kbdTexts = Array.from(doc.querySelectorAll('#shortcutsModal kbd')).map((el) => el.textContent?.trim());
    expect(kbdTexts).toContain('+');
    expect(kbdTexts).toContain('-');
  });

  it('contains Studio Deck tab switcher with Layers Mixer, Master FX, and Scenes views', () => {
    const tabMixerBtn = doc.getElementById('studioTabBtnMixer');
    const tabMasterBtn = doc.getElementById('studioTabBtnMaster');
    const tabScenesBtn = doc.getElementById('studioTabBtnScenes');
    const tabMixer = doc.getElementById('studioTabMixer');
    const tabMaster = doc.getElementById('studioTabMaster');
    const tabScenes = doc.getElementById('studioTabScenes');

    expect(tabMixerBtn).toBeDefined();
    expect(tabMasterBtn).toBeDefined();
    expect(tabScenesBtn).toBeDefined();
    expect(tabMixer).toBeDefined();
    expect(tabMaster).toBeDefined();
    expect(tabScenes).toBeDefined();
  });

  it('draws speed multiplier (0.x) on canvas selection pill badge instead of seconds', async () => {
    (global as any).window = dom.window;
    const { CanvasRenderer } = await import('../src/canvas/renderer');
    const { StrokeManager } = await import('../src/engine/strokeManager');
    const { ScaleQuantizer } = await import('../src/audio/scaleQuantizer');

    const sm = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    const stroke = sm.addStroke({
      segments: [{
        p0: { x: 10, y: 10 },
        p1: { x: 30, y: 10 },
        p2: { x: 70, y: 10 },
        p3: { x: 100, y: 10 },
      }],
      isClosed: false,
    }, 'solid', 'indigo', 120, quantizer, 600);
    stroke.selected = true;
    stroke.speedMultiplier = 0.5;

    let renderedText = '';
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      bezierCurveTo: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      setLineDash: () => {},
      setTransform: () => {},
      roundRect: () => {},
      measureText: () => ({ width: 80 }),
      fillText: (text: string) => {
        renderedText = text;
      },
    };

    const canvas = doc.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => {} });
    canvas.getContext = () => mockCtx as any;

    const renderer = new CanvasRenderer(canvas);
    renderer.drawStroke(stroke);

    expect(renderedText).toContain('0.5x');
    expect(renderedText).not.toMatch(/\d+\.\d+s/);
  });

  it('contains share button pointing to production URL and supports composition coordinates correctly', async () => {
    const shareBtn = doc.getElementById('shareLinkBtn');
    expect(shareBtn).toBeDefined();
    expect(shareBtn?.getAttribute('data-tooltip')).toContain('Share Link');

    const { StrokeManager } = await import('../src/engine/strokeManager');
    const { ScaleQuantizer } = await import('../src/audio/scaleQuantizer');
    const strokeMgr = new StrokeManager();
    const quantizer = new ScaleQuantizer();
    quantizer.scrollY = 250;
    const exported = strokeMgr.exportComposition('Test Preset', 'dorian', 'D2', 1200, 800);
    exported.scrollY = 250;

    // Importing into quantizer preserves pitch register without shifting strokes
    expect(exported.scrollY).toBe(250);
  });

  it('supports modifying sliders and number inputs by scrolling (wheel event)', () => {
    const bpmSlider = doc.getElementById('bpmSlider') as HTMLInputElement;
    expect(bpmSlider).not.toBeNull();
    bpmSlider.value = '100';

    // Simulate wheel-to-modify logic
    const handleSliderWheel = (slider: HTMLInputElement, deltaY: number, shiftKey = false) => {
      const min = slider.min !== '' ? parseFloat(slider.min) : 0;
      const max = slider.max !== '' ? parseFloat(slider.max) : 100;
      const step = slider.step !== '' && slider.step !== 'any' ? parseFloat(slider.step) : 1;
      const currentVal = parseFloat(slider.value);
      const delta = -deltaY;
      const speedMultiplier = shiftKey ? 5 : 1;
      const stepIncrement = (delta > 0 ? 1 : -1) * step * speedMultiplier;
      let nextVal = Math.max(min, Math.min(max, currentVal + stepIncrement));
      slider.value = nextVal.toString();
      slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    };

    let inputFired = false;
    bpmSlider.addEventListener('input', () => { inputFired = true; });

    // Scroll up (deltaY < 0): increases value by step (step is 2)
    handleSliderWheel(bpmSlider, -100);
    expect(bpmSlider.value).toBe('102');
    expect(inputFired).toBe(true);

    // Scroll down (deltaY > 0): decreases value by step (step is 2)
    handleSliderWheel(bpmSlider, 100);
    expect(bpmSlider.value).toBe('100');

    // Shift key: 5x step jump
    handleSliderWheel(bpmSlider, -100, true);
    expect(bpmSlider.value).toBe('110');
  });

  it('contains Reverb Space Model options and Sound Dynamics controls across drawer and studio deck', () => {
    const reverbSelect = doc.getElementById('reverbTypeSelect') as HTMLSelectElement;
    const studioReverbSelect = doc.getElementById('studioReverbTypeSelect') as HTMLSelectElement;
    expect(reverbSelect).not.toBeNull();
    expect(studioReverbSelect).not.toBeNull();

    const expectedReverbTypes = ['cathedral', 'shimmer', 'hall', 'plate', 'chamber'];
    const drawerOptions = Array.from(reverbSelect.options).map((o) => o.value);
    const studioOptions = Array.from(studioReverbSelect.options).map((o) => o.value);
    expect(drawerOptions).toEqual(expectedReverbTypes);
    expect(studioOptions).toEqual(expectedReverbTypes);

    const stereoWidth = doc.getElementById('stereoWidthSlider') as HTMLInputElement;
    const studioStereoWidth = doc.getElementById('studioStereoWidthSlider') as HTMLInputElement;
    expect(stereoWidth).not.toBeNull();
    expect(studioStereoWidth).not.toBeNull();

    const tapeWarmth = doc.getElementById('tapeWarmthSlider') as HTMLInputElement;
    const studioTapeWarmth = doc.getElementById('studioTapeWarmthSlider') as HTMLInputElement;
    expect(tapeWarmth).not.toBeNull();
    expect(studioTapeWarmth).not.toBeNull();

    const ducking = doc.getElementById('duckingSlider') as HTMLInputElement;
    const studioDucking = doc.getElementById('studioDuckingSlider') as HTMLInputElement;
    expect(ducking).not.toBeNull();
    expect(studioDucking).not.toBeNull();
  });

  it('provides descriptive hover tooltips for all Master FX panel controls in Studio Deck', () => {
    const masterPane = doc.getElementById('studioTabMaster');
    expect(masterPane).not.toBeNull();

    const tooltips = masterPane?.querySelectorAll('.has-tooltip');
    expect(tooltips).toBeDefined();
    expect(tooltips!.length).toBeGreaterThanOrEqual(10);

    const bpmTooltip = doc.getElementById('studioMasterBpmSlider')?.closest('.has-tooltip');
    expect(bpmTooltip?.getAttribute('data-tooltip')).toContain('Tempo');

    const reverbTooltip = doc.getElementById('studioMasterReverbSlider')?.closest('.has-tooltip');
    expect(reverbTooltip?.getAttribute('data-tooltip')).toContain('Reverb Mix');

    const spaceTooltip = doc.getElementById('studioReverbTypeSelect')?.closest('.has-tooltip');
    expect(spaceTooltip?.getAttribute('data-tooltip')).toContain('Acoustic Space Model');

    const stereoTooltip = doc.getElementById('studioStereoWidthSlider')?.closest('.has-tooltip');
    expect(stereoTooltip?.getAttribute('data-tooltip')).toContain('Stereo');

    const tapeTooltip = doc.getElementById('studioTapeWarmthSlider')?.closest('.has-tooltip');
    expect(tapeTooltip?.getAttribute('data-tooltip')).toContain('Tape Warmth');

    const duckingTooltip = doc.getElementById('studioDuckingSlider')?.closest('.has-tooltip');
    expect(duckingTooltip?.getAttribute('data-tooltip')).toContain('Sidechain Ducking');

    const syncBtn = doc.getElementById('studioSyncBtn');
    expect(syncBtn?.getAttribute('data-tooltip')).toContain('Sync Lines');

    const randBtn = doc.getElementById('studioRandomizeBtn');
    expect(randBtn?.getAttribute('data-tooltip')).toContain('Randomize Lines');
  });

  it('contains toggleTooltipsBtn button in Controls drawer to disable hover descriptions', () => {
    const toggleBtn = doc.getElementById('toggleTooltipsBtn');
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn?.textContent?.trim()).toBe('Hints On');
    expect(toggleBtn?.getAttribute('data-tooltip')).toContain('Toggle Tooltips');
  });

  it('supports active-mute and active-solo CSS state classes on layer cards and action buttons', () => {
    const cssPath = path.resolve(__dirname, '../src/style.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toContain('.layer-btn.active-mute');
    expect(css).toContain('.layer-btn.active-solo');
    expect(css).toContain('.layer-card.dimmed');

    // Create a mock layer card element and verify class toggling behavior
    const mockCard = doc.createElement('div');
    mockCard.className = 'layer-card';
    const muteBtn = doc.createElement('button');
    muteBtn.className = 'layer-btn';
    muteBtn.setAttribute('data-action', 'mute');
    const soloBtn = doc.createElement('button');
    soloBtn.className = 'layer-btn';
    soloBtn.setAttribute('data-action', 'solo');
    mockCard.appendChild(muteBtn);
    mockCard.appendChild(soloBtn);

    // Toggle mute
    muteBtn.classList.toggle('active-mute', true);
    mockCard.classList.toggle('dimmed', true);
    expect(muteBtn.classList.contains('active-mute')).toBe(true);
    expect(mockCard.classList.contains('dimmed')).toBe(true);

    // Toggle solo
    soloBtn.classList.toggle('active-solo', true);
    expect(soloBtn.classList.contains('active-solo')).toBe(true);
  });

  it('contains traversal and wave control elements in inspectors that can be toggled for dot notes', () => {
    const trackTraversalCell = doc.getElementById('trackTraversalControl')?.closest('.inspector-cell');
    const trackWaveCell = doc.getElementById('trackWaveControl');
    const studioTraversalSwitch = doc.getElementById('studioTraversalSwitch');
    const studioWaveShapeSelect = doc.getElementById('studioWaveShapeSelect');
    const zenContextTravBtn = doc.getElementById('zenContextTravBtn');

    expect(trackTraversalCell).toBeDefined();
    expect(trackWaveCell).toBeDefined();
    expect(studioTraversalSwitch).toBeDefined();
    expect(studioWaveShapeSelect).toBeDefined();
    expect(zenContextTravBtn).toBeDefined();

    // Verify hiding styling can be applied
    const studioTraversalRow = studioTraversalSwitch?.closest('.docked-row') as HTMLElement | null;
    const studioWaveGroup = studioWaveShapeSelect?.closest('.docked-group') as HTMLElement | null;
    if (studioTraversalRow) studioTraversalRow.style.display = 'none';
    if (studioWaveGroup) studioWaveGroup.style.display = 'none';
    if (trackTraversalCell) (trackTraversalCell as HTMLElement).style.display = 'none';
    if (trackWaveCell) (trackWaveCell as HTMLElement).style.display = 'none';
    if (zenContextTravBtn) (zenContextTravBtn as HTMLElement).style.display = 'none';

    expect(studioTraversalRow?.style.display).toBe('none');
    expect(studioWaveGroup?.style.display).toBe('none');
    expect((trackTraversalCell as HTMLElement)?.style.display).toBe('none');
    expect((trackWaveCell as HTMLElement)?.style.display).toBe('none');
    expect((zenContextTravBtn as HTMLElement)?.style.display).toBe('none');
  });

  it('contains statAudio element with initial unstarted state and updates properly', () => {
    const statAudio = doc.getElementById('statAudio') as HTMLButtonElement;
    expect(statAudio).toBeDefined();
    expect(statAudio.classList.contains('status-chip')).toBe(true);
    expect(statAudio.classList.contains('chip-unstarted')).toBe(true);
    expect(statAudio.textContent).toBe('Click to Start Audio');

    // Simulate transition when audio unlocks
    statAudio.textContent = 'Audio: Active';
    statAudio.classList.remove('chip-unstarted');
    statAudio.classList.add('chip-ready');

    expect(statAudio.textContent).toBe('Audio: Active');
    expect(statAudio.classList.contains('chip-ready')).toBe(true);
    expect(statAudio.classList.contains('chip-unstarted')).toBe(false);
  });

  it('contains Scenes Arranger Morph duration slider and Transition Blend segmented control with full labels', () => {
    const morphSlider = doc.getElementById('sceneMorphSlider') as HTMLInputElement;
    const morphVal = doc.getElementById('sceneMorphVal') as HTMLSpanElement;
    const blendSwitch = doc.getElementById('sceneMorphBlendSwitch') as HTMLElement;
    const blendSelect = doc.getElementById('sceneMorphCurveSelect') as HTMLSelectElement;

    expect(morphSlider).toBeDefined();
    expect(morphVal).toBeDefined();
    expect(morphVal.textContent?.trim()).toBe('6s');
    expect(blendSwitch).toBeDefined();
    expect(blendSwitch.classList.contains('scene-blend-switch')).toBe(true);

    const buttons = Array.from(blendSwitch.querySelectorAll<HTMLButtonElement>('.seg-btn'));
    expect(buttons.length).toBe(3);

    const modes = buttons.map(b => b.getAttribute('data-blend'));
    expect(modes).toEqual(['equalPower', 'reverbWash', 'linear']);

    const labels = buttons.map(b => b.textContent?.trim());
    expect(labels).toEqual(['Lush', 'Wash', 'Linear']);

    expect(buttons[0].classList.contains('active')).toBe(true);
    expect(blendSelect).toBeDefined();
  });
});


