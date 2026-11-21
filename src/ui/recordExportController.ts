import type { StrokeManager } from '../engine/strokeManager';
import type { ScaleQuantizer } from '../audio/scaleQuantizer';
import type { SoundEngine } from '../audio/audioContext';
import { LiveRecorder, simulateAndExportMp3, downloadBlob } from '../audio/mp3Export';
import { simulateAndExportWav, simulateAndExportStems } from '../audio/wavExport';
import { showToast } from './toast';
import { activateModalFocusTrap } from './modalFocus';

export interface RecordExportDeps {
  strokeManager: StrokeManager;
  quantizer: ScaleQuantizer;
  soundEngine: SoundEngine;
  getCanvasSize: () => { width: number; height: number };
  getCompositionName: () => string;
  onAudioStarted?: () => Promise<void> | void;
}

export class RecordExportController {
  private cleanups: Array<() => void> = [];
  private liveRecorder: LiveRecorder | null = null;
  private isSimulating = false;
  private releaseFocusTrap: (() => void) | null = null;
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deps: RecordExportDeps,
    private readonly root: Document = document
  ) {}

  private listen<K extends keyof HTMLElementEventMap>(
    el: EventTarget | null | undefined,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void
  ): void {
    if (!el) return;
    const listener = handler as EventListener;
    el.addEventListener(type, listener);
    this.cleanups.push(() => el.removeEventListener(type, listener));
  }

  private getSelectedFormat(): 'mp3' | 'wav' {
    const formatSelect = this.root.getElementById('exportFormatSelect') as HTMLSelectElement | null;
    return formatSelect?.value === 'wav' ? 'wav' : 'mp3';
  }

  private getSimulateButtonLabel(format: 'mp3' | 'wav'): string {
    return format === 'wav' ? 'Simulate & Export WAV' : 'Simulate & Convert to MP3';
  }

  private getSafeBaseName(): string {
    const rawName = this.deps.getCompositionName() || 'generative-drawing';
    const sanitized = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return sanitized || 'generative-drawing';
  }

  private getClampedDuration(): number {
    const simDurationInput = this.root.getElementById('simDurationInput') as HTMLInputElement | null;
    const parsed = parseInt(simDurationInput?.value || '30', 10) || 30;
    return Math.max(5, Math.min(600, parsed));
  }

  private clearAutoCloseTimer(): void {
    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }

  public init(): void {
    this.destroy();

    const recordModalBtn = this.root.getElementById('recordModalBtn');
    const recordModal = this.root.getElementById('recordModal');
    const closeRecordModalBtn = this.root.getElementById('closeRecordModalBtn');
    const tabSimulateBtn = this.root.getElementById('tabSimulateBtn');
    const tabLiveBtn = this.root.getElementById('tabLiveBtn');
    const simDurationInput = this.root.getElementById('simDurationInput') as HTMLInputElement | null;
    const durationPillBtns = this.root.querySelectorAll<HTMLButtonElement>('.duration-pill-btn');
    const exportFormatSelect = this.root.getElementById('exportFormatSelect') as HTMLSelectElement | null;
    const startSimulateBtn = this.root.getElementById('startSimulateBtn') as HTMLButtonElement | null;
    const exportStemsBtn = this.root.getElementById('exportStemsBtn') as HTMLButtonElement | null;
    const startLiveRecBtn = this.root.getElementById('startLiveRecBtn');
    const stopLiveRecBtn = this.root.getElementById('stopLiveRecBtn');
    const cancelLiveRecBtn = this.root.getElementById('cancelLiveRecBtn');

    this.listen(recordModalBtn, 'click', () => {
      this.openModal();
    });

    this.listen(closeRecordModalBtn, 'click', () => {
      this.closeModal();
    });

    const backdrop = recordModal?.querySelector('.modal-backdrop') ?? null;
    this.listen(backdrop, 'click', () => {
      this.closeModal();
    });

    this.listen(tabSimulateBtn, 'click', () => {
      this.switchTab('simulate');
    });

    this.listen(tabLiveBtn, 'click', () => {
      this.switchTab('live');
    });

    durationPillBtns.forEach((btn) => {
      this.listen(btn, 'click', () => {
        durationPillBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const sec = btn.getAttribute('data-sec');
        if (sec && simDurationInput) {
          simDurationInput.value = sec;
        }
      });
    });

    this.listen(simDurationInput, 'input', () => {
      if (!simDurationInput) return;
      const val = simDurationInput.value;
      durationPillBtns.forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-sec') === val);
      });
    });

    this.listen(exportFormatSelect, 'change', () => {
      if (!this.isSimulating && startSimulateBtn) {
        startSimulateBtn.textContent = this.getSimulateButtonLabel(this.getSelectedFormat());
      }
    });

    this.listen(startSimulateBtn, 'click', () => {
      void this.startSimulateExport();
    });

    this.listen(exportStemsBtn, 'click', () => {
      void this.startStemsExport();
    });

    this.listen(startLiveRecBtn, 'click', () => {
      void this.startLiveRecording();
    });

    this.listen(stopLiveRecBtn, 'click', () => {
      void this.stopLiveRecording();
    });

    this.listen(cancelLiveRecBtn, 'click', () => {
      this.cancelLiveRecording();
    });
  }

  public openModal(): void {
    this.clearAutoCloseTimer();

    const recordModal = this.root.getElementById('recordModal');
    if (!recordModal) return;

    recordModal.classList.remove('hidden');
    this.switchTab('simulate');

    const simProgressWrap = this.root.getElementById('simProgressWrap');
    const simProgressBar = this.root.getElementById('simProgressBar');
    const startSimulateBtn = this.root.getElementById('startSimulateBtn') as HTMLButtonElement | null;
    const exportStemsBtn = this.root.getElementById('exportStemsBtn') as HTMLButtonElement | null;

    if (simProgressWrap) simProgressWrap.classList.add('hidden');
    if (simProgressBar) simProgressBar.style.width = '0%';
    if (startSimulateBtn) {
      startSimulateBtn.disabled = false;
      startSimulateBtn.textContent = this.getSimulateButtonLabel(this.getSelectedFormat());
    }
    if (exportStemsBtn) {
      exportStemsBtn.disabled = false;
      exportStemsBtn.textContent = 'Export Stems';
    }

    this.releaseFocusTrap?.();
    this.releaseFocusTrap = activateModalFocusTrap(recordModal);
  }

  public closeModal(): void {
    this.clearAutoCloseTimer();
    this.releaseFocusTrap?.();
    this.releaseFocusTrap = null;
    const recordModal = this.root.getElementById('recordModal');
    if (recordModal) {
      recordModal.classList.add('hidden');
    }
  }

  public isOpen(): boolean {
    const recordModal = this.root.getElementById('recordModal');
    return Boolean(recordModal && !recordModal.classList.contains('hidden'));
  }

  public switchTab(tab: 'simulate' | 'live'): void {
    const tabSimulateBtn = this.root.getElementById('tabSimulateBtn');
    const tabLiveBtn = this.root.getElementById('tabLiveBtn');
    const tabSimulatePane = this.root.getElementById('tabSimulatePane');
    const tabLivePane = this.root.getElementById('tabLivePane');

    if (tab === 'simulate') {
      tabSimulateBtn?.classList.add('active');
      tabLiveBtn?.classList.remove('active');
      tabSimulatePane?.classList.remove('hidden');
      tabLivePane?.classList.add('hidden');
    } else {
      tabLiveBtn?.classList.add('active');
      tabSimulateBtn?.classList.remove('active');
      tabLivePane?.classList.remove('hidden');
      tabSimulatePane?.classList.add('hidden');
    }
  }

  public async startSimulateExport(): Promise<void> {
    if (this.isSimulating) return;
    if (this.deps.strokeManager.activeStrokes.length === 0) {
      showToast('Draw or load some lines before simulating.', 'error');
      return;
    }

    const duration = this.getClampedDuration();
    const format = this.getSelectedFormat();
    const startSimulateBtn = this.root.getElementById('startSimulateBtn') as HTMLButtonElement | null;
    const exportStemsBtn = this.root.getElementById('exportStemsBtn') as HTMLButtonElement | null;
    const simProgressWrap = this.root.getElementById('simProgressWrap');
    const simProgressBar = this.root.getElementById('simProgressBar');
    const simProgressStatus = this.root.getElementById('simProgressStatus');

    this.isSimulating = true;
    this.clearAutoCloseTimer();

    if (startSimulateBtn) {
      startSimulateBtn.disabled = true;
      startSimulateBtn.textContent = format === 'wav' ? 'Simulating & Exporting WAV...' : 'Simulating & Converting...';
    }
    if (exportStemsBtn) {
      exportStemsBtn.disabled = true;
    }
    if (simProgressWrap) simProgressWrap.classList.remove('hidden');
    if (simProgressBar) simProgressBar.style.width = '5%';
    if (simProgressStatus) simProgressStatus.textContent = 'Starting offline simulation...';

    try {
      const safeName = this.getSafeBaseName();
      const filename = `${safeName}-${duration}s.${format}`;
      const { width, height } = this.deps.getCanvasSize();
      const options = {
        durationSeconds: duration,
        strokeManager: this.deps.strokeManager,
        quantizer: this.deps.quantizer,
        canvasWidth: width,
        canvasHeight: height,
        onProgress: (status: string, percent: number) => {
          if (simProgressBar) simProgressBar.style.width = `${percent}%`;
          if (simProgressStatus) simProgressStatus.textContent = `${status}`;
        },
      };

      if (format === 'wav') {
        await simulateAndExportWav(options, filename);
      } else {
        await simulateAndExportMp3(options, filename);
      }

      if (simProgressStatus) {
        simProgressStatus.textContent = `Export complete! Downloaded ${filename}`;
      }
      this.autoCloseTimer = setTimeout(() => {
        this.autoCloseTimer = null;
        this.closeModal();
      }, 1400);
    } catch (err) {
      console.error('Simulation export error:', err);
      showToast(
        `An error occurred during ${format.toUpperCase()} simulation. Check browser console for details.`,
        'error'
      );
    } finally {
      this.isSimulating = false;
      if (startSimulateBtn) {
        startSimulateBtn.disabled = false;
        startSimulateBtn.textContent = this.getSimulateButtonLabel(this.getSelectedFormat());
      }
      if (exportStemsBtn) {
        exportStemsBtn.disabled = false;
      }
    }
  }

  public async startStemsExport(): Promise<void> {
    if (this.isSimulating) return;
    if (this.deps.strokeManager.activeStrokes.length === 0) {
      showToast('Draw or load some lines before exporting stems.', 'error');
      return;
    }

    const hasAudible = this.deps.strokeManager.activeStrokes.some((s) =>
      this.deps.strokeManager.isStrokeAudible(s)
    );
    if (!hasAudible) {
      showToast('Unmute at least one layer before exporting stems.', 'error');
      return;
    }

    const duration = this.getClampedDuration();
    const format = this.getSelectedFormat();
    const safeName = this.getSafeBaseName();
    const startSimulateBtn = this.root.getElementById('startSimulateBtn') as HTMLButtonElement | null;
    const exportStemsBtn = this.root.getElementById('exportStemsBtn') as HTMLButtonElement | null;
    const simProgressWrap = this.root.getElementById('simProgressWrap');
    const simProgressBar = this.root.getElementById('simProgressBar');
    const simProgressStatus = this.root.getElementById('simProgressStatus');

    this.isSimulating = true;
    this.clearAutoCloseTimer();

    if (startSimulateBtn) {
      startSimulateBtn.disabled = true;
    }
    if (exportStemsBtn) {
      exportStemsBtn.disabled = true;
      exportStemsBtn.textContent = 'Exporting Stems...';
    }
    if (simProgressWrap) simProgressWrap.classList.remove('hidden');
    if (simProgressBar) simProgressBar.style.width = '5%';
    if (simProgressStatus) simProgressStatus.textContent = 'Starting stem export...';

    try {
      const { width, height } = this.deps.getCanvasSize();
      const stems = await simulateAndExportStems(
        {
          durationSeconds: duration,
          strokeManager: this.deps.strokeManager,
          quantizer: this.deps.quantizer,
          canvasWidth: width,
          canvasHeight: height,
          onProgress: (status: string, percent: number) => {
            if (simProgressBar) simProgressBar.style.width = `${percent}%`;
            if (simProgressStatus) simProgressStatus.textContent = `${status}`;
          },
        },
        format,
        safeName
      );

      if (simProgressStatus) {
        simProgressStatus.textContent = `Exported ${stems.length} ${format.toUpperCase()} stems!`;
      }
      showToast(`Exported ${stems.length} ${format.toUpperCase()} stem${stems.length === 1 ? '' : 's'}!`);

      this.autoCloseTimer = setTimeout(() => {
        this.autoCloseTimer = null;
        this.closeModal();
      }, 1400);
    } catch (err) {
      console.error('Stems export error:', err);
      showToast('An error occurred while exporting stems. Check browser console for details.', 'error');
    } finally {
      this.isSimulating = false;
      if (startSimulateBtn) {
        startSimulateBtn.disabled = false;
        startSimulateBtn.textContent = this.getSimulateButtonLabel(this.getSelectedFormat());
      }
      if (exportStemsBtn) {
        exportStemsBtn.disabled = false;
        exportStemsBtn.textContent = 'Export Stems';
      }
    }
  }

  public async startLiveRecording(): Promise<void> {
    await this.deps.onAudioStarted?.();
    if (!this.deps.soundEngine.isReady) {
      await this.deps.soundEngine.init();
    }

    this.closeModal();

    if (!this.liveRecorder) {
      this.liveRecorder = new LiveRecorder();
    }

    if (this.liveRecorder.recording) {
      this.liveRecorder.cancel();
    }

    const liveRecTimer = this.root.getElementById('liveRecTimer');
    const liveRecordingBanner = this.root.getElementById('liveRecordingBanner');
    if (liveRecTimer) liveRecTimer.textContent = '00:00';
    if (liveRecordingBanner) liveRecordingBanner.classList.remove('hidden');

    try {
      this.liveRecorder.start(this.deps.soundEngine, (elapsedSec) => {
        const m = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
        const s = Math.floor(elapsedSec % 60).toString().padStart(2, '0');
        if (liveRecTimer) liveRecTimer.textContent = `${m}:${s}`;
      });
    } catch (err) {
      console.error('Live record start error:', err);
      showToast('Could not start live recording.', 'error');
      liveRecordingBanner?.classList.add('hidden');
    }
  }

  public async stopLiveRecording(): Promise<void> {
    if (!this.liveRecorder || !this.liveRecorder.recording) return;

    const stopLiveRecBtn = this.root.getElementById('stopLiveRecBtn') as HTMLButtonElement | null;
    const liveRecordingBanner = this.root.getElementById('liveRecordingBanner');

    if (stopLiveRecBtn) {
      stopLiveRecBtn.disabled = true;
      stopLiveRecBtn.textContent = 'Encoding MP3...';
    }

    try {
      const safeName = this.getSafeBaseName();
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
      const filename = `${safeName}-live-${timeStr}.mp3`;

      const mp3Blob = await this.liveRecorder.stopAndExport();
      downloadBlob(mp3Blob, filename);
    } catch (err) {
      console.error('Live record export error:', err);
      showToast('Could not export live recording MP3.', 'error');
    } finally {
      liveRecordingBanner?.classList.add('hidden');
      if (stopLiveRecBtn) {
        stopLiveRecBtn.disabled = false;
        stopLiveRecBtn.textContent = 'Stop & Export MP3';
      }
    }
  }

  public cancelLiveRecording(): void {
    if (this.liveRecorder) {
      this.liveRecorder.cancel();
    }
    const liveRecordingBanner = this.root.getElementById('liveRecordingBanner');
    liveRecordingBanner?.classList.add('hidden');
  }

  public destroy(): void {
    this.clearAutoCloseTimer();
    this.releaseFocusTrap?.();
    this.releaseFocusTrap = null;
    this.liveRecorder?.cancel();
    while (this.cleanups.length > 0) {
      this.cleanups.pop()?.();
    }
  }
}
