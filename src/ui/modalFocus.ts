const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function isHTMLElement(node: unknown, doc: Document): node is HTMLElement {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const view = doc.defaultView;
  if (view && typeof view.HTMLElement === 'function' && node instanceof view.HTMLElement) {
    return true;
  }
  if (typeof HTMLElement === 'function' && node instanceof HTMLElement) {
    return true;
  }
  return (
    typeof (node as HTMLElement).focus === 'function' &&
    (node as Node).nodeType === 1
  );
}

function isElementHiddenInContainer(el: HTMLElement, container: HTMLElement): boolean {
  const view = container.ownerDocument?.defaultView;
  let curr: HTMLElement | null = el;
  while (curr && curr !== container) {
    if (curr.classList.contains('hidden')) {
      return true;
    }
    if (curr.hasAttribute('hidden')) {
      return true;
    }
    if (curr.getAttribute('aria-hidden') === 'true') {
      return true;
    }
    if (curr.style.display === 'none') {
      return true;
    }
    if (view && typeof view.getComputedStyle === 'function') {
      try {
        if (view.getComputedStyle(curr).display === 'none') {
          return true;
        }
      } catch {
        // Ignore computed style failures in partial DOM environments
      }
    }
    curr = curr.parentElement;
  }
  return false;
}

function focusFallbackTarget(modalEl: HTMLElement): void {
  const fallback = (modalEl.querySelector('.modal-card') as HTMLElement | null) ?? modalEl;
  fallback.tabIndex = -1;
  try {
    fallback.focus();
  } catch {
    // Ignore focus failures in detached/non-interactive DOM environments
  }
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => {
      if (el.hasAttribute('disabled') || Boolean((el as HTMLButtonElement).disabled)) {
        return false;
      }
      if (
        el.tagName.toUpperCase() === 'INPUT' &&
        ((el as HTMLInputElement).type.toLowerCase() === 'hidden' ||
          el.getAttribute('type')?.toLowerCase() === 'hidden')
      ) {
        return false;
      }
      if (el.getAttribute('tabindex') === '-1') {
        return false;
      }
      if (isElementHiddenInContainer(el, container)) {
        return false;
      }
      return true;
    }
  );
}

export function activateModalFocusTrap(modalEl: HTMLElement): () => void {
  const doc = modalEl.ownerDocument;
  const previousFocus: HTMLElement | null = isHTMLElement(doc.activeElement, doc)
    ? doc.activeElement
    : null;

  const initial = getFocusableElements(modalEl);
  if (initial.length > 0) {
    try {
      initial[0].focus();
    } catch {
      // Ignore focus failures
    }
  } else {
    focusFallbackTarget(modalEl);
  }

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') {
      return;
    }

    const focusables = getFocusableElements(modalEl);
    if (focusables.length === 0) {
      e.preventDefault();
      focusFallbackTarget(modalEl);
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = isHTMLElement(doc.activeElement, doc) ? doc.activeElement : null;
    const isInside = active !== null && modalEl.contains(active);

    if (e.shiftKey) {
      if (!isInside || active === first || !focusables.includes(active)) {
        e.preventDefault();
        try {
          last.focus();
        } catch {
          // Ignore focus failures
        }
      }
    } else if (!isInside || active === last || !focusables.includes(active)) {
      e.preventDefault();
      try {
        first.focus();
      } catch {
        // Ignore focus failures
      }
    }
  };

  doc.addEventListener('keydown', handleKeyDown, true);

  let deactivated = false;
  return () => {
    if (deactivated) {
      return;
    }
    deactivated = true;
    doc.removeEventListener('keydown', handleKeyDown, true);
    if (previousFocus && previousFocus.isConnected) {
      try {
        previousFocus.focus();
      } catch {
        // Ignore focus failures
      }
    }
  };
}
