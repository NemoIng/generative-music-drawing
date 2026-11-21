export interface SliderUndoCallbacks<T> {
  captureInitial: () => T | undefined;
  onInput: (value: number) => void;
  onCommit: (initial: T, value: number) => void;
}

export function bindSliderUndo<T>(
  slider: HTMLInputElement,
  callbacks: SliderUndoCallbacks<T>
): () => void {
  let hasInitial = false;
  let initial: T | undefined = undefined;

  const ensureCaptured = (): void => {
    if (!hasInitial) {
      initial = callbacks.captureInitial();
      hasInitial = initial !== undefined;
    }
  };

  const handlePointerDown = (): void => {
    initial = callbacks.captureInitial();
    hasInitial = initial !== undefined;
  };

  const handleKeyDown = (): void => {
    ensureCaptured();
  };

  const handleInput = (): void => {
    ensureCaptured();
    const numVal = parseFloat(slider.value);
    if (!Number.isNaN(numVal)) {
      callbacks.onInput(numVal);
    }
  };

  const handleChange = (): void => {
    const snap = hasInitial ? initial : callbacks.captureInitial();
    hasInitial = false;
    initial = undefined;

    const numVal = parseFloat(slider.value);
    if (snap !== undefined && !Number.isNaN(numVal)) {
      callbacks.onCommit(snap, numVal);
    }
  };

  slider.addEventListener('pointerdown', handlePointerDown);
  slider.addEventListener('keydown', handleKeyDown);
  slider.addEventListener('input', handleInput);
  slider.addEventListener('change', handleChange);

  return () => {
    slider.removeEventListener('pointerdown', handlePointerDown);
    slider.removeEventListener('keydown', handleKeyDown);
    slider.removeEventListener('input', handleInput);
    slider.removeEventListener('change', handleChange);
  };
}
