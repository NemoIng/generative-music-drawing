export interface ShortcutHandlers {
  onEscape?: (e: KeyboardEvent) => boolean | void;
  onUndo?: () => void;
  onRedo?: () => void;
  onSave?: () => void;
  onSelectAll?: () => void;
  onCopy?: () => boolean | void;
  onPaste?: () => boolean | void;
  onDuplicate?: () => boolean | void;
  onRandomizePlayheads?: () => void;
  onFastForwardStart?: () => void;
  onRewindStart?: () => void;
  onPlayPause?: () => void;
  onDrawMode?: () => void;
  onRedrawOrResync?: () => void;
  onResyncPlayheads?: () => void;
  onToggleLiveMode?: () => void;
  onToggleFullscreen?: () => void;
  onToggleTraversal?: () => void;
  onMuteOrMixer?: () => void;
  onSolo?: () => void;
  onToggleAssistedDrawing?: () => void;
  onToggleBeatGrid?: () => void;
  onToggleBarQuantize?: () => void;
  onCycleViewMode?: () => void;
  onSelectInstrumentIndex?: (index: number) => void;
  onDeleteSelected?: () => boolean | void;
  onAdjustVolume?: (direction: 1 | -1, shiftKey: boolean) => boolean | void;
  onAdjustTiming?: (direction: 1 | -1, shiftKey: boolean) => boolean | void;
  onShowShortcuts?: () => void;
  onScrollPitchUp?: () => void;
  onScrollPitchDown?: () => void;
  onScrollPitchHome?: () => void;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') {
    return false;
  }
  const el = target as HTMLElement;
  const tagName = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }
  if (el.isContentEditable === true || el.contentEditable === 'true') {
    return true;
  }
  const ceAttr = el.getAttribute?.('contenteditable');
  if (ceAttr === '' || ceAttr === 'true') {
    return true;
  }
  return false;
}

function isFastForwardKeyEvent(e: KeyboardEvent): boolean {
  return e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd';
}

function isRewindKeyEvent(e: KeyboardEvent): boolean {
  return e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract';
}

export function createKeydownHandler(handlers: ShortcutHandlers): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    // 1. Escape is handled EVEN inside editable controls (modals, inputs, selects, contentEditable)
    if (e.key === 'Escape') {
      const handled = handlers.onEscape?.(e);
      if (handled === true) {
        e.preventDefault();
      }
      return;
    }

    // 2. Ignore all other shortcuts when focused inside editable controls
    if (isEditableTarget(e.target)) {
      return;
    }

    const keyLower = e.key.toLowerCase();
    const hasMod = e.metaKey || e.ctrlKey;

    // 3. Modifier shortcuts (Cmd/Ctrl) BEFORE single-key guard
    if (hasMod && !e.altKey) {
      if (keyLower === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handlers.onRedo?.();
        } else {
          handlers.onUndo?.();
        }
        return;
      }

      if (keyLower === 'y' && !e.shiftKey) {
        e.preventDefault();
        handlers.onRedo?.();
        return;
      }

      if (keyLower === 's' && !e.shiftKey) {
        e.preventDefault();
        handlers.onSave?.();
        return;
      }

      if (keyLower === 'a' && !e.shiftKey) {
        e.preventDefault();
        handlers.onSelectAll?.();
        return;
      }

      if (keyLower === 'c' && !e.shiftKey) {
        if (handlers.onCopy?.() === true) {
          e.preventDefault();
        }
        return;
      }

      if (keyLower === 'v' && !e.shiftKey) {
        if (handlers.onPaste?.() === true) {
          e.preventDefault();
        }
        return;
      }

      if (keyLower === 'd' && !e.shiftKey) {
        if (handlers.onDuplicate?.() === true) {
          e.preventDefault();
        }
        return;
      }
    }

    // 4. Strictly guard ALL unmodified / Shift-only shortcuts against Cmd/Ctrl/Alt
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }

    // Shift+R: Randomize playheads (only when !metaKey && !ctrlKey && !altKey)
    if (keyLower === 'r' && e.shiftKey) {
      e.preventDefault();
      handlers.onRandomizePlayheads?.();
      return;
    }

    // Fast-forward (+) and Rewind (-)
    if (isFastForwardKeyEvent(e)) {
      e.preventDefault();
      handlers.onFastForwardStart?.();
      return;
    }

    if (isRewindKeyEvent(e)) {
      e.preventDefault();
      handlers.onRewindStart?.();
      return;
    }

    // Shortcuts cheat sheet modal (?)
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      handlers.onShowShortcuts?.();
      return;
    }

    // Play / Pause (Space or P)
    if (e.code === 'Space' || e.key === ' ' || keyLower === 'p') {
      e.preventDefault();
      handlers.onPlayPause?.();
      return;
    }

    // Draw mode (D)
    if (keyLower === 'd') {
      e.preventDefault();
      handlers.onDrawMode?.();
      return;
    }

    // Re-draw mode (R)
    if (keyLower === 'r') {
      e.preventDefault();
      handlers.onRedrawOrResync?.();
      return;
    }

    // Sync all playheads to phase 0 (0)
    if (e.key === '0') {
      e.preventDefault();
      handlers.onResyncPlayheads?.();
      return;
    }

    // Beat Grid toggle (G)
    if (keyLower === 'g') {
      e.preventDefault();
      handlers.onToggleBeatGrid?.();
      return;
    }

    // Next-Bar Quantize toggle (Q)
    if (keyLower === 'q') {
      e.preventDefault();
      handlers.onToggleBarQuantize?.();
      return;
    }

    // Live Play mode toggle (L)
    if (keyLower === 'l') {
      e.preventDefault();
      handlers.onToggleLiveMode?.();
      return;
    }

    // Fullscreen toggle (F)
    if (keyLower === 'f') {
      e.preventDefault();
      handlers.onToggleFullscreen?.();
      return;
    }

    // Traversal toggle (T)
    if (keyLower === 't') {
      e.preventDefault();
      handlers.onToggleTraversal?.();
      return;
    }

    // Mute / Mixer (M)
    if (keyLower === 'm') {
      handlers.onMuteOrMixer?.();
      return;
    }

    // Solo (S)
    if (keyLower === 's') {
      handlers.onSolo?.();
      return;
    }

    // Assisted Drawing toggle (A)
    if (keyLower === 'a') {
      e.preventDefault();
      handlers.onToggleAssistedDrawing?.();
      return;
    }

    // View mode cycle (V)
    if (keyLower === 'v') {
      e.preventDefault();
      handlers.onCycleViewMode?.();
      return;
    }

    // Number keys 1-7: Quick select instrument ink
    if (e.key >= '1' && e.key <= '7') {
      handlers.onSelectInstrumentIndex?.(Number(e.key) - 1);
      return;
    }

    // Delete / Backspace
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (handlers.onDeleteSelected?.() === true) {
        e.preventDefault();
      }
      return;
    }

    // Volume adjustment: [ / ] / ArrowUp / ArrowDown
    if (e.key === '[' || e.key === ']' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir: 1 | -1 = e.key === ']' || e.key === 'ArrowUp' ? 1 : -1;
      if (handlers.onAdjustVolume?.(dir, e.shiftKey) === true) {
        e.preventDefault();
      }
      return;
    }

    // Timing adjustment: ArrowLeft / ArrowRight
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const dir: 1 | -1 = e.key === 'ArrowRight' ? 1 : -1;
      if (handlers.onAdjustTiming?.(dir, e.shiftKey) === true) {
        e.preventDefault();
      }
      return;
    }

    // Frequency field scrolling: PageUp / PageDown / Home
    if (e.key === 'PageUp') {
      e.preventDefault();
      handlers.onScrollPitchUp?.();
      return;
    }

    if (e.key === 'PageDown') {
      e.preventDefault();
      handlers.onScrollPitchDown?.();
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      handlers.onScrollPitchHome?.();
    }
  };
}
