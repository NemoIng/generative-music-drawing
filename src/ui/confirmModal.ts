import { activateModalFocusTrap } from './modalFocus';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ActiveConfirmDialog {
  settle: (confirmed: boolean) => void;
}

let activeConfirmDialog: ActiveConfirmDialog | null = null;

export function isConfirmDialogOpen(root: Document = document): boolean {
  const modal = root.getElementById('confirmModal');
  return Boolean(modal && !modal.classList.contains('hidden'));
}

export function cancelConfirmDialog(): void {
  if (activeConfirmDialog !== null) {
    activeConfirmDialog.settle(false);
  }
}

export function showConfirmDialog(
  options: ConfirmDialogOptions,
  root: Document = document
): Promise<boolean> {
  if (activeConfirmDialog !== null) {
    cancelConfirmDialog();
  }

  const modal = root.getElementById('confirmModal');
  if (!modal) {
    return Promise.resolve(true);
  }

  const titleEl = root.getElementById('confirmModalTitle');
  const messageEl = root.getElementById('confirmModalMessage');
  const cancelBtn = root.getElementById('confirmModalCancelBtn');
  const okBtn = root.getElementById('confirmModalOkBtn');
  const backdrop = modal.querySelector<HTMLElement>('.modal-backdrop');

  if (titleEl) {
    titleEl.textContent = options.title;
  }
  if (messageEl) {
    messageEl.textContent = options.message;
  }
  if (cancelBtn) {
    cancelBtn.textContent = options.cancelLabel ?? 'Cancel';
  }
  if (okBtn) {
    okBtn.textContent = options.confirmLabel ?? 'Confirm';
    okBtn.classList.toggle('action-btn-danger', Boolean(options.danger));
  }

  modal.classList.remove('hidden');
  const releaseFocusTrap = activateModalFocusTrap(modal);

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const onCancel = (): void => settle(false);
    const onConfirm = (): void => settle(true);

    const settle = (confirmed: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (activeConfirmDialog === dialogState) {
        activeConfirmDialog = null;
      }
      cancelBtn?.removeEventListener('click', onCancel);
      backdrop?.removeEventListener('click', onCancel);
      okBtn?.removeEventListener('click', onConfirm);
      modal.classList.add('hidden');
      releaseFocusTrap();
      resolve(confirmed);
    };

    const dialogState: ActiveConfirmDialog = { settle };
    activeConfirmDialog = dialogState;

    cancelBtn?.addEventListener('click', onCancel);
    backdrop?.addEventListener('click', onCancel);
    okBtn?.addEventListener('click', onConfirm);
  });
}
