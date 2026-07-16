export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  if (!env.BOOKING_DB) {
    return json({ error: 'Reviews are not configured', reviews: [] }, 503);
  }

  try {
    await ensureReviewSchema(env.BOOKING_DB);
    const rows = await env.BOOKING_DB.prepare(`
      SELECT first_name, last_name, rating, message, created_at
      FROM reviews
      WHERE published = 1
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    return json({ reviews: rows.results || [] });
  } catch (_) {
    return json({ error: 'Reviews are temporarily unavailable', reviews: [] }, 503);
  }
}

async function ensureReviewSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT,
      email TEXT,
      rating INTEGER NOT NULL,
      message TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS reviews_created_at_idx ON reviews(created_at)').run();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders())
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
