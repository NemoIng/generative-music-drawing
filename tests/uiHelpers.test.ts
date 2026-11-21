import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  STORAGE_KEYS,
  readStorageKey,
  writeStorageKey,
  removeStorageKey,
  loadSavedPresets,
  savePresetsList,
  savePreset,
} from '../src/ui/storage';
import { showToast, clearToastTimer } from '../src/ui/toast';
import {
  encodeCompositionBase64Url,
  decodeCompositionBase64Url,
  createShareUrl,
} from '../src/ui/shareService';
import { bindSliderUndo } from '../src/ui/sliderUndo';
import { createKeydownHandler, type ShortcutHandlers } from '../src/ui/shortcuts';
import type { SavedComposition } from '../src/engine/types';

function makeComp(name: string, timestamp = 1700000000000): SavedComposition {
  return {
    version: 1,
    name,
    timestamp,
    bpm: 120,
    strokes: [
      {
        id: 'stroke-1',
        instrumentId: 'indigo',
        style: 'solid',
        path: {
          isClosed: false,
          segments: [
            {
              p0: { x: 10, y: 200 },
              p1: { x: 50, y: 200 },
              p2: { x: 90, y: 200 },
              p3: { x: 130, y: 200 },
            },
          ],
        },
      },
    ],
  };
}

describe('UI Helpers: storage, toast, shareService, sliderUndo, shortcuts', () => {
  let dom: JSDOM;
  let savedFetch: typeof globalThis.fetch;

  beforeEach(() => {
    savedFetch = globalThis.fetch;
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://generative-music-drawing.vercel.app/',
    });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('localStorage', dom.window.localStorage);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('KeyboardEvent', dom.window.KeyboardEvent);
  });

  afterEach(() => {
    clearToastTimer();
    vi.useRealTimers();
    globalThis.fetch = savedFetch;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dom.window.close();
  });

  describe('storage.ts', () => {
    it('falls back safely when localStorage throws QuotaExceededError or SecurityError', () => {
      const throwingStorage = {
        getItem: vi.fn(() => {
          throw new DOMException('Blocked', 'SecurityError');
        }),
        setItem: vi.fn(() => {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }),
        removeItem: vi.fn(() => {
          throw new DOMException('Blocked', 'SecurityError');
        }),
      };
      vi.stubGlobal('localStorage', throwingStorage);

      expect(readStorageKey(STORAGE_KEYS.PRESETS)).toBeNull();
      expect(writeStorageKey(STORAGE_KEYS.PRESETS, '[]')).toBe(false);
      expect(removeStorageKey(STORAGE_KEYS.PRESETS)).toBe(false);
      expect(loadSavedPresets()).toEqual([]);
      expect(savePresetsList([makeComp('A')])).toBe(false);
      expect(savePreset(makeComp('B'))).toBe(false);
    });

    it('migrates and deduplicates legacy harmonic_saved_grooves into harmonic_saved_presets', () => {
      const primaryComp = makeComp('Shared Song', 1000);
      const duplicateLegacy = makeComp('Shared Song', 1000);
      const uniqueLegacy = makeComp('Legacy Groove', 2000);

      dom.window.localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify([primaryComp]));
      dom.window.localStorage.setItem(
        STORAGE_KEYS.LEGACY_GROOVES,
        JSON.stringify([duplicateLegacy, uniqueLegacy])
      );

      const loaded = loadSavedPresets();
      expect(loaded).toHaveLength(2);
      expect(loaded.map((c) => c.name)).toEqual(['Shared Song', 'Legacy Groove']);

      // Legacy key removed after migration
      expect(dom.window.localStorage.getItem(STORAGE_KEYS.LEGACY_GROOVES)).toBeNull();
      const persisted = JSON.parse(
        dom.window.localStorage.getItem(STORAGE_KEYS.PRESETS) ?? '[]'
      ) as SavedComposition[];
      expect(persisted).toHaveLength(2);
    });

    it('writes only harmonic_saved_presets and never harmonic_saved_grooves when saving', () => {
      const setItemSpy = vi.spyOn(dom.window.Storage.prototype, 'setItem');

      const comp = makeComp('New Composition', 3000);
      expect(savePreset(comp)).toBe(true);
      expect(savePresetsList([comp])).toBe(true);

      const writtenKeys = setItemSpy.mock.calls.map(([key]) => key);
      expect(writtenKeys.every((k) => k === STORAGE_KEYS.PRESETS)).toBe(true);
      expect(writtenKeys).not.toContain(STORAGE_KEYS.LEGACY_GROOVES);
      expect(dom.window.localStorage.getItem(STORAGE_KEYS.LEGACY_GROOVES)).toBeNull();
    });
  });

  describe('toast.ts', () => {
    it('shows visible class, cancels earlier hide timer on rapid calls, and toggles toast-error', () => {
      vi.useFakeTimers();

      showToast('First notice', 'info', 2000);
      const toastEl = dom.window.document.getElementById('appToast')!;
      expect(toastEl).not.toBeNull();
      expect(toastEl.classList.contains('is-visible')).toBe(true);
      expect(toastEl.classList.contains('toast-error')).toBe(false);
      expect(toastEl.textContent).toBe('First notice');

      // Advance 1500ms, then trigger second toast before first timer expires
      vi.advanceTimersByTime(1500);
      showToast('Second error', 'error', 2000);
      expect(toastEl.classList.contains('is-visible')).toBe(true);
      expect(toastEl.classList.contains('toast-error')).toBe(true);
      expect(toastEl.getAttribute('role')).toBe('alert');
      expect(toastEl.textContent).toBe('Second error');

      // Advance past first timer's original 2000ms mark (1500 + 1000 = 2500ms): must remain visible
      vi.advanceTimersByTime(1000);
      expect(toastEl.classList.contains('is-visible')).toBe(true);

      // Advance remaining 1000ms of second timer: now hidden
      vi.advanceTimersByTime(1000);
      expect(toastEl.classList.contains('is-visible')).toBe(false);

      // Subsequent 'info' removes toast-error
      showToast('Back to info', 'info', 1000);
      expect(toastEl.classList.contains('toast-error')).toBe(false);
      expect(toastEl.classList.contains('is-visible')).toBe(true);
      expect(toastEl.getAttribute('role')).toBe('status');
    });
  });

  describe('shareService.ts', () => {
    it('roundtrips UTF-8 compositions including emoji and accented characters', () => {
      const comp = makeComp('Café Nocturne 🎵🎹 — Étoile 日本語', 4242);
      const encoded = encodeCompositionBase64Url(comp);

      expect(encoded).not.toMatch(/[+/=]/);
      const decoded = decodeCompositionBase64Url(encoded);
      expect(decoded).toEqual(comp);
    });

    it('still decodes legacy standard base64, percent-encoded, and unescape/latin1 formats', () => {
      const utf8Comp = makeComp('Été Mélodie 🎶', 555);
      const utf8Bytes = new TextEncoder().encode(JSON.stringify(utf8Comp));
      let utf8Binary = '';
      for (const b of utf8Bytes) {
        utf8Binary += String.fromCharCode(b);
      }
      const standardBase64 = btoa(utf8Binary);
      expect(decodeCompositionBase64Url(standardBase64)).toEqual(utf8Comp);

      const pctWrapped = encodeURIComponent(standardBase64);
      expect(decodeCompositionBase64Url(pctWrapped)).toEqual(utf8Comp);

      // Raw single-byte latin1 JSON (e.g. legacy non-UTF-8 btoa output with 'é' = 0xE9)
      const latin1Comp = makeComp('Café', 777);
      const rawLatin1Base64 = btoa(JSON.stringify(latin1Comp));
      expect(decodeCompositionBase64Url(rawLatin1Base64)).toEqual(latin1Comp);
    });

    it('createShareUrl uses /api/track ID on success and falls back to #score= when fetch fails', async () => {
      const comp = makeComp('Shared Track 🎼', 9001);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'TrAcK999' }),
      }) as unknown as typeof globalThis.fetch;

      const apiResult = await createShareUrl(comp);
      expect(apiResult).toEqual({
        url: 'https://generative-music-drawing.vercel.app/?track=TrAcK999',
        viaApi: true,
      });

      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error('Network down')) as unknown as typeof globalThis.fetch;

      const fallbackResult = await createShareUrl(comp);
      expect(fallbackResult.viaApi).toBe(false);
      expect(fallbackResult.url.startsWith('https://generative-music-drawing.vercel.app/#score=')).toBe(
        true
      );
      const hashToken = fallbackResult.url.split('#score=')[1];
      expect(decodeCompositionBase64Url(hashToken)).toEqual(comp);
    });
  });

  describe('sliderUndo.ts', () => {
    it('fires onInput for every input event, fires onCommit once on change with initial and final values, and cleans up', () => {
      const slider = dom.window.document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = '20';

      let modelValue = 20;
      const captureInitial = vi.fn(() => modelValue);
      const onInput = vi.fn((val: number) => {
        modelValue = val;
      });
      const onCommit = vi.fn();

      const cleanup = bindSliderUndo(slider, { captureInitial, onInput, onCommit });

      slider.dispatchEvent(new dom.window.Event('pointerdown'));

      for (let i = 1; i <= 10; i++) {
        slider.value = String(20 + i * 5);
        slider.dispatchEvent(new dom.window.Event('input'));
      }
      slider.dispatchEvent(new dom.window.Event('change'));

      expect(onInput).toHaveBeenCalledTimes(10);
      expect(onInput).toHaveBeenLastCalledWith(70);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(20, 70);

      cleanup();

      slider.dispatchEvent(new dom.window.Event('pointerdown'));
      slider.value = '95';
      slider.dispatchEvent(new dom.window.Event('input'));
      slider.dispatchEvent(new dom.window.Event('change'));

      expect(onInput).toHaveBeenCalledTimes(10);
      expect(onCommit).toHaveBeenCalledTimes(1);
    });
  });

  describe('shortcuts.ts', () => {
    function createSpies(): ShortcutHandlers {
      return {
        onEscape: vi.fn(() => true),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onSave: vi.fn(),
        onSelectAll: vi.fn(),
        onCopy: vi.fn(() => true),
        onPaste: vi.fn(() => true),
        onDuplicate: vi.fn(() => true),
        onRandomizePlayheads: vi.fn(),
        onPlayPause: vi.fn(),
        onDrawMode: vi.fn(),
        onRedrawOrResync: vi.fn(),
        onResyncPlayheads: vi.fn(),
        onToggleLiveMode: vi.fn(),
        onToggleFullscreen: vi.fn(),
        onToggleBeatGrid: vi.fn(),
        onToggleBarQuantize: vi.fn(),
        onMuteOrMixer: vi.fn(),
        onSolo: vi.fn(),
        onCycleViewMode: vi.fn(),
        onSelectInstrumentIndex: vi.fn(),
      };
    }

    function dispatch(
      handler: (e: KeyboardEvent) => void,
      init: KeyboardEventInit,
      target: EventTarget = dom.window.document.body
    ): KeyboardEvent {
      const event = new dom.window.KeyboardEvent('keydown', { cancelable: true, ...init });
      Object.defineProperty(event, 'target', { value: target, configurable: true });
      handler(event);
      return event;
    }

    it('never intercepts browser shortcuts Cmd/Ctrl + R, F, P, L, 1', () => {
      const handlers = createSpies();
      const onKeydown = createKeydownHandler(handlers);

      for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
        for (const key of ['r', 'f', 'p', 'l', '1']) {
          const ev = dispatch(onKeydown, { key, ...mod });
          expect(ev.defaultPrevented).toBe(false);
        }
      }

      expect(handlers.onRedrawOrResync).not.toHaveBeenCalled();
      expect(handlers.onToggleFullscreen).not.toHaveBeenCalled();
      expect(handlers.onPlayPause).not.toHaveBeenCalled();
      expect(handlers.onToggleLiveMode).not.toHaveBeenCalled();
      expect(handlers.onSelectInstrumentIndex).not.toHaveBeenCalled();
    });

    it('fires unmodified single-key shortcuts P, R, L, F, M, S, V, 1-7, and Space', () => {
      const handlers = createSpies();
      const onKeydown = createKeydownHandler(handlers);

      dispatch(onKeydown, { key: 'p' });
      dispatch(onKeydown, { key: ' ', code: 'Space' });
      expect(handlers.onPlayPause).toHaveBeenCalledTimes(2);

      dispatch(onKeydown, { key: 'r' });
      expect(handlers.onRedrawOrResync).toHaveBeenCalledTimes(1);

      dispatch(onKeydown, { key: 'l' });
      expect(handlers.onToggleLiveMode).toHaveBeenCalledTimes(1);

      dispatch(onKeydown, { key: 'f' });
      expect(handlers.onToggleFullscreen).toHaveBeenCalledTimes(1);

      dispatch(onKeydown, { key: 'm' });
      expect(handlers.onMuteOrMixer).toHaveBeenCalledTimes(1);

      dispatch(onKeydown, { key: 's' });
      expect(handlers.onSolo).toHaveBeenCalledTimes(1);

      dispatch(onKeydown, { key: 'v' });
      expect(handlers.onCycleViewMode).toHaveBeenCalledTimes(1);

      for (let digit = 1; digit <= 7; digit++) {
        dispatch(onKeydown, { key: String(digit) });
        expect(handlers.onSelectInstrumentIndex).toHaveBeenLastCalledWith(digit - 1);
      }
      expect(handlers.onSelectInstrumentIndex).toHaveBeenCalledTimes(7);

      dispatch(onKeydown, { key: 'd' });
      expect(handlers.onDrawMode).toHaveBeenCalledTimes(1);

      dispatch(onKeydown, { key: '0' });
      expect(handlers.onResyncPlayheads).toHaveBeenCalledTimes(1);

      dispatch(onKeydown, { key: 'g' });
      expect(handlers.onToggleBeatGrid).toHaveBeenCalledTimes(1);

      dispatch(onKeydown, { key: 'q' });
      expect(handlers.onToggleBarQuantize).toHaveBeenCalledTimes(1);

      // Cmd+D triggers onDuplicate and NOT onDrawMode
      dispatch(onKeydown, { key: 'd', metaKey: true });
      expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);
      expect(handlers.onDrawMode).toHaveBeenCalledTimes(1);
    });

    it('fires Shift+R for randomize and Cmd/Ctrl+S once for save without triggering solo', () => {
      const handlers = createSpies();
      const onKeydown = createKeydownHandler(handlers);

      dispatch(onKeydown, { key: 'R', shiftKey: true });
      expect(handlers.onRandomizePlayheads).toHaveBeenCalledTimes(1);
      expect(handlers.onRedrawOrResync).not.toHaveBeenCalled();

      const cmdSave = dispatch(onKeydown, { key: 's', metaKey: true });
      expect(cmdSave.defaultPrevented).toBe(true);
      expect(handlers.onSave).toHaveBeenCalledTimes(1);
      expect(handlers.onSolo).not.toHaveBeenCalled();

      const ctrlSave = dispatch(onKeydown, { key: 's', ctrlKey: true });
      expect(ctrlSave.defaultPrevented).toBe(true);
      expect(handlers.onSave).toHaveBeenCalledTimes(2);
      expect(handlers.onSolo).not.toHaveBeenCalled();
    });

    it('fires Escape inside <input> while ignoring all non-Escape keys', () => {
      const handlers = createSpies();
      const onKeydown = createKeydownHandler(handlers);
      const inputEl = dom.window.document.createElement('input');

      const escEvent = dispatch(onKeydown, { key: 'Escape' }, inputEl);
      expect(escEvent.defaultPrevented).toBe(true);
      expect(handlers.onEscape).toHaveBeenCalledTimes(1);

      dispatch(onKeydown, { key: 'p' }, inputEl);
      dispatch(onKeydown, { key: ' ', code: 'Space' }, inputEl);
      dispatch(onKeydown, { key: 'r' }, inputEl);
      dispatch(onKeydown, { key: 'R', shiftKey: true }, inputEl);
      dispatch(onKeydown, { key: '1' }, inputEl);
      dispatch(onKeydown, { key: 's', metaKey: true }, inputEl);

      expect(handlers.onPlayPause).not.toHaveBeenCalled();
      expect(handlers.onRedrawOrResync).not.toHaveBeenCalled();
      expect(handlers.onRandomizePlayheads).not.toHaveBeenCalled();
      expect(handlers.onSelectInstrumentIndex).not.toHaveBeenCalled();
      expect(handlers.onSave).not.toHaveBeenCalled();
    });
  });
});
