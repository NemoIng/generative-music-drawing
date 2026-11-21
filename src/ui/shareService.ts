import type { SavedComposition } from '../engine/types';

export const DEFAULT_SHARE_BASE_URL = 'https://generative-music-drawing.vercel.app';
const API_TIMEOUT_MS = 5000;

function bytesToBinaryString(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...chunk));
  }
  return parts.join('');
}

function validateComposition(value: unknown): SavedComposition | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<SavedComposition>;
  if (!Array.isArray(candidate.strokes)) {
    return null;
  }
  return candidate as SavedComposition;
}

export function encodeCompositionBase64Url(comp: SavedComposition): string {
  const json = JSON.stringify(comp);
  const bytes = new TextEncoder().encode(json);
  const binary = bytesToBinaryString(bytes);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function decodeCompositionBase64Url(encoded: string): SavedComposition | null {
  if (!encoded || typeof encoded !== 'string') {
    return null;
  }

  let candidate = encoded.trim();
  if (!candidate) {
    return null;
  }

  if (candidate.includes('%')) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      return null;
    }
  }

  const normalized = candidate
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/\s+/g, '');

  const remainder = normalized.length % 4;
  if (remainder === 1) {
    return null;
  }
  const padded = remainder === 0 ? normalized : normalized + '='.repeat(4 - remainder);

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Primary: UTF-8 TextDecoder (handles modern TextEncoder payloads and UTF-8 legacy payloads)
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = JSON.parse(utf8);
    const valid = validateComposition(parsed);
    if (valid) return valid;
  } catch {
    // Fall through to legacy decoding fallbacks
  }

  // Fallback 1: Legacy percent-encoded byte sequence equivalent to decodeURIComponent(escape(binary))
  try {
    let pct = '';
    for (let i = 0; i < binary.length; i++) {
      pct += '%' + binary.charCodeAt(i).toString(16).padStart(2, '0');
    }
    const decoded = decodeURIComponent(pct);
    const parsed = JSON.parse(decoded);
    const valid = validateComposition(parsed);
    if (valid) return valid;
  } catch {
    // Fall through to raw binary JSON parse
  }

  // Fallback 2: Raw ASCII/latin1 JSON
  try {
    const parsed = JSON.parse(binary);
    return validateComposition(parsed);
  } catch {
    return null;
  }
}

export function getShareBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const { protocol, origin } = window.location;
    if ((protocol === 'http:' || protocol === 'https:') && origin && origin !== 'null') {
      return origin.replace(/\/+$/, '');
    }
  }
  return DEFAULT_SHARE_BASE_URL;
}

export async function createShareUrl(
  comp: SavedComposition
): Promise<{ url: string; viaApi: boolean }> {
  const baseUrl = getShareBaseUrl();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => {
        controller.abort();
      }, API_TIMEOUT_MS)
    : null;

  try {
    const resp = await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: comp }),
      signal: controller?.signal,
    });

    if (resp.ok) {
      const result = (await resp.json()) as { id?: unknown } | null;
      if (result && typeof result.id === 'string' && result.id.length > 0) {
        return {
          url: `${baseUrl}/?track=${encodeURIComponent(result.id)}`,
          viaApi: true,
        };
      }
    }
  } catch {
    // Network/server failure or timeout falls back to client-side hash URL
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }

  return {
    url: `${baseUrl}/#score=${encodeCompositionBase64Url(comp)}`,
    viaApi: false,
  };
}

export async function fetchSharedTrack(trackId: string): Promise<SavedComposition | null> {
  if (!trackId) {
    return null;
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => {
        controller.abort();
      }, API_TIMEOUT_MS)
    : null;

  try {
    const resp = await fetch(`/api/track?id=${encodeURIComponent(trackId)}`, {
      signal: controller?.signal,
    });
    if (!resp.ok) {
      return null;
    }
    const json = (await resp.json()) as { data?: unknown } | null;
    const scoreData = json && json.data !== undefined ? json.data : json;
    return validateComposition(scoreData);
  } catch {
    return null;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
