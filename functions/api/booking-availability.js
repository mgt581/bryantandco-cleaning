export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!env.BOOKING_DB) {
    return json({ error: 'Booking availability is not configured', configured: false }, 503);
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from') || new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get('to') || from;
  if (!isDate(from) || !isDate(to) || to < from) return json({ error: 'Invalid date range' }, 400);

  const rows = await env.BOOKING_DB.prepare(`
    SELECT slot_date AS date, slot_time AS time
    FROM booking_occurrences
    WHERE slot_date BETWEEN ? AND ?
    ORDER BY slot_date, slot_time
  `).bind(from, to).all();

  return json({ configured: true, from, to, blocked: rows.results || [] });
}

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
