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

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const env = typeof process !== 'undefined' ? process?.env : undefined;
  const kvUrl = env?.KV_REST_API_URL || env?.UPSTASH_REDIS_REST_URL;
  const kvToken = env?.KV_REST_API_TOKEN || env?.UPSTASH_REDIS_REST_TOKEN;

  return res.status(200).json({
    status: 'ok',
    kvConfigured: Boolean(kvUrl && kvToken),
    timestamp: new Date().toISOString(),
  });
}
