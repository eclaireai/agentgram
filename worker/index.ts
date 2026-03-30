/**
 * agentgram Download Counter — Cloudflare Worker
 *
 * Tracks recipe pulls anonymously. No IPs, no user data — only recipe ID and count.
 *
 * Routes:
 *   POST /track?id=<recipe-id>          increment pull counter
 *   GET  /stats?id=<recipe-id>          get count for one recipe
 *   GET  /stats                         top 50 by downloads
 *   POST /batch-stats  body: {ids:[]}   bulk fetch counts
 *
 * Deploy:
 *   npx wrangler deploy
 *
 * KV binding: DOWNLOAD_COUNTS (created via: wrangler kv namespace create DOWNLOAD_COUNTS)
 *
 * Set in wrangler.toml:
 *   [[kv_namespaces]]
 *   binding = "DOWNLOAD_COUNTS"
 *   id = "<your-namespace-id>"
 */

export interface Env {
  DOWNLOAD_COUNTS: KVNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ── POST /track?id=<recipe-id> ──────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/track') {
      const id = url.searchParams.get('id');
      if (!id || id.length > 128) return json({ error: 'invalid id' }, 400);

      // Atomic increment using KV
      const key = `pull:${id}`;
      const current = await env.DOWNLOAD_COUNTS.get(key);
      const count = (parseInt(current ?? '0', 10) || 0) + 1;
      await env.DOWNLOAD_COUNTS.put(key, String(count));

      // Also maintain a sorted index for "top recipes"
      const indexKey = 'index:top';
      const indexRaw = await env.DOWNLOAD_COUNTS.get(indexKey);
      const index: Record<string, number> = indexRaw ? JSON.parse(indexRaw) : {};
      index[id] = count;
      // Keep only top 200 to bound KV write size
      const trimmed = Object.fromEntries(
        Object.entries(index).sort((a, b) => b[1] - a[1]).slice(0, 200)
      );
      await env.DOWNLOAD_COUNTS.put(indexKey, JSON.stringify(trimmed));

      return json({ id, downloads: count });
    }

    // ── GET /stats?id=<recipe-id> ────────────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/stats') {
      const id = url.searchParams.get('id');

      if (id) {
        const count = await env.DOWNLOAD_COUNTS.get(`pull:${id}`);
        return json({ id, downloads: parseInt(count ?? '0', 10) });
      }

      // No id → return top 50
      const indexRaw = await env.DOWNLOAD_COUNTS.get('index:top');
      const index: Record<string, number> = indexRaw ? JSON.parse(indexRaw) : {};
      const top = Object.entries(index)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([recipeId, downloads]) => ({ id: recipeId, downloads }));

      return json({ recipes: top, total: Object.keys(index).length });
    }

    // ── POST /batch-stats  body: { ids: string[] } ──────────────────────────
    if (request.method === 'POST' && url.pathname === '/batch-stats') {
      let body: { ids?: unknown };
      try {
        body = await request.json() as { ids?: unknown };
      } catch {
        return json({ error: 'invalid json' }, 400);
      }

      if (!Array.isArray(body.ids) || body.ids.length > 100) {
        return json({ error: 'ids must be array of ≤ 100 strings' }, 400);
      }

      const ids = (body.ids as unknown[]).filter((i): i is string => typeof i === 'string');
      const counts = await Promise.all(
        ids.map(async (id) => {
          const val = await env.DOWNLOAD_COUNTS.get(`pull:${id}`);
          return { id, downloads: parseInt(val ?? '0', 10) };
        })
      );

      return json({ recipes: counts });
    }

    return json({ error: 'not found' }, 404);
  },
};
