export type ViewMode = 'studio' | 'zen';

export interface ViewModeCallbacks {
  onViewChange: (mode: ViewMode) => void;
  onResizeRequired: () => void;
}

export class ViewModeManager {
  private currentMode: ViewMode = 'studio';
  private callbacks: ViewModeCallbacks;
  private appEl: HTMLElement | null = null;
  private studioDeckEl: HTMLElement | null = null;
  private zenDockEl: HTMLElement | null = null;
  private topBarEl: HTMLElement | null = null;
  private bottomBarEl: HTMLElement | null = null;
  private pitchNavEl: HTMLElement | null = null;

  constructor(callbacks: ViewModeCallbacks) {
    this.callbacks = callbacks;
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('harmonic_view_mode') : null;
    if (saved === 'studio' || saved === 'zen') {
      this.currentMode = saved;
    } else {
      this.currentMode = 'studio';
    }
  }

  public initDOM(elements: {
    app: HTMLElement | null;
    studioDeck: HTMLElement | null;
    zenDock: HTMLElement | null;
    topBar?: HTMLElement | null;
    bottomBar?: HTMLElement | null;
    pitchNav?: HTMLElement | null;
  }): void {
    this.appEl = elements.app;
    this.studioDeckEl = elements.studioDeck;
    this.zenDockEl = elements.zenDock;
    this.topBarEl = elements.topBar || null;
    this.bottomBarEl = elements.bottomBar || null;
    this.pitchNavEl = elements.pitchNav || null;

    this.applyMode(this.currentMode, false);
  }

  public getMode(): ViewMode {
    return this.currentMode;
  }

  public setMode(mode: ViewMode, notify = true): void {
    if (mode !== 'studio' && mode !== 'zen') return;
    this.currentMode = mode;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('harmonic_view_mode', mode);
    }
    this.applyMode(mode, notify);
  }

  public cycleNextMode(): ViewMode {
    const nextMode: ViewMode = this.currentMode === 'studio' ? 'zen' : 'studio';
    this.setMode(nextMode);
    return nextMode;
  }

  public toggleStudioZen(): ViewMode {
    const nextMode = this.currentMode === 'zen' ? 'studio' : 'zen';
    this.setMode(nextMode);
    return nextMode;
  }

  private applyMode(mode: ViewMode, notify: boolean): void {
    if (this.appEl) {
      this.appEl.classList.remove('view-studio', 'view-zen');
      this.appEl.classList.add(`view-${mode}`);
    }

    // 1. Studio Deck visibility
    if (this.studioDeckEl) {
      this.studioDeckEl.style.display = mode === 'studio' ? 'flex' : 'none';
    }

    // 2. Zen Glass Dock visibility
    if (this.zenDockEl) {
      this.zenDockEl.style.display = mode === 'zen' ? 'flex' : 'none';
    }

    // 3. Top bar visibility (Hidden in Zen mode for total immersion)
    if (this.topBarEl) {
      this.topBarEl.style.display = mode === 'zen' ? 'none' : 'flex';
    }

    // 4. Bottom status bar (Hidden in Zen mode)
    if (this.bottomBarEl) {
      this.bottomBarEl.style.display = mode === 'studio' ? 'flex' : 'none';
    }

    // 5. Pitch Navigator rail (Hidden in Zen mode)
    if (this.pitchNavEl) {
      this.pitchNavEl.style.display = mode === 'zen' ? 'none' : 'flex';
    }

    // Update active switch buttons
    const doc = this.appEl?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (doc) {
      doc.querySelectorAll<HTMLElement>('[data-view-mode]').forEach((btn) => {
        const btnMode = btn.getAttribute('data-view-mode');
        btn.classList.toggle('active', btnMode === mode);
      });
    }

    if (notify) {
      this.callbacks.onViewChange(mode);
    }
    this.callbacks.onResizeRequired();
  }
}
