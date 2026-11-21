import type { SavedComposition } from '../engine/types';

export const STORAGE_KEYS = {
  PRESETS: 'harmonic_saved_presets',
  LEGACY_GROOVES: 'harmonic_saved_grooves',
  THEME: 'harmonic_theme',
  AUTO_SMOOTH: 'harmonic_auto_smooth',
  INSPECTOR_COLLAPSED: 'harmonic_inspector_collapsed',
  TOOLTIPS_ENABLED: 'harmonic_tooltips_enabled',
  VIEW_MODE: 'harmonic_view_mode',
} as const;

export function readStorageKey(key: string): string | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorageKey(key: string, value: string): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorageKey(key: string): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function isCompositionLike(value: unknown): value is SavedComposition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<SavedComposition>;
  return Array.isArray(candidate.strokes);
}

function parseStoredPresets(raw: string | null): SavedComposition[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed.filter(isCompositionLike).map((item) => ({
      ...item,
      name: typeof item.name === 'string' && item.name.trim() ? item.name : 'Preset',
      timestamp: typeof item.timestamp === 'number' ? item.timestamp : 0,
    }));
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const result: SavedComposition[] = [];
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (isCompositionLike(val)) {
        result.push({
          ...val,
          name: typeof val.name === 'string' && val.name.trim() ? val.name : key,
          timestamp: typeof val.timestamp === 'number' ? val.timestamp : 0,
        });
      }
    }
    return result;
  }

  return [];
}

function deduplicatePresets(items: SavedComposition[]): SavedComposition[] {
  const seen = new Set<string>();
  const deduped: SavedComposition[] = [];
  for (const item of items) {
    const dedupeKey = `${item.name}::${item.timestamp ?? 0}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      deduped.push(item);
    }
  }
  return deduped;
}

export function loadSavedPresets(): SavedComposition[] {
  const rawPrimary = readStorageKey(STORAGE_KEYS.PRESETS);
  const rawLegacy = readStorageKey(STORAGE_KEYS.LEGACY_GROOVES);

  const primary = parseStoredPresets(rawPrimary);

  if (rawLegacy !== null) {
    const legacy = parseStoredPresets(rawLegacy);
    const merged = deduplicatePresets([...primary, ...legacy]);
    const wrotePrimary = writeStorageKey(STORAGE_KEYS.PRESETS, JSON.stringify(merged));
    if (wrotePrimary || legacy.length === 0) {
      removeStorageKey(STORAGE_KEYS.LEGACY_GROOVES);
    }
    return merged;
  }

  return primary;
}

export function savePresetsList(presets: SavedComposition[]): boolean {
  try {
    const serialized = JSON.stringify(presets);
    return writeStorageKey(STORAGE_KEYS.PRESETS, serialized);
  } catch {
    return false;
  }
}

export function savePreset(comp: SavedComposition): boolean {
  const presets = loadSavedPresets();
  const existingIdx = presets.findIndex((p) => p.name === comp.name);
  if (existingIdx !== -1) {
    presets[existingIdx] = comp;
  } else {
    presets.push(comp);
  }
  return savePresetsList(presets);
}

export function deleteSavedPreset(index: number): boolean {
  const presets = loadSavedPresets();
  if (!Number.isInteger(index) || index < 0 || index >= presets.length) {
    return false;
  }
  presets.splice(index, 1);
  return savePresetsList(presets);
}
