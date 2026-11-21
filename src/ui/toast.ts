export type ToastVariant = 'info' | 'error';

let toastHideTimer: ReturnType<typeof setTimeout> | null = null;

export function clearToastTimer(): void {
  if (toastHideTimer !== null) {
    clearTimeout(toastHideTimer);
    toastHideTimer = null;
  }
}

export function showToast(
  message: string,
  variant: ToastVariant = 'info',
  durationMs: number = 3200
): void {
  if (typeof document === 'undefined') {
    return;
  }

  let toastEl = document.getElementById('appToast') as HTMLDivElement | null;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'appToast';
    toastEl.className = 'app-toast';
    document.body.appendChild(toastEl);
  }

  clearToastTimer();

  toastEl.textContent = message;
  toastEl.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  toastEl.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');
  toastEl.classList.toggle('toast-error', variant === 'error');
  toastEl.classList.add('is-visible');

  toastHideTimer = setTimeout(() => {
    toastEl?.classList.remove('is-visible');
    toastHideTimer = null;
  }, durationMs);
}
