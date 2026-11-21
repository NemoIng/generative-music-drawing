import { readStorageKey, writeStorageKey } from './storage';

export const ONBOARDING_STORAGE_KEY = 'harmonic_onboarding_done';

export type OnboardingTriggerAction = 'drew_stroke' | 'selected_stroke' | 'tried_feature';

export interface OnboardingStep {
  title: string;
  description: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    title: 'Draw Sound Curves',
    description:
      'Drag anywhere on the canvas to paint a living melody. Height sets pitch, left-to-right pans stereo & tone.',
  },
  {
    title: 'Sculpt Each Line',
    description:
      'Click any line to shape its voicing (Fifth, Triad, 7th), gate/decay, wave motion, and tone effects.',
  },
  {
    title: 'Perform & Export',
    description:
      'Press L for Live Play, arrange morphing Scenes, connect MIDI I/O, or export lossless WAV/MP3 & Stems.',
  },
];

export class OnboardingController {
  private readonly root: Document;
  private active = false;
  private stepIndex = 0;
  private listenersBound = false;
  private nextBtnEl: HTMLElement | null = null;
  private skipBtnEl: HTMLElement | null = null;

  private readonly handleNextClick = (): void => {
    this.next();
  };

  private readonly handleSkipClick = (): void => {
    this.skip();
  };

  constructor(root: Document = document) {
    this.root = root;
  }

  public start(force: boolean = false): boolean {
    const coachmark = this.root.getElementById('onboardingCoachmark');
    if (!coachmark) {
      return false;
    }
    if (!force && readStorageKey(ONBOARDING_STORAGE_KEY) === '1') {
      return false;
    }

    this.stepIndex = 0;
    this.active = true;

    if (!this.listenersBound) {
      this.nextBtnEl = this.root.getElementById('onboardingNextBtn');
      this.skipBtnEl = this.root.getElementById('onboardingSkipBtn');
      this.nextBtnEl?.addEventListener('click', this.handleNextClick);
      this.skipBtnEl?.addEventListener('click', this.handleSkipClick);
      this.listenersBound = true;
    }

    coachmark.classList.remove('hidden');
    this.renderStep();
    return true;
  }

  private renderStep(): void {
    const step = ONBOARDING_STEPS[this.stepIndex];
    if (!step) {
      return;
    }

    const badgeEl = this.root.getElementById('onboardingStepBadge');
    const titleEl = this.root.getElementById('onboardingTitle');
    const descEl = this.root.getElementById('onboardingDesc');
    const nextBtn = this.root.getElementById('onboardingNextBtn');

    if (badgeEl) {
      badgeEl.textContent = `Step ${this.stepIndex + 1} of ${ONBOARDING_STEPS.length}`;
    }
    if (titleEl) {
      titleEl.textContent = step.title;
    }
    if (descEl) {
      descEl.textContent = step.description;
    }
    if (nextBtn) {
      nextBtn.textContent = this.stepIndex === ONBOARDING_STEPS.length - 1 ? 'Got it' : 'Next';
    }
  }

  public next(): void {
    if (!this.active) {
      return;
    }
    if (this.stepIndex + 1 < ONBOARDING_STEPS.length) {
      this.stepIndex += 1;
      this.renderStep();
    } else {
      this.complete();
    }
  }

  public skip(): void {
    this.active = false;
    this.root.getElementById('onboardingCoachmark')?.classList.add('hidden');
    writeStorageKey(ONBOARDING_STORAGE_KEY, '1');
  }

  public complete(): void {
    this.active = false;
    this.root.getElementById('onboardingCoachmark')?.classList.add('hidden');
    writeStorageKey(ONBOARDING_STORAGE_KEY, '1');
  }

  public notifyUserAction(action: OnboardingTriggerAction): void {
    if (!this.active) {
      return;
    }
    if (action === 'drew_stroke' && this.stepIndex === 0) {
      this.stepIndex = 1;
      this.renderStep();
    } else if (action === 'selected_stroke' && this.stepIndex === 1) {
      this.stepIndex = 2;
      this.renderStep();
    } else if (action === 'tried_feature' && this.stepIndex === 2) {
      this.complete();
    }
  }

  public isActive(): boolean {
    return this.active;
  }

  public currentStepIndex(): number {
    return this.stepIndex;
  }

  public destroy(): void {
    this.nextBtnEl?.removeEventListener('click', this.handleNextClick);
    this.skipBtnEl?.removeEventListener('click', this.handleSkipClick);
    this.nextBtnEl = null;
    this.skipBtnEl = null;
    this.listenersBound = false;
    this.active = false;
    this.root.getElementById('onboardingCoachmark')?.classList.add('hidden');
  }
}
