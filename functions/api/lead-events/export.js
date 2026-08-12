function clean(value) {
  return String(value || "").trim();
}

function hasConfiguredAccessAuth(request, env) {
  if (clean(env.CLOUDFLARE_ACCESS_ENABLED).toLowerCase() !== "true") return false;

  var headers = request.headers;
  var accessJwt = clean(headers.get("cf-access-jwt-assertion"));
  if (accessJwt) return true;

  var cookieHeader = clean(headers.get("cookie")).toLowerCase();
  if (cookieHeader.indexOf("cf_authorization=") !== -1) return true;

  return false;
}

function textResponse(body, status) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function csvEscape(value) {
  var text = String(value == null ? "" : value);
  if (/[",\n\r]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function csvResponse(rows) {
  var headers = [
    "occurred_at",
    "event_name",
    "page",
    "landing_page",
    "referrer",
    "source",
    "medium",
    "campaign",
    "term",
    "content",
    "gclid",
    "fbclid",
    "msclkid",
    "service",
    "link_url",
    "link_text",
    "phone_number",
    "whatsapp_number",
    "session_id",
    "client_id"
  ];

  var lines = [headers.join(",")];
  rows.forEach(function(row) {
    lines.push(headers.map(function(header) {
      return csvEscape(row[header]);
    }).join(","));
  });

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="bryant-and-co-lead-events.csv"',
      "cache-control": "no-store"
    }
  });
}

async function ensureLeadEventExportSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS lead_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      event_name TEXT NOT NULL,
      page TEXT,
      landing_page TEXT,
      referrer TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      term TEXT,
      content TEXT,
      gclid TEXT,
      fbclid TEXT,
      msclkid TEXT,
      service TEXT,
      link_url TEXT,
      link_text TEXT,
      phone_number TEXT,
      whatsapp_number TEXT,
      session_id TEXT,
      client_id TEXT,
      user_agent TEXT,
      ip_hash TEXT
    )`
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_lead_events_occurred_at ON lead_events (occurred_at DESC)").run();
}

export async function onRequestGet(context) {
  var env = context.env || {};
  var token = clean(env.LEADS_EXPORT_TOKEN);
  var authHeader = clean(context.request.headers.get("authorization"));
  var bearerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  var requestToken = bearerToken;

  if (hasConfiguredAccessAuth(context.request, env)) {
    requestToken = token;
  }

  if (!token) {
    return textResponse("Lead event export is not configured.", 503);
  }

  if (!requestToken || requestToken !== token) {
    return textResponse("Unauthorized.", 401);
  }

  if (!env.LEADS_DB) {
    return textResponse("Lead database is not configured.", 503);
  }

  await ensureLeadEventExportSchema(env.LEADS_DB);

  var result = await env.LEADS_DB.prepare(
    `SELECT
      occurred_at,
      event_name,
      page,
      landing_page,
      referrer,
      source,
      medium,
      campaign,
      term,
      content,
      gclid,
      fbclid,
      msclkid,
      service,
      link_url,
      link_text,
      phone_number,
      whatsapp_number,
      session_id,
      client_id
    FROM lead_events
    ORDER BY occurred_at DESC
    LIMIT 5000`
  ).all();

  return csvResponse(result.results || []);
}
