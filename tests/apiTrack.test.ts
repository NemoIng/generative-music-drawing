import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import trackHandler, {
  _resetStoresForTest,
  checkCloudRateLimit,
  type ApiRequest,
  type ApiResponse,
} from '../api/track';
import healthHandler from '../api/health';

interface MockResponse extends ApiResponse {
  statusCode: number;
  jsonBody: unknown;
  ended: boolean;
  headers: Record<string, string | string[]>;
  getHeader(name: string): string | string[] | undefined;
}

function createMockRes(): MockResponse {
  const headers: Record<string, string | string[]> = {};
  const res: MockResponse = {
    statusCode: 200,
    jsonBody: undefined,
    ended: false,
    headers,
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.jsonBody = body;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res;
}

const ENV_KEYS = [
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'ALLOWED_ORIGINS',
] as const;

const sampleScore = {
  version: 1,
  name: 'Unit Test Piece',
  timestamp: 1700000000000,
  bpm: 120,
  strokes: [
    {
      id: 's1',
      instrumentId: 'indigo',
      style: 'solid',
      path: {
        isClosed: false,
        segments: [
          {
            p0: { x: 10, y: 100 },
            p1: { x: 40, y: 100 },
            p2: { x: 80, y: 100 },
            p3: { x: 120, y: 100 },
          },
        ],
      },
    },
  ],
};

describe('api/track and api/health handlers', () => {
  let savedFetch: typeof globalThis.fetch;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    _resetStoresForTest();
    savedFetch = globalThis.fetch;
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    vi.restoreAllMocks();
  });

  describe('POST /api/track', () => {
    it('stores a valid score and returns an 8-char base64url ID', async () => {
      const req: ApiRequest = {
        method: 'POST',
        body: { data: sampleScore },
      };
      const res = createMockRes();

      await trackHandler(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as { id: string };
      expect(body.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    });

    it('persists to Upstash KV via POST with 90-day TTL when KV env vars are configured', async () => {
      process.env.KV_REST_API_URL = 'https://kv.example.test///';
      process.env.KV_REST_API_TOKEN = 'secret-token-123';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: 'OK' }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const req: ApiRequest = {
        method: 'POST',
        body: { data: sampleScore },
      };
      const res = createMockRes();

      await trackHandler(req, res);

      expect(res.statusCode).toBe(200);
      const { id } = res.jsonBody as { id: string };
      expect(id).toMatch(/^[A-Za-z0-9_-]{8}$/);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://kv.example.test');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        Authorization: 'Bearer secret-token-123',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(init.body as string)).toEqual([
        'SET',
        `track:${id}`,
        JSON.stringify(sampleScore),
        'EX',
        7776000,
      ]);
    });

    it('returns 413 when payload exceeds 256 KB', async () => {
      const bigPadding = 'x'.repeat(260 * 1024);
      const req: ApiRequest = {
        method: 'POST',
        body: { data: { ...sampleScore, name: bigPadding } },
      };
      const res = createMockRes();

      await trackHandler(req, res);

      expect(res.statusCode).toBe(413);
    });

    it('returns 413 when Content-Length header exceeds 256 KB', async () => {
      const req: ApiRequest = {
        method: 'POST',
        headers: { 'content-length': String(256 * 1024 + 1) },
        body: { data: sampleScore },
      };
      const res = createMockRes();

      await trackHandler(req, res);

      expect(res.statusCode).toBe(413);
    });

    it('returns 400 when strokes is missing, non-array, or exceeds 500 strokes', async () => {
      const missingRes = createMockRes();
      await trackHandler({ method: 'POST', body: { data: { bpm: 120 } } }, missingRes);
      expect(missingRes.statusCode).toBe(400);

      const nonArrayRes = createMockRes();
      await trackHandler(
        { method: 'POST', body: { data: { strokes: 'not-an-array' } } },
        nonArrayRes
      );
      expect(nonArrayRes.statusCode).toBe(400);

      const tooManyStrokes = Array.from({ length: 501 }, (_, idx) => ({ id: `s-${idx}` }));
      const overLimitRes = createMockRes();
      await trackHandler(
        { method: 'POST', body: { data: { strokes: tooManyStrokes } } },
        overLimitRes
      );
      expect(overLimitRes.statusCode).toBe(400);
    });
  });

  describe('GET /api/track', () => {
    it('retrieves stored score from memory by valid ID', async () => {
      const postRes = createMockRes();
      await trackHandler({ method: 'POST', body: { data: sampleScore } }, postRes);
      const { id } = postRes.jsonBody as { id: string };

      const getRes = createMockRes();
      await trackHandler({ method: 'GET', query: { id } }, getRes);

      expect(getRes.statusCode).toBe(200);
      expect(getRes.jsonBody).toEqual({ data: sampleScore });
    });

    it('retrieves stored score from Upstash KV JSON string', async () => {
      process.env.KV_REST_API_URL = 'https://kv.example.test';
      process.env.KV_REST_API_TOKEN = 'secret-token-123';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: JSON.stringify(sampleScore) }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const getRes = createMockRes();
      await trackHandler({ method: 'GET', query: { id: 'AbCd1234' } }, getRes);

      expect(getRes.statusCode).toBe(200);
      expect(getRes.jsonBody).toEqual({ data: sampleScore });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kv.example.test/get/track:AbCd1234',
        expect.objectContaining({
          headers: { Authorization: 'Bearer secret-token-123' },
        })
      );
    });

    it('unwraps legacy single-element JSON array strings returned by KV', async () => {
      process.env.KV_REST_API_URL = 'https://kv.example.test';
      process.env.KV_REST_API_TOKEN = 'secret-token-123';

      const legacyWrapped = JSON.stringify([JSON.stringify(sampleScore)]);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: legacyWrapped }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const getRes = createMockRes();
      await trackHandler({ method: 'GET', query: { id: 'Legacy01' } }, getRes);

      expect(getRes.statusCode).toBe(200);
      expect(getRes.jsonBody).toEqual({ data: sampleScore });
    });

    it('returns 400 for invalid ID formats and 404 for nonexistent ID', async () => {
      for (const badId of ['../bad', 'ab', 'has space', '']) {
        const res = createMockRes();
        await trackHandler({ method: 'GET', query: { id: badId } }, res);
        expect(res.statusCode).toBe(400);
      }

      const missingRes = createMockRes();
      await trackHandler({ method: 'GET', query: { id: 'NoSuch01' } }, missingRes);
      expect(missingRes.statusCode).toBe(404);
    });
  });

  describe('CORS, Rate Limiting, and HTTP Methods', () => {
    it('echoes Origin + Vary: Origin for allowed origins and omits Access-Control-Allow-Origin for disallowed origins', async () => {
      const allowedOrigins = [
        'https://generative-music-drawing.vercel.app',
        'https://preview-123.vercel.app',
        'http://localhost:3000',
      ];

      for (const origin of allowedOrigins) {
        const res = createMockRes();
        await trackHandler({ method: 'OPTIONS', headers: { origin } }, res);
        expect(res.statusCode).toBe(200);
        expect(res.getHeader('Access-Control-Allow-Origin')).toBe(origin);
        expect(res.getHeader('Access-Control-Allow-Origin')).not.toBe('*');
        expect(res.getHeader('Vary')).toBe('Origin');
      }

      const disallowedRes = createMockRes();
      await trackHandler(
        { method: 'OPTIONS', headers: { origin: 'https://evil.example.com' } },
        disallowedRes
      );
      expect(disallowedRes.statusCode).toBe(200);
      expect(disallowedRes.getHeader('Access-Control-Allow-Origin')).toBeUndefined();
      expect(disallowedRes.getHeader('Vary')).toBe('Origin');
    });

    it('enforces soft rate limit returning 429 with Retry-After on the 31st POST from the same IP', async () => {
      const headers = { 'x-forwarded-for': '203.0.113.99' };

      for (let i = 0; i < 30; i++) {
        const res = createMockRes();
        await trackHandler(
          { method: 'POST', headers, body: { data: sampleScore } },
          res
        );
        expect(res.statusCode).toBe(200);
      }

      const limitedRes = createMockRes();
      await trackHandler(
        { method: 'POST', headers, body: { data: sampleScore } },
        limitedRes
      );
      expect(limitedRes.statusCode).toBe(429);
      const retryAfter = Number(limitedRes.getHeader('Retry-After'));
      expect(Number.isFinite(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);

      // Different IP is unaffected
      const otherIpRes = createMockRes();
      await trackHandler(
        {
          method: 'POST',
          headers: { 'x-forwarded-for': '203.0.113.100' },
          body: { data: sampleScore },
        },
        otherIpRes
      );
      expect(otherIpRes.statusCode).toBe(200);
    });

    it('handles OPTIONS with 200 and rejects DELETE with 405', async () => {
      const optionsRes = createMockRes();
      await trackHandler({ method: 'OPTIONS' }, optionsRes);
      expect(optionsRes.statusCode).toBe(200);
      expect(optionsRes.ended).toBe(true);

      const deleteRes = createMockRes();
      await trackHandler({ method: 'DELETE' }, deleteRes);
      expect(deleteRes.statusCode).toBe(405);
      expect(deleteRes.getHeader('Allow')).toBe('GET, POST, OPTIONS');
    });

    it('uses Upstash Redis /pipeline for persistent per-IP rate limiting and enforces 429 even after _resetStoresForTest()', async () => {
      process.env.KV_REST_API_URL = 'https://kv.example.test///';
      process.env.KV_REST_API_TOKEN = 'rl-token-secret';

      const fetchMock = vi
        .fn()
        // 1. /pipeline INCR + TTL on first hit
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ result: 1 }, { result: -1 }],
        })
        // 2. EXPIRE when count === 1
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ result: 1 }),
        })
        // 3. SET track:<id>
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ result: 'OK' }),
        });

      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const headers = { 'x-forwarded-for': '198.51.100.7' };
      const firstRes = createMockRes();
      await trackHandler({ method: 'POST', headers, body: { data: sampleScore } }, firstRes);

      expect(firstRes.statusCode).toBe(200);
      expect(firstRes.getHeader('X-RateLimit-Limit')).toBe('30');
      expect(firstRes.getHeader('X-RateLimit-Remaining')).toBe('29');
      expect(fetchMock).toHaveBeenCalledTimes(3);

      const [pipelineUrl, pipelineInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(pipelineUrl).toBe('https://kv.example.test/pipeline');
      expect(pipelineInit.method).toBe('POST');
      expect(pipelineInit.headers).toEqual({
        Authorization: 'Bearer rl-token-secret',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(pipelineInit.body as string)).toEqual([
        ['INCR', 'ratelimit:track:198.51.100.7'],
        ['TTL', 'ratelimit:track:198.51.100.7'],
      ]);

      const [expireUrl, expireInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(expireUrl).toBe('https://kv.example.test');
      expect(JSON.parse(expireInit.body as string)).toEqual([
        'EXPIRE',
        'ratelimit:track:198.51.100.7',
        60,
      ]);

      // Clear local memory; Redis count > 30 still triggers persistent 429 with Retry-After
      _resetStoresForTest();

      const limitedFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ result: 31 }, { result: 42 }],
      });
      globalThis.fetch = limitedFetch as unknown as typeof globalThis.fetch;

      const limitedRes = createMockRes();
      await trackHandler({ method: 'POST', headers, body: { data: sampleScore } }, limitedRes);

      expect(limitedRes.statusCode).toBe(429);
      expect(limitedRes.getHeader('X-RateLimit-Limit')).toBe('30');
      expect(limitedRes.getHeader('X-RateLimit-Remaining')).toBe('0');
      expect(limitedRes.getHeader('Retry-After')).toBe('42');
      expect(limitedFetch).toHaveBeenCalledTimes(1);
    });

    it('fails open to in-memory rate limiting when Redis /pipeline throws or returns HTTP 500', async () => {
      process.env.KV_REST_API_URL = 'https://kv.example.test';
      process.env.KV_REST_API_TOKEN = 'rl-token-secret';

      // Sub-case A: fetch throws network error
      const throwingFetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
      globalThis.fetch = throwingFetch as unknown as typeof globalThis.fetch;

      expect(await checkCloudRateLimit('198.51.100.8', 'https://kv.example.test', 'rl-token-secret')).toBeNull();

      const okResAfterThrow = createMockRes();
      await trackHandler(
        { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.8' }, body: { data: sampleScore } },
        okResAfterThrow
      );
      expect(okResAfterThrow.statusCode).toBe(200);
      expect(okResAfterThrow.getHeader('X-RateLimit-Limit')).toBe('30');
      expect(okResAfterThrow.getHeader('X-RateLimit-Remaining')).toBe('29');

      // Sub-case B: /pipeline returns HTTP 500 -> falls back to local in-memory 30 req/min limit
      _resetStoresForTest();
      const err500Fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal Server Error' }),
      });
      globalThis.fetch = err500Fetch as unknown as typeof globalThis.fetch;

      expect(await checkCloudRateLimit('198.51.100.9', 'https://kv.example.test', 'rl-token-secret')).toBeNull();

      const ipHeaders = { 'x-forwarded-for': '198.51.100.9' };
      for (let i = 0; i < 30; i++) {
        const res = createMockRes();
        await trackHandler({ method: 'POST', headers: ipHeaders, body: { data: sampleScore } }, res);
        expect(res.statusCode).toBe(200);
        expect(res.getHeader('X-RateLimit-Remaining')).toBe(String(29 - i));
      }

      const fallbackLimitedRes = createMockRes();
      await trackHandler({ method: 'POST', headers: ipHeaders, body: { data: sampleScore } }, fallbackLimitedRes);
      expect(fallbackLimitedRes.statusCode).toBe(429);
      expect(fallbackLimitedRes.getHeader('X-RateLimit-Remaining')).toBe('0');
      expect(Number(fallbackLimitedRes.getHeader('Retry-After'))).toBeGreaterThanOrEqual(1);
    });
  });

  describe('api/health', () => {
    it('returns 200 with kvConfigured false when KV env vars are absent and true when present', async () => {
      const resUnconfigured = createMockRes();
      await healthHandler({ method: 'GET' }, resUnconfigured);
      expect(resUnconfigured.statusCode).toBe(200);
      const unconfBody = resUnconfigured.jsonBody as {
        status: string;
        kvConfigured: boolean;
        timestamp: string;
      };
      expect(unconfBody.status).toBe('ok');
      expect(unconfBody.kvConfigured).toBe(false);
      expect(Number.isNaN(Date.parse(unconfBody.timestamp))).toBe(false);

      process.env.KV_REST_API_URL = 'https://kv.example.test';
      process.env.KV_REST_API_TOKEN = 'token';

      const resConfigured = createMockRes();
      await healthHandler({ method: 'GET' }, resConfigured);
      expect(resConfigured.statusCode).toBe(200);
      const confBody = resConfigured.jsonBody as {
        status: string;
        kvConfigured: boolean;
        timestamp: string;
      };
      expect(confBody.status).toBe('ok');
      expect(confBody.kvConfigured).toBe(true);
      expect(Number.isNaN(Date.parse(confBody.timestamp))).toBe(false);
    });

    it('rejects POST with 405 and Allow: GET', async () => {
      const res = createMockRes();
      await healthHandler({ method: 'POST' }, res);
      expect(res.statusCode).toBe(405);
      expect(res.getHeader('Allow')).toBe('GET');
    });
  });
});
