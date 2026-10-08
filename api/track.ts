import type { VercelRequest, VercelResponse } from '@vercel/node';

// In-memory cache across serverless warm invocations
const memoryStore = new Map<string, { data: string; createdAt: number }>();

function generateId(): string {
  // Short readable 8-character ID
  return Math.random().toString(36).substring(2, 10);
}

// Clean up old memory entries if exceeding limit
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // KV/Database storage credentials if configured in Vercel project environment
  // Supports Upstash Redis / Vercel KV REST API automatically
  const kvRestUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvRestToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  // GET: Fetch shared score by ID
  if (req.method === 'GET') {
    const id = (req.query.id as string) || '';
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Missing track id' });
    }

    // 1. Try Upstash / Vercel KV if available
    if (kvRestUrl && kvRestToken) {
      try {
        const resp = await fetch(`${kvRestUrl}/get/track:${encodeURIComponent(id)}`, {
          headers: {
            Authorization: `Bearer ${kvRestToken}`,
          },
        });
        if (resp.ok) {
          const json = await resp.json();
          if (json && json.result) {
            const parsed = typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
            return res.status(200).json({ data: parsed });
          }
        }
      } catch (err) {
        console.warn('KV fetch failed, checking local store:', err);
      }
    }

    // 2. Fallback to memory store
    const item = memoryStore.get(id);
    if (item) {
      try {
        const parsed = JSON.parse(item.data);
        return res.status(200).json({ data: parsed });
      } catch (e) {
        return res.status(200).json({ data: item.data });
      }
    }

    return res.status(404).json({ error: 'Track not found' });
  }

  // POST: Store score and return ID
  if (req.method === 'POST') {
    try {
      const body = req.body;
      const data = typeof body === 'string' ? JSON.parse(body) : body;

      if (!data || (!data.strokes && !data.data)) {
        return res.status(400).json({ error: 'Invalid score data payload' });
      }

      const scorePayload = data.data || data;
      const id = generateId();
      const stringified = JSON.stringify(scorePayload);

      // Save to Upstash / Vercel KV if configured
      if (kvRestUrl && kvRestToken) {
        try {
          await fetch(`${kvRestUrl}/set/track:${encodeURIComponent(id)}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${kvRestToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify([stringified]),
          });
        } catch (err) {
          console.warn('KV store error:', err);
        }
      }

      // Also save in memory
      pruneMemory();
      memoryStore.set(id, { data: stringified, createdAt: Date.now() });

      return res.status(200).json({ id });
    } catch (err) {
      console.error('Error storing track:', err);
      return res.status(500).json({ error: 'Internal server error storing track' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

