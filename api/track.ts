declare const process: { env?: Record<string, string | undefined> } | undefined;

export interface ApiRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
}

export interface ApiResponse {
  setHeader(name: string, value: string | string[]): void;
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
  end(body?: unknown): unknown;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSec: number;
}

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_STROKES = 500;
const TRACK_TTL_SECONDS = 7776000; // 90 days
const KV_TIMEOUT_MS = 5000;
const RATE_LIMIT_KV_TIMEOUT_MS = 3000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const TRACK_ID_REGEX = /^[A-Za-z0-9_-]{6,32}$/;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://generative-music-drawing.vercel.app',
  'https://*.vercel.app',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

const textEncoder = new TextEncoder();

// In-memory fallback cache across warm serverless invocations
const memoryStore = new Map<string, { data: string; createdAt: number }>();

// Soft per-IP rate limiting store for POST requests
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function _resetStoresForTest(): void {
  memoryStore.clear();
  rateLimitStore.clear();
}

function logEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  meta: Record<string, unknown> = {}
): void {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    service: 'api/track',
    level,
    event,
    ...meta,
  });
  if (level === 'error') {
    console.error(payload);
  } else if (level === 'warn') {
    console.warn(payload);
  } else {
    console.log(payload);
  }
}

function generateId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);

  let id = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    id += BASE64URL_ALPHABET[b0 >> 2];
    id += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    id += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    id += BASE64URL_ALPHABET[b2 & 0x3f];
  }
  return id;
}

function pruneMemory(): void {
  if (memoryStore.size > 1000) {
    const oldestKeys = Array.from(memoryStore.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, 200)
      .map(([k]) => k);
    for (const k of oldestKeys) {
      memoryStore.delete(k);
    }
  }
}

function pruneRateLimitStore(now: number): void {
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(ip);
    }
  }
}

function getHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      if (typeof val === 'string') return val;
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
        return val[0];
      }
      return undefined;
    }
  }
  return undefined;
}

function getAllowedOriginPatterns(): string[] {
  const raw = typeof process !== 'undefined' ? process?.env?.ALLOWED_ORIGINS : undefined;
  if (!raw || !raw.trim()) {
    return DEFAULT_ALLOWED_ORIGINS;
  }
  const parsed = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== '*');
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

function isOriginAllowed(origin: string, patterns: string[]): boolean {
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (parsedOrigin.origin !== origin) {
    return false;
  }
  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
    return false;
  }

  for (const pattern of patterns) {
    if (pattern === '*') continue;
    if (pattern === origin) return true;

    const schemeSep = pattern.indexOf('://');
    if (schemeSep === -1) continue;

    const patProto = `${pattern.slice(0, schemeSep)}:`;
    if (parsedOrigin.protocol !== patProto) continue;

    const patRest = pattern.slice(schemeSep + 3);

    // Port wildcard pattern such as http://localhost:* or http://127.0.0.1:*
    if (patRest.endsWith(':*')) {
      const patHost = patRest.slice(0, -2);
      if (patHost && parsedOrigin.hostname === patHost) {
        return true;
      }
      continue;
    }

    // Subdomain wildcard pattern such as https://*.vercel.app
    if (patRest.startsWith('*.')) {
      const hostAndPort = patRest.slice(2);
      const colonIdx = hostAndPort.indexOf(':');
      const patDomain = colonIdx === -1 ? hostAndPort : hostAndPort.slice(0, colonIdx);
      const patPort = colonIdx === -1 ? '' : hostAndPort.slice(colonIdx + 1);

      if (
        patDomain &&
        parsedOrigin.port === patPort &&
        parsedOrigin.hostname.endsWith(`.${patDomain}`) &&
        parsedOrigin.hostname.length > patDomain.length + 1
      ) {
        return true;
      }
    }
  }

  return false;
}

function getClientIp(req: ApiRequest): string {
  const forwarded = getHeader(req.headers, 'x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = getHeader(req.headers, 'x-real-ip');
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }
  if (req.socket?.remoteAddress) {
    return req.socket.remoteAddress;
  }
  return 'unknown';
}

function unwrapStoredTrack(raw: unknown): unknown {
  let value: unknown = raw;
  if (typeof value === 'string') {
    value = JSON.parse(value);
  }
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    value = JSON.parse(value[0]);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks and updates the local in-memory per-IP fixed-window rate limit.
 */
function checkRateLimit(ip: string, now: number = Date.now()): RateLimitResult {
  pruneRateLimitStore(now);
  const existingRate = rateLimitStore.get(ip);
  if (existingRate && existingRate.resetAt > now) {
    const resetInSec = Math.max(1, Math.ceil((existingRate.resetAt - now) / 1000));
    if (existingRate.count >= RATE_LIMIT_MAX_REQUESTS) {
      return { allowed: false, remaining: 0, resetInSec };
    }
    existingRate.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - existingRate.count),
      resetInSec,
    };
  }

  rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  return {
    allowed: true,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - 1),
    resetInSec: Math.max(1, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)),
  };
}

/**
 * Checks and updates the persistent Upstash Redis fixed-window rate limit via `/pipeline`.
 * Returns `null` on network errors or unexpected responses so callers fail open to in-memory limiting.
 */
export async function checkCloudRateLimit(
  ip: string,
  kvRestUrl: string,
  kvRestToken: string
): Promise<RateLimitResult | null> {
  const baseUrl = kvRestUrl.replace(/\/+$/, '');
  const key = `ratelimit:track:${ip}`;
  const windowSeconds = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

  try {
    const resp = await fetch(`${baseUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kvRestToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['TTL', key],
      ]),
      signal: AbortSignal.timeout(RATE_LIMIT_KV_TIMEOUT_MS),
    });

    if (!resp.ok) {
      logEvent('warn', 'kv_rate_limit_non_ok', { ip, status: resp.status });
      return null;
    }

    const pipelineBody: unknown = await resp.json();
    if (!Array.isArray(pipelineBody) || pipelineBody.length === 0) {
      logEvent('warn', 'kv_rate_limit_invalid_response', { ip });
      return null;
    }

    const firstItem = pipelineBody[0];
    const secondItem = pipelineBody[1];
    const count = isPlainObject(firstItem) ? firstItem.result : undefined;
    const ttl = isPlainObject(secondItem) ? secondItem.result : undefined;

    if (typeof count !== 'number' || !Number.isFinite(count)) {
      logEvent('warn', 'kv_rate_limit_invalid_count', { ip });
      return null;
    }

    const ttlSec =
      typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? Math.ceil(ttl) : windowSeconds;

    if (count === 1 || (typeof ttl === 'number' && ttl < 0)) {
      try {
        const expireResp = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvRestToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(['EXPIRE', key, windowSeconds]),
          signal: AbortSignal.timeout(RATE_LIMIT_KV_TIMEOUT_MS),
        });
        if (!expireResp.ok) {
          logEvent('warn', 'kv_rate_limit_expire_non_ok', { ip, status: expireResp.status });
        }
      } catch (expireErr) {
        logEvent('warn', 'kv_rate_limit_expire_error', {
          ip,
          error: expireErr instanceof Error ? expireErr.message : String(expireErr),
        });
      }
    }

    return {
      allowed: count <= RATE_LIMIT_MAX_REQUESTS,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - count),
      resetInSec: ttlSec,
    };
  } catch (err) {
    logEvent('warn', 'kv_rate_limit_error', {
      ip,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const allowedPatterns = getAllowedOriginPatterns();
  const origin = getHeader(req.headers, 'origin');
  const originAllowed = origin ? isOriginAllowed(origin, allowedPatterns) : false;

  if (origin && originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin && !originAllowed) {
    logEvent('warn', 'cors_origin_rejected', { origin });
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const env = typeof process !== 'undefined' ? process?.env : undefined;
  const kvRestUrlRaw = env?.KV_REST_API_URL || env?.UPSTASH_REDIS_REST_URL || '';
  const kvRestUrl = kvRestUrlRaw.replace(/\/+$/, '');
  const kvRestToken = env?.KV_REST_API_TOKEN || env?.UPSTASH_REDIS_REST_TOKEN || '';

  // GET: Fetch shared score by ID
  if (req.method === 'GET') {
    const rawId = req.query?.id;
    const id = typeof rawId === 'string' ? rawId : '';
    if (!id || !TRACK_ID_REGEX.test(id)) {
      return res.status(400).json({ error: 'Invalid or missing track id' });
    }

    // 1. Try Upstash / Vercel KV if configured
    if (kvRestUrl && kvRestToken) {
      try {
        const resp = await fetch(`${kvRestUrl}/get/track:${encodeURIComponent(id)}`, {
          headers: {
            Authorization: `Bearer ${kvRestToken}`,
          },
          signal: AbortSignal.timeout(KV_TIMEOUT_MS),
        });

        if (!resp.ok) {
          logEvent('warn', 'kv_fetch_non_ok', { id, status: resp.status });
        } else {
          const json = (await resp.json()) as { result?: unknown } | null;
          if (json && json.result !== null && json.result !== undefined && json.result !== '') {
            try {
              const parsed = unwrapStoredTrack(json.result);
              return res.status(200).json({ data: parsed });
            } catch (parseErr) {
              logEvent('warn', 'kv_parse_error', {
                id,
                error: parseErr instanceof Error ? parseErr.message : String(parseErr),
              });
            }
          }
        }
      } catch (err) {
        logEvent('warn', 'kv_fetch_error', {
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Fallback to in-memory store
    const item = memoryStore.get(id);
    if (item) {
      try {
        const parsed = unwrapStoredTrack(item.data);
        return res.status(200).json({ data: parsed });
      } catch {
        return res.status(200).json({ data: item.data });
      }
    }

    return res.status(404).json({ error: 'Track not found' });
  }

  // POST: Store score and return ID
  if (req.method === 'POST') {
    try {
      // Persistent Upstash Redis rate limit (when configured for identifiable IPs) with in-memory fallback
      const now = Date.now();
      const clientIp = getClientIp(req);
      let rateLimit: RateLimitResult | null = null;
      let rateLimitSource: 'kv' | 'memory' = 'memory';

      if (kvRestUrl && kvRestToken && clientIp !== 'unknown') {
        rateLimit = await checkCloudRateLimit(clientIp, kvRestUrl, kvRestToken);
        if (rateLimit !== null) {
          rateLimitSource = 'kv';
        }
      }

      if (rateLimit === null) {
        rateLimit = checkRateLimit(clientIp, now);
        rateLimitSource = 'memory';
      }

      res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX_REQUESTS));
      res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));

      if (!rateLimit.allowed) {
        const retryAfter = Math.max(1, Math.ceil(rateLimit.resetInSec));
        res.setHeader('Retry-After', String(retryAfter));
        logEvent('warn', 'rate_limit_exceeded', {
          ip: clientIp,
          retryAfter,
          source: rateLimitSource,
        });
        return res.status(429).json({ error: 'Too many requests' });
      }

      // Enforce Content-Length limit when provided
      const contentLengthHeader = getHeader(req.headers, 'content-length');
      if (contentLengthHeader !== undefined) {
        const parsedLength = Number(contentLengthHeader);
        if (Number.isFinite(parsedLength) && parsedLength > MAX_PAYLOAD_BYTES) {
          return res.status(413).json({ error: 'Payload too large (max 256 KB)' });
        }
      }

      const rawBody = req.body;
      let data: unknown = rawBody;
      if (typeof rawBody === 'string') {
        if (textEncoder.encode(rawBody).byteLength > MAX_PAYLOAD_BYTES) {
          return res.status(413).json({ error: 'Payload too large (max 256 KB)' });
        }
        try {
          data = JSON.parse(rawBody);
        } catch {
          return res.status(400).json({ error: 'Invalid JSON payload' });
        }
      }

      if (!isPlainObject(data)) {
        return res.status(400).json({ error: 'Invalid score data payload' });
      }

      const scorePayload = data.data !== undefined ? data.data : data;
      if (!isPlainObject(scorePayload) || !Array.isArray(scorePayload.strokes)) {
        return res.status(400).json({ error: 'Invalid score data payload: strokes must be an array' });
      }

      if (scorePayload.strokes.length > MAX_STROKES) {
        return res.status(400).json({ error: `Score exceeds maximum of ${MAX_STROKES} strokes` });
      }

      const stringified = JSON.stringify(scorePayload);
      const byteLength = textEncoder.encode(stringified).byteLength;
      if (byteLength > MAX_PAYLOAD_BYTES) {
        return res.status(413).json({ error: 'Payload too large (max 256 KB)' });
      }

      const id = generateId();

      // Save to Upstash / Vercel KV if configured
      if (kvRestUrl && kvRestToken) {
        try {
          const kvResp = await fetch(kvRestUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${kvRestToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(['SET', `track:${id}`, stringified, 'EX', TRACK_TTL_SECONDS]),
            signal: AbortSignal.timeout(KV_TIMEOUT_MS),
          });
          if (!kvResp.ok) {
            logEvent('warn', 'kv_store_non_ok', { id, status: kvResp.status });
          }
        } catch (err) {
          logEvent('warn', 'kv_store_error', {
            id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Also save in local warm memory cache
      pruneMemory();
      memoryStore.set(id, { data: stringified, createdAt: now });

      logEvent('info', 'track_stored', {
        id,
        strokeCount: scorePayload.strokes.length,
        bytes: byteLength,
      });

      return res.status(200).json({ id });
    } catch (err) {
      logEvent('error', 'track_store_unexpected_error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({ error: 'Internal server error storing track' });
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return res.status(405).json({ error: 'Method not allowed' });
}
