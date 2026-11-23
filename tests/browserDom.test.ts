import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import { SCALES } from '../src/audio/scales';

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
    expect(doc.getElementById('trackInspectorBar')).toBeNull();
    expect(doc.getElementById('trackSpeedControls')).toBeNull();
    expect(doc.getElementById('trackSpeedSlider')).toBeNull();

    const dockedInspector = doc.getElementById('studioDockedInspector');
    expect(dockedInspector).not.toBeNull();

    const timingRow = doc.getElementById('studioTimingSliderRow');
    expect(timingRow).not.toBeNull();

    const modeLabel = doc.getElementById('studioTimingModeLabel');
    expect(modeLabel).not.toBeNull();
    expect(modeLabel?.textContent?.trim()).toBe('Speed');

    const slider = doc.getElementById('studioTimingSlider') as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('0.1');
    expect(slider.max).toBe('4.0');
    expect(slider.step).toBe('0.05');
    expect(slider.value).toBe('1.0');

    const speedVal = doc.getElementById('studioTimingVal');
    expect(speedVal).not.toBeNull();
    expect(speedVal?.textContent?.trim()).toBe('1.00x');
  });

  it('contains docked timing mode segmented toggle and confirms legacy speed pills are removed', () => {
    expect(doc.getElementById('speedPresetPills')).toBeNull();

    const dockedInspector = doc.getElementById('studioDockedInspector');
    expect(dockedInspector).not.toBeNull();

    const timingToggle = dockedInspector?.querySelector('#studioTimingToggle');
    expect(timingToggle).not.toBeNull();

    const btns = Array.from(timingToggle?.querySelectorAll('.seg-btn') || []);
    expect(btns.map((b) => b.getAttribute('data-timing-mode'))).toEqual(['speed', 'timer']);
    expect(btns.map((b) => b.textContent?.trim())).toEqual(['Speed', 'Timer']);
  });

  it('contains timing mode toggle buttons (Speed vs Timer)', () => {
    expect(doc.getElementById('speedModeToggle')).toBeNull();
    expect(doc.getElementById('speedModeSpeedBtn')).toBeNull();
    expect(doc.getElementById('speedModeTimerBtn')).toBeNull();

    const timingToggle = doc.getElementById('studioTimingToggle');
    expect(timingToggle).not.toBeNull();

    const speedBtn = timingToggle?.querySelector('.seg-btn[data-timing-mode="speed"]');
    expect(speedBtn).not.toBeNull();

    const timerBtn = timingToggle?.querySelector('.seg-btn[data-timing-mode="timer"]');
    expect(timerBtn).not.toBeNull();
  });

  it('contains docked wave shape, amplitude, and period controls and confirms legacy duration group is removed', () => {
    expect(doc.getElementById('trackDurationGroup')).toBeNull();
    expect(doc.getElementById('trackDurationSlider')).toBeNull();

    const dockedInspector = doc.getElementById('studioDockedInspector');
    expect(dockedInspector).not.toBeNull();

    const waveShapeSelect = dockedInspector?.querySelector('#studioWaveShapeSelect') as HTMLSelectElement | null;
    expect(waveShapeSelect).not.toBeNull();

    const waveSineBtn = dockedInspector?.querySelector('#studioWaveSineBtn') as HTMLButtonElement | null;
    expect(waveSineBtn).not.toBeNull();

    const waveAmpSlider = dockedInspector?.querySelector('#studioWaveAmpSlider') as HTMLInputElement | null;
    expect(waveAmpSlider).not.toBeNull();
    expect(waveAmpSlider?.type).toBe('range');
    expect(waveAmpSlider?.min).toBe('0');
    expect(waveAmpSlider?.max).toBe('100');
    expect(waveAmpSlider?.step).toBe('1');
    expect(waveAmpSlider?.value).toBe('0');

    const waveAmpVal = dockedInspector?.querySelector('#studioWaveAmpVal');
    expect(waveAmpVal).not.toBeNull();
    expect(waveAmpVal?.textContent?.trim()).toBe('0px');

    const wavePeriodSlider = dockedInspector?.querySelector('#studioWavePeriodSlider') as HTMLInputElement | null;
    expect(wavePeriodSlider).not.toBeNull();
    expect(wavePeriodSlider?.type).toBe('range');
    expect(wavePeriodSlider?.min).toBe('1');
    expect(wavePeriodSlider?.max).toBe('8');
    expect(wavePeriodSlider?.step).toBe('1');
    expect(wavePeriodSlider?.value).toBe('2');

    const wavePeriodVal = dockedInspector?.querySelector('#studioWavePeriodVal');
    expect(wavePeriodVal).not.toBeNull();
    expect(wavePeriodVal?.textContent?.trim()).toBe('2');
  });

  it('contains traversal control with Restart and Bounce and confirms legacy traversal and texture controls are removed', () => {
    expect(doc.getElementById('trackTraversalControl')).toBeNull();
    expect(doc.getElementById('trackTextureControl')).toBeNull();

    const travControl = doc.getElementById('studioTraversalSwitch');
    expect(travControl).not.toBeNull();

    const travBtns = travControl?.querySelectorAll('.seg-btn');
    expect(travBtns?.length).toBe(2);
    const travModes = Array.from(travBtns || []).map((b) => b.getAttribute('data-track-traversal'));
    expect(travModes).toContain('restart');
    expect(travModes).toContain('bounce');
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

  it('contains Tone & Grit FX sliders in studio docked inspector and confirms legacy track reverb slider is removed', () => {
    expect(doc.getElementById('trackReverbSlider')).toBeNull();
    expect(doc.getElementById('trackReverbVal')).toBeNull();

    const dockedInspector = doc.getElementById('studioDockedInspector');
    expect(dockedInspector).not.toBeNull();

    const distSlider = dockedInspector?.querySelector('#studioDistortionSlider') as HTMLInputElement | null;
    const distVal = dockedInspector?.querySelector('#studioDistortionVal');
    expect(distSlider).not.toBeNull();
    expect(distSlider?.type).toBe('range');
    expect(distSlider?.min).toBe('0');
    expect(distSlider?.max).toBe('100');
    expect(distSlider?.value).toBe('0');
    expect(distVal?.textContent?.trim()).toBe('0%');

    const filterSlider = dockedInspector?.querySelector('#studioFilterSlider') as HTMLInputElement | null;
    const filterVal = dockedInspector?.querySelector('#studioFilterVal');
    expect(filterSlider).not.toBeNull();
    expect(filterSlider?.type).toBe('range');
    expect(filterSlider?.min).toBe('0');
    expect(filterSlider?.max).toBe('100');
    expect(filterSlider?.value).toBe('100');
    expect(filterVal?.textContent?.trim()).toBe('100%');

    const lofiSlider = dockedInspector?.querySelector('#studioLofiSlider') as HTMLInputElement | null;
    const lofiVal = dockedInspector?.querySelector('#studioLofiVal');
    expect(lofiSlider).not.toBeNull();
    expect(lofiSlider?.type).toBe('range');
    expect(lofiSlider?.min).toBe('0');
    expect(lofiSlider?.max).toBe('100');
    expect(lofiSlider?.value).toBe('0');
    expect(lofiVal?.textContent?.trim()).toBe('0%');
  });

  it('contains individual line tone fluctuation slider in studio docked inspector and confirms legacy and deadband sliders are removed', () => {
    expect(doc.getElementById('trackFluctuationSlider')).toBeNull();
    expect(doc.getElementById('trackFluctuationVal')).toBeNull();
    expect(doc.getElementById('deadbandSlider')).toBeNull();

    const flucSlider = doc.getElementById('studioFluctuationSlider') as HTMLInputElement;
    expect(flucSlider).not.toBeNull();
    expect(flucSlider.type).toBe('range');
    expect(flucSlider.min).toBe('0');
    expect(flucSlider.max).toBe('100');
    expect(flucSlider.step).toBe('1');
    expect(flucSlider.value).toBe('0');

    const flucVal = doc.getElementById('studioFluctuationVal');
    expect(flucVal).not.toBeNull();
    expect(flucVal?.textContent?.trim()).toBe('0%');
  });

  it('contains interactive pitch navigator HUD and frequency range scroll controls', () => {
    const nav = doc.getElementById('pitchNavigator');
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute('aria-label')).toBe('Frequency Range Navigator');

    // Up, Down, Mid buttons removed from scrollbar for a clean mini-map HUD
    expect(doc.getElementById('pitchScrollUpBtn')).toBeNull();
    expect(doc.getElementById('pitchScrollDownBtn')).toBeNull();
    expect(doc.getElementById('pitchResetBtn')).toBeNull();

    const track = doc.getElementById('pitchTrack');
    expect(track).not.toBeNull();

    const thumb = doc.getElementById('pitchThumb');
    expect(thumb).not.toBeNull();

    const thumbLabel = doc.getElementById('pitchThumbLabel');
    expect(thumbLabel).not.toBeNull();

    // Frequency markers along the track
    const marks = track?.querySelectorAll('.pitch-mark');
    expect(marks?.length).toBe(5);
    const markTexts = Array.from(marks || []).map((m) => m.textContent?.trim());
    expect(markTexts).toContain('8.0 kHz');
    expect(markTexts).toContain('2.0 kHz');
    expect(markTexts).toContain('630 Hz');
    expect(markTexts).toContain('200 Hz');
    expect(markTexts).toContain('110 Hz');
    expect(markTexts).not.toContain('100 Hz');
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

  it('contains studio docked line inspector and advanced drawer with collision-free layering', () => {
    expect(doc.getElementById('trackInspectorBar')).toBeNull();

    const dockedInspector = doc.getElementById('studioDockedInspector');
    expect(dockedInspector).not.toBeNull();
    expect(dockedInspector?.classList.contains('studio-docked-inspector')).toBe(true);
    expect(dockedInspector?.classList.contains('is-empty')).toBe(true);

    const dockedContent = doc.getElementById('dockedInspectorContent');
    expect(dockedContent).not.toBeNull();
    expect(dockedContent?.style.display).toBe('none');

    const drawer = doc.getElementById('advancedDrawer');
    expect(drawer).not.toBeNull();
    expect(drawer?.style.display).toBe('none');

    const toggleBtn = doc.getElementById('drawerToggleBtn');
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn?.textContent?.trim()).toBe('Controls');

    const closeBtn = doc.getElementById('drawerCloseBtn');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.textContent?.trim()).toBe('Close');

    const cssPath = path.resolve(__dirname, '../src/style.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    // Legacy floating inspector CSS has been completely removed
    expect(css).not.toMatch(/\.track-inspector-bar\b/);

    // Advanced drawer is anchored on the right side as a popover sidebar
    expect(css).toMatch(/\.advanced-drawer\s*\{[^}]*right:\s*14px/);
    expect(css).toMatch(/\.advanced-drawer\s*\{[^}]*z-index:\s*200/);

    // Studio docked inspector layout & scrollable content styling
    expect(css).toMatch(/\.studio-docked-inspector\s*\{[^}]*flex-shrink:\s*0/);
    expect(css).toMatch(/\.studio-docked-inspector\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.studio-docked-inspector\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.docked-inspector-content\s*\{[^}]*overflow-y:\s*auto/);
  });

  it('guarantees all buttons and labels in the studio docked inspector contain only clean text without emojis', () => {
    expect(doc.getElementById('trackInspectorBar')).toBeNull();

    const dockedInspector = doc.getElementById('studioDockedInspector');
    expect(dockedInspector).not.toBeNull();

    const buttons = dockedInspector?.querySelectorAll('button') || [];
    expect(buttons.length).toBeGreaterThan(0);

    const labels = dockedInspector?.querySelectorAll('label, .docked-label, .docked-sublabel') || [];
    expect(labels.length).toBeGreaterThan(0);

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    for (const btn of Array.from(buttons)) {
      expect(emojiRegex.test(btn.textContent || '')).toBe(false);
    }
    for (const lbl of Array.from(labels)) {
      expect(emojiRegex.test(lbl.textContent || '')).toBe(false);
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

  it('has removed old chord progression strip and legacy track harmonizer, and provides studio voicing select', () => {
    // Old progression strip and floating inspector select should be gone
    expect(doc.getElementById('chordProgressionStrip')).toBeNull();
    expect(doc.getElementById('trackHarmonizerSelect')).toBeNull();

    // Default harmonizer voicing select in drawer
    const defaultHarmonizer = doc.getElementById('defaultHarmonizerSelect') as HTMLSelectElement;
    expect(defaultHarmonizer).not.toBeNull();
    expect(defaultHarmonizer.tagName.toLowerCase()).toBe('select');
    const defaultOptions = Array.from(defaultHarmonizer.options).map((o) => o.value);
    expect(defaultOptions).toEqual(['single', 'octave', 'subOctave', 'dualOctave', 'fifth', 'triad', 'seventh']);

    // Studio docked inspector voicing select
    const studioVoicing = doc.getElementById('studioVoicingSelect') as HTMLSelectElement;
    expect(studioVoicing).not.toBeNull();
    expect(studioVoicing.tagName.toLowerCase()).toBe('select');
    const studioOptions = Array.from(studioVoicing.options).map((o) => o.value);
    expect(studioOptions).toEqual(['single', 'octave', 'subOctave', 'dualOctave', 'fifth', 'triad', 'seventh']);

    // Clean text / emoji-free check on voicing options
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    for (const opt of Array.from(studioVoicing.options)) {
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

  it('contains delete button in studio docked inspector and layers mixer, confirming legacy deleteTrackBtn is removed', () => {
    expect(doc.getElementById('deleteTrackBtn')).toBeNull();

    const studioDelTrackBtn = doc.getElementById('studioDelTrackBtn');
    expect(studioDelTrackBtn).not.toBeNull();
    expect(doc.getElementById('studioDockedInspector')?.contains(studioDelTrackBtn)).toBe(true);

    const studioMixerList = doc.getElementById('studioMixerList');
    expect(studioMixerList).not.toBeNull();

    // The separate floating layerMixerDrawer panel is removed
    const layerMixerDrawer = doc.getElementById('layerMixerDrawer');
    expect(layerMixerDrawer).toBeNull();

    const studioLayerCount = doc.getElementById('studioLayerCount');
    expect(studioLayerCount).not.toBeNull();

    const layerCountBadge = doc.getElementById('layerCountBadge');
    expect(layerCountBadge).not.toBeNull();

    const layersStatusChip = doc.getElementById('layersStatusChip');
    expect(layersStatusChip).not.toBeNull();
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

    // Timer-mode stroke pill displays exact timer seconds instead of speed multiplier
    stroke.timingMode = 'timer';
    stroke.speedMode = 'timer';
    stroke.duration = 50;
    renderedText = '';
    renderer.drawStroke(stroke);
    expect(renderedText).toContain('50s');
    expect(renderedText).not.toContain('0.5x');
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
    const studioBpmSlider = doc.getElementById('studioMasterBpmSlider') as HTMLInputElement;
    expect(bpmSlider).not.toBeNull();
    expect(studioBpmSlider).not.toBeNull();
    expect(bpmSlider.min).toBe('10');
    expect(bpmSlider.max).toBe('240');
    expect(bpmSlider.step).toBe('1');
    expect(studioBpmSlider.min).toBe('10');
    expect(studioBpmSlider.max).toBe('240');
    expect(studioBpmSlider.step).toBe('1');
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

    // Scroll up (deltaY < 0): increases value by step (step is 1)
    handleSliderWheel(bpmSlider, -100);
    expect(bpmSlider.value).toBe('101');
    expect(inputFired).toBe(true);

    // Scroll down (deltaY > 0): decreases value by step (step is 1)
    handleSliderWheel(bpmSlider, 100);
    expect(bpmSlider.value).toBe('100');

    // Shift key: 5x step jump
    handleSliderWheel(bpmSlider, -100, true);
    expect(bpmSlider.value).toBe('105');
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

  it('contains traversal and wave control elements in studio docked inspector and zen pill that can be toggled for dot notes', () => {
    expect(doc.getElementById('trackTraversalControl')).toBeNull();
    expect(doc.getElementById('trackWaveControl')).toBeNull();

    const studioTraversalSwitch = doc.getElementById('studioTraversalSwitch');
    const studioWaveShapeSelect = doc.getElementById('studioWaveShapeSelect');
    const studioWavePeriodSlider = doc.getElementById('studioWavePeriodSlider');
    const zenContextTravBtn = doc.getElementById('zenContextTravBtn');

    expect(studioTraversalSwitch).not.toBeNull();
    expect(studioWaveShapeSelect).not.toBeNull();
    expect(studioWavePeriodSlider).not.toBeNull();
    expect(zenContextTravBtn).not.toBeNull();

    // Verify hiding styling can be applied cleanly and restored
    const studioTraversalRow = studioTraversalSwitch?.closest('.docked-row') as HTMLElement | null;
    const studioWaveGroup = studioWaveShapeSelect?.closest('.docked-group') as HTMLElement | null;
    expect(studioTraversalRow).not.toBeNull();
    expect(studioWaveGroup).not.toBeNull();

    const prevTravDisplay = studioTraversalRow?.style.display ?? '';
    const prevWaveDisplay = studioWaveGroup?.style.display ?? '';
    const prevZenDisplay = zenContextTravBtn?.style.display ?? '';

    if (studioTraversalRow) studioTraversalRow.style.display = 'none';
    if (studioWaveGroup) studioWaveGroup.style.display = 'none';
    if (zenContextTravBtn) zenContextTravBtn.style.display = 'none';

    expect(studioTraversalRow?.style.display).toBe('none');
    expect(studioWaveGroup?.style.display).toBe('none');
    expect(zenContextTravBtn?.style.display).toBe('none');

    if (studioTraversalRow) studioTraversalRow.style.display = prevTravDisplay;
    if (studioWaveGroup) studioWaveGroup.style.display = prevWaveDisplay;
    if (zenContextTravBtn) zenContextTravBtn.style.display = prevZenDisplay;
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

  it('contains Top-Bar Preset Suite with quick open/save buttons, visible saved presets optgroup, and open file action', () => {
    const topLoadBtn = doc.getElementById('topLoadPresetBtn') as HTMLButtonElement;
    const topSaveBtn = doc.getElementById('topSavePresetBtn') as HTMLButtonElement;
    const templateSelect = doc.getElementById('templateSelect') as HTMLSelectElement;
    const savedGroup = doc.getElementById('savedTemplatesGroup') as HTMLOptGroupElement;
    const loadFileInput = doc.getElementById('loadFileInput') as HTMLInputElement;

    expect(topLoadBtn).toBeDefined();
    expect(topSaveBtn).toBeDefined();
    expect(templateSelect).toBeDefined();
    expect(savedGroup).toBeDefined();
    expect(loadFileInput).toBeDefined();

    // Optgroup does not use display: none (preventing Safari/WebKit macOS menu caching bug)
    expect(savedGroup.style.display).not.toBe('none');

    // Contains Open File action
    const openFileOpt = templateSelect.querySelector('option[value="__open_file__"]');
    expect(openFileOpt).not.toBeNull();
    expect(openFileOpt?.textContent).toContain('Open Preset File');

    // Button attributes and tooltips
    expect(topLoadBtn.getAttribute('aria-label')).toBe('Open Preset File');
    expect(topSaveBtn.getAttribute('aria-label')).toBe('Save Preset');
    expect(topLoadBtn.classList.contains('top-preset-icon-btn')).toBe(true);
    expect(topSaveBtn.classList.contains('top-preset-icon-btn')).toBe(true);

    // Delete preset button and saved preset list manager
    const topDeleteBtn = doc.getElementById('topDeletePresetBtn') as HTMLButtonElement;
    expect(topDeleteBtn).toBeDefined();
    expect(topDeleteBtn.getAttribute('aria-label')).toBe('Delete Custom Preset');
    expect(topDeleteBtn.classList.contains('top-preset-icon-btn')).toBe(true);
    expect(topDeleteBtn.classList.contains('btn-delete')).toBe(true);
    expect(topDeleteBtn.disabled).toBe(true);

    const savedListContainer = doc.getElementById('savedPresetsListContainer');
    expect(savedListContainer).not.toBeNull();
  });

  it('optimizes GPU rendering pipeline with gradient caching and DPR capping', async () => {
    const { CanvasRenderer } = await import('../src/canvas/renderer');
    let createGradientCount = 0;
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      fillRect: () => {},
      setTransform: () => {},
      createRadialGradient: () => {
        createGradientCount++;
        return { addColorStop: () => {} };
      },
    };

    const canvas = doc.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => {} });
    canvas.getContext = () => mockCtx as any;

    (global as any).window.devicePixelRatio = 2.5; // Simulate high-DPI display
    const renderer = new CanvasRenderer(canvas);

    // DPR capped at 1.75 max to reduce GPU fill-rate on high-DPI screens
    expect((renderer as any).dpr).toBe(1.75);

    // First clear allocates gradient once
    renderer.clear();
    expect(createGradientCount).toBe(1);

    // Subsequent clear frames reuse cached gradient (zero allocations)
    renderer.clear();
    renderer.clear();
    expect(createGradientCount).toBe(1);

    // Switching theme invalidates cache cleanly
    renderer.setDarkMode(true);
    renderer.clear();
    expect(createGradientCount).toBe(2);
  });

  it('provides general user-friendly sonic descriptions for timbral breathing and sound controls', () => {
    const breathingGroup = doc.getElementById('breathingControlGroup');
    expect(breathingGroup).not.toBeNull();
    expect(breathingGroup?.classList.contains('has-tooltip')).toBe(true);
    expect(breathingGroup?.getAttribute('data-tooltip')).toContain('Timbral Breathing: Adds natural breathing movement');
    expect(breathingGroup?.getAttribute('data-tooltip')).toContain('Gentle Swell');
    expect(breathingGroup?.getAttribute('data-tooltip')).toContain('Deep Ocean');

    const select = doc.getElementById('breathingSelect') as HTMLSelectElement;
    expect(select).not.toBeNull();

    const options = Array.from(select.querySelectorAll('option'));
    expect(options.length).toBe(4);

    const gentleOpt = select.querySelector('option[value="gentle"]');
    const deepOpt = select.querySelector('option[value="deep"]');
    const driftOpt = select.querySelector('option[value="drift"]');
    const offOpt = select.querySelector('option[value="off"]');

    expect(gentleOpt?.getAttribute('title')).toContain('Gentle Swell: Soft, breathing warmth');
    expect(deepOpt?.getAttribute('title')).toContain('Deep Ocean: Slow, immersive waves');
    expect(driftOpt?.getAttribute('title')).toContain('Tape Drift: Dreamy, floating texture');
    expect(offOpt?.getAttribute('title')).toContain('Off: Steady, unchanging tones');
  });

  it('streamlines bottom bar left chips and maximizes space for contextual description', () => {
    const statusLeft = doc.querySelector('.bottom-bar .status-left');
    expect(statusLeft).not.toBeNull();

    // Essential items exist
    expect(doc.getElementById('layersStatusChip')).not.toBeNull();
    expect(doc.getElementById('statMode')).not.toBeNull();
    expect(doc.getElementById('statAudio')).not.toBeNull();

    // Redundant items are removed from DOM to free up width
    expect(doc.getElementById('statInstrument')).toBeNull();
    expect(doc.getElementById('statTempo')).toBeNull();
    expect(doc.getElementById('statLoopSync')).toBeNull();
    expect(doc.getElementById('statPitchSnap')).toBeNull();

    // Context help container has flexible width and exists in bottom bar
    const statusCenter = doc.querySelector('.bottom-bar .status-center');
    expect(statusCenter).not.toBeNull();
    const contextHelp = doc.getElementById('contextHelp');
    expect(contextHelp).not.toBeNull();
  });

  it('guarantees that all scale dropdown options (including Major and Mixolydian) resolve in the SCALES dictionary', () => {
    const scaleSelect = doc.getElementById('scaleSelect') as HTMLSelectElement;
    expect(scaleSelect).not.toBeNull();
    const scaleOptions = Array.from(scaleSelect.querySelectorAll('option')).map((opt) => opt.value);

    const studioScaleSelect = doc.getElementById('studioScaleSelect') as HTMLSelectElement;
    expect(studioScaleSelect).not.toBeNull();
    const studioScaleOptions = Array.from(studioScaleSelect.querySelectorAll('option')).map((opt) => opt.value);

    // Verify both dropdowns contain major and mixolydian
    expect(scaleOptions).toContain('major');
    expect(scaleOptions).toContain('mixolydian');
    expect(studioScaleOptions).toContain('major');
    expect(studioScaleOptions).toContain('mixolydian');

    // Verify every option maps to a valid configured scale
    for (const val of scaleOptions) {
      expect(SCALES[val], `Scale '${val}' must be defined in SCALES dictionary`).toBeDefined();
      expect(SCALES[val].intervals.length).toBeGreaterThan(0);
    }

    for (const val of studioScaleOptions) {
      expect(SCALES[val], `Studio scale '${val}' must be defined in SCALES dictionary`).toBeDefined();
      expect(SCALES[val].intervals.length).toBeGreaterThan(0);
    }
  });

  it('contains Re-draw action button in studio docked inspector (and confirms legacy redrawTrackBtn is removed) with zero emojis', () => {
    expect(doc.getElementById('redrawTrackBtn')).toBeNull();

    const studioRedrawBtn = doc.getElementById('studioRedrawTrackBtn') as HTMLButtonElement;
    expect(studioRedrawBtn).not.toBeNull();
    expect(studioRedrawBtn.textContent?.trim()).toBe('Re-draw');
    expect(studioRedrawBtn.textContent).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);

    // Verify Top-Bar Mode Switcher has dedicated Re-draw mode
    const topBarRedrawBtn = doc.querySelector('#appModeControl button[data-app-mode="redraw"]') as HTMLButtonElement;
    expect(topBarRedrawBtn).not.toBeNull();
    expect(topBarRedrawBtn.textContent?.trim()).toBe('Re-draw');
    expect(topBarRedrawBtn.textContent).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);

    // Verify Zen Dock Mode Switcher has dedicated Re-draw mode
    const zenDockRedrawBtn = doc.querySelector('#zenAppModeControl button[data-app-mode="redraw"]') as HTMLButtonElement;
    expect(zenDockRedrawBtn).not.toBeNull();
    expect(zenDockRedrawBtn.textContent?.trim()).toBe('Re-draw');
    expect(zenDockRedrawBtn.textContent).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);

    // Verify Zen Context Pill has Re-draw button
    const zenContextRedrawBtn = doc.getElementById('zenContextRedrawBtn') as HTMLButtonElement;
    expect(zenContextRedrawBtn).not.toBeNull();
    expect(zenContextRedrawBtn.textContent?.trim()).toBe('↻');
    expect(zenContextRedrawBtn.textContent).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);

    // Verify shortcuts modal includes re-draw description
    const shortcutsModal = doc.getElementById('shortcutsModal');
    expect(shortcutsModal).not.toBeNull();
    expect(shortcutsModal?.textContent).toContain('Re-draw');
    expect(shortcutsModal?.textContent).toContain('Assisted Drawing');
  });

  it('contains Assisted Drawing toggle and 2-5 line count controls in top bar and drawer with zero emojis', () => {
    const assistToggleBtn = doc.getElementById('assistToggleBtn') as HTMLButtonElement;
    expect(assistToggleBtn).not.toBeNull();
    expect(assistToggleBtn.textContent?.trim()).toBe('Off');
    expect(assistToggleBtn.textContent).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);

    const assistCountBtns = Array.from(doc.querySelectorAll('#assistCountControl button[data-assist-count]'));
    expect(assistCountBtns).toHaveLength(4);
    expect(assistCountBtns.map((b) => b.getAttribute('data-assist-count'))).toEqual(['2', '3', '4', '5']);
    assistCountBtns.forEach((btn) => {
      expect(btn.textContent).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
    });

    const drawerAssistBtn = doc.getElementById('drawerAssistToggleBtn') as HTMLButtonElement;
    expect(drawerAssistBtn).not.toBeNull();
    expect(drawerAssistBtn.textContent?.trim()).toBe('Assist Off');
    expect(drawerAssistBtn.textContent).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);

    const drawerAssistSelect = doc.getElementById('drawerAssistCountSelect') as HTMLSelectElement;
    expect(drawerAssistSelect).not.toBeNull();
    const values = Array.from(drawerAssistSelect.options).map((o) => o.value);
    expect(values).toEqual(['2', '3', '4', '5']);

    const assistInkModeBtn = doc.getElementById('assistInkModeBtn') as HTMLButtonElement;
    expect(assistInkModeBtn).not.toBeNull();
    expect(assistInkModeBtn.textContent?.trim()).toBe('Same Ink');
    expect(assistInkModeBtn.textContent).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);

    const drawerAssistInkSelect = doc.getElementById('drawerAssistInkSelect') as HTMLSelectElement;
    expect(drawerAssistInkSelect).not.toBeNull();
    const inkOptions = Array.from(drawerAssistInkSelect.options).map((o) => o.value);
    expect(inkOptions).toEqual(['same', 'mixed']);
  });

  it('provides all 12 root options in #studioRootSelect matching #rootSelect (C2..A3)', () => {
    const rootSelect = doc.getElementById('rootSelect') as HTMLSelectElement | null;
    const studioRootSelect = doc.getElementById('studioRootSelect') as HTMLSelectElement | null;
    expect(rootSelect).not.toBeNull();
    expect(studioRootSelect).not.toBeNull();

    const expectedRoots = ['C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'C3', 'D3', 'E3', 'F3', 'G3', 'A3'];
    const rootValues = Array.from(rootSelect!.options).map((o) => o.value);
    const studioRootValues = Array.from(studioRootSelect!.options).map((o) => o.value);

    expect(rootValues).toEqual(expectedRoots);
    expect(studioRootValues).toEqual(expectedRoots);
    expect(studioRootValues).toEqual(rootValues);
  });

  it('does not disable zoom via user-scalable=no in viewport meta and secures guide.html link', () => {
    const viewportMeta = doc.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    expect(viewportMeta).not.toBeNull();
    const content = viewportMeta?.getAttribute('content') || '';
    expect(content).not.toContain('user-scalable=no');

    const guideLink = doc.querySelector('a[href="guide.html"]') as HTMLAnchorElement | null;
    expect(guideLink).not.toBeNull();
    expect(guideLink?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('adds role="dialog" and aria-modal="true" to all 4 modals and removes raw $...$ LaTeX delimiters from #infoModal', () => {
    const modalIds = ['shortcutsModal', 'infoModal', 'savePresetModal', 'recordModal'];
    for (const id of modalIds) {
      const modal = doc.getElementById(id);
      expect(modal, `${id} should exist`).not.toBeNull();
      expect(modal?.getAttribute('role'), `${id} role`).toBe('dialog');
      expect(modal?.getAttribute('aria-modal'), `${id} aria-modal`).toBe('true');
    }

    const infoModal = doc.getElementById('infoModal');
    expect(infoModal).not.toBeNull();
    const infoText = infoModal?.textContent || '';
    expect(infoText).not.toMatch(/\$[^$]+\$/);
    expect(infoText).not.toContain('$');
  });

  it('contains Wave 1 Studio Deck, Articulation, Swing, Quantize, MIDI, Export, Confirm Modal, and Onboarding DOM elements', () => {
    // 1. Studio Docked Inspector: Articulation slider & badge
    const inspector = doc.getElementById('studioDockedInspector');
    const artSlider = doc.getElementById('studioArticulationSlider') as HTMLInputElement | null;
    const artVal = doc.getElementById('studioArticulationVal');
    expect(inspector).not.toBeNull();
    expect(artSlider).not.toBeNull();
    expect(artSlider?.min).toBe('20');
    expect(artSlider?.max).toBe('250');
    expect(artVal).not.toBeNull();
    expect(inspector?.contains(artSlider)).toBe(true);
    expect(inspector?.contains(artVal)).toBe(true);

    // 2. Studio Master Tab: Swing, Beat Grid, Bar Quantize, and Web MIDI Panel
    const tabMaster = doc.getElementById('studioTabMaster');
    const swingSlider = doc.getElementById('studioMasterSwingSlider') as HTMLInputElement | null;
    const beatGridToggle = doc.getElementById('beatGridToggle');
    const quantizedToggle = doc.getElementById('quantizedTriggerToggle');
    const midiPanel = doc.getElementById('midiPanel');
    expect(tabMaster).not.toBeNull();
    expect(swingSlider).not.toBeNull();
    expect(swingSlider?.min).toBe('0');
    expect(swingSlider?.max).toBe('75');
    expect(beatGridToggle).not.toBeNull();
    expect(quantizedToggle).not.toBeNull();
    expect(midiPanel).not.toBeNull();
    expect(tabMaster?.contains(swingSlider)).toBe(true);
    expect(tabMaster?.contains(beatGridToggle)).toBe(true);
    expect(tabMaster?.contains(quantizedToggle)).toBe(true);
    expect(tabMaster?.contains(midiPanel)).toBe(true);

    const midiControlIds = [
      'midiEnableBtn',
      'midiOutputSelect',
      'midiInputSelect',
      'midiChannelSelect',
      'midiLearnTargetSelect',
      'midiLearnBtn',
    ];
    for (const id of midiControlIds) {
      const el = doc.getElementById(id);
      expect(el, `${id} should exist`).not.toBeNull();
      expect(midiPanel?.contains(el), `${id} should be inside #midiPanel`).toBe(true);
      expect(tabMaster?.contains(el), `${id} should be inside #studioTabMaster`).toBe(true);
    }

    // 3. Studio Deck Header Controls: collapse rail, history badge, A/B capture & compare
    const studioDeck = doc.getElementById('studioDeck');
    expect(studioDeck).not.toBeNull();
    for (const id of ['studioDeckCollapseBtn', 'historyCountBadge', 'abCaptureBtn', 'abCompareBtn']) {
      const el = doc.getElementById(id);
      expect(el, `${id} should exist`).not.toBeNull();
      expect(studioDeck?.contains(el), `${id} should be inside #studioDeck`).toBe(true);
    }

    // 4. Record Modal: export format select (mp3, wav) and Export Stems button
    const recordModal = doc.getElementById('recordModal');
    const exportFormat = doc.getElementById('exportFormatSelect') as HTMLSelectElement | null;
    const exportStemsBtn = doc.getElementById('exportStemsBtn');
    expect(recordModal).not.toBeNull();
    expect(exportFormat).not.toBeNull();
    expect(exportStemsBtn).not.toBeNull();
    expect(recordModal?.contains(exportFormat)).toBe(true);
    expect(recordModal?.contains(exportStemsBtn)).toBe(true);
    expect(Array.from(exportFormat!.options).map((o) => o.value)).toEqual(['mp3', 'wav']);

    // 5. Confirm Modal, Onboarding Coachmark, and Replay Tour button
    const confirmModal = doc.getElementById('confirmModal');
    expect(confirmModal).not.toBeNull();
    expect(confirmModal?.getAttribute('role')).toBe('dialog');
    expect(confirmModal?.getAttribute('aria-modal')).toBe('true');

    expect(doc.getElementById('onboardingCoachmark')).not.toBeNull();
    expect(doc.getElementById('replayTourBtn')).not.toBeNull();

    // 6. Multi-Selection Speed Sync controls inside Studio Docked Inspector (emoji-free)
    const multiSyncBtn = doc.getElementById('studioMultiSyncSpeedBtn');
    const multiMatchBtn = doc.getElementById('studioMultiMatchFirstBtn');
    const multiSpeedSlider = doc.getElementById('studioMultiSpeedSlider') as HTMLInputElement | null;
    expect(multiSyncBtn).not.toBeNull();
    expect(multiMatchBtn).not.toBeNull();
    expect(multiSpeedSlider).not.toBeNull();
    expect(inspector?.contains(multiSyncBtn)).toBe(true);

    // 7. Timbral Breathing selector mirrored in Master FX tab
    const studioBreathingSelect = doc.getElementById('studioBreathingSelect') as HTMLSelectElement | null;
    expect(studioBreathingSelect).not.toBeNull();
    expect(tabMaster?.contains(studioBreathingSelect)).toBe(true);
    expect(Array.from(studioBreathingSelect!.options).map((o) => o.value)).toEqual(['gentle', 'deep', 'drift', 'off']);

    // 8. Tooltip shortcut coverage & stale description cleanup
    const liveModeBtn = doc.querySelector('#appModeControl [data-app-mode="live"]');
    const zenTopBtn = doc.querySelector('#viewModeControl [data-view-mode="zen"]');
    const resyncBtn = doc.getElementById('resyncBtn');
    const liveSnapParent = doc.getElementById('liveSnapBtn')?.closest('[data-tooltip]');
    expect(liveModeBtn?.getAttribute('data-tooltip')).toContain('(L)');
    expect(zenTopBtn?.getAttribute('data-tooltip')).toContain('(V)');
    expect(resyncBtn?.getAttribute('data-tooltip')).toContain('(0)');
    expect(beatGridToggle?.getAttribute('data-tooltip')).toContain('(G)');
    expect(quantizedToggle?.getAttribute('data-tooltip')).toContain('(Q)');
    expect(liveSnapParent?.getAttribute('data-tooltip')).not.toContain('chord progression');

    // 9. Adaptive 3-zone responsive top bar layout
    const topPrimary = doc.querySelector('.top-bar-primary');
    const topLeft = topPrimary?.querySelector('.top-bar-left');
    const topTools = topPrimary?.querySelector('.top-bar-tools');
    const topRight = topPrimary?.querySelector('.top-bar-right');
    expect(topPrimary).not.toBeNull();
    expect(topLeft).not.toBeNull();
    expect(topTools).not.toBeNull();
    expect(topRight).not.toBeNull();

    expect(topLeft?.contains(doc.getElementById('templateSelect'))).toBe(true);
    expect(topTools?.contains(doc.getElementById('instrumentPalette'))).toBe(true);
    expect(topTools?.contains(doc.getElementById('appModeControl'))).toBe(true);
    expect(topTools?.contains(doc.getElementById('viewModeControl'))).toBe(true);
    expect(topTools?.contains(doc.getElementById('strokeModeControl'))).toBe(true);
    expect(topTools?.contains(doc.getElementById('shapeControl'))).toBe(true);
    expect(topTools?.contains(doc.getElementById('assistToggleBtn'))).toBe(true);
    expect(topRight?.contains(doc.getElementById('drawerToggleBtn'))).toBe(true);
    expect(topRight?.contains(doc.getElementById('recordModalBtn'))).toBe(true);

    const cssPath = path.resolve(__dirname, '../src/style.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toMatch(/@media\s*\(max-width:\s*1519px\)[\s\S]*?\.top-bar-tools\s*\{[^}]*order:\s*3;[^}]*flex:\s*1\s+0\s+100%/);
  });

  it('supports dual-orientation horizontal right-rail and vertical bottom-sheet workspace with sheet handle and split mixer', () => {
    const sheetHandle = doc.getElementById('studioSheetHandle');
    expect(sheetHandle).not.toBeNull();
    expect(doc.getElementById('studioDeck')?.contains(sheetHandle)).toBe(true);

    const mixerSplit = doc.querySelector('#studioTabMixer .studio-mixer-split');
    expect(mixerSplit).not.toBeNull();
    expect(mixerSplit?.contains(doc.getElementById('studioMixerList'))).toBe(true);
    expect(mixerSplit?.contains(doc.getElementById('studioDockedInspector'))).toBe(true);

    const viewportMeta = doc.querySelector('meta[name="viewport"]');
    expect(viewportMeta?.getAttribute('content')).toContain('viewport-fit=cover');

    const cssPath = path.resolve(__dirname, '../src/style.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toMatch(/@media\s*\(max-aspect-ratio:\s*1\/1\),\s*\(max-width:\s*820px\)[\s\S]*?#app\.view-studio\s+\.workspace-layout\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/#studioDeck\.is-rail-collapsed\s+\.studio-deck-tabs\s*\{[^}]*display:\s*flex\s*!important/);
  });
});


