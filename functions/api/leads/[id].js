var ALLOWED_STATUSES = ["TEST", "NEW", "GENUINE", "SPAM", "CONTACTED", "QUOTED", "WON", "LOST"];

function clean(value) {
  return String(value || "").trim();
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function hasConfiguredAccessAuth(request, env) {
  if (clean(env.CLOUDFLARE_ACCESS_ENABLED).toLowerCase() !== "true") return false;
  if (clean(request.headers.get("cf-access-jwt-assertion"))) return true;
  return clean(request.headers.get("cookie")).toLowerCase().indexOf("cf_authorization=") !== -1;
}

function hasAdminAuth(request, env) {
  if (hasConfiguredAccessAuth(request, env)) return true;
  var configured = clean(env.LEADS_EXPORT_TOKEN);
  var authorization = clean(request.headers.get("authorization"));
  var bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  return Boolean(configured && bearer && bearer === configured);
}

function nonNegativeInteger(value) {
  var number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

async function ensurePipelineColumns(db) {
  var result = await db.prepare("PRAGMA table_info(leads)").all();
  var columns = new Set((result.results || []).map(function(item) { return item.name; }));
  var additions = [
    ["lead_status", "TEXT NOT NULL DEFAULT 'NEW'"],
    ["quote_value_pence", "INTEGER NOT NULL DEFAULT 0"],
    ["won_revenue_pence", "INTEGER NOT NULL DEFAULT 0"],
    ["status_updated_at", "TEXT"]
  ];

  for (var index = 0; index < additions.length; index += 1) {
    if (!columns.has(additions[index][0])) {
      await db.prepare("ALTER TABLE leads ADD COLUMN " + additions[index][0] + " " + additions[index][1]).run();
    }
  }
}

export async function onRequestPatch(context) {
  var env = context.env || {};
  if (!hasAdminAuth(context.request, env)) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }
  if (!env.LEADS_DB) {
    return jsonResponse({ ok: false, error: "Lead database is not configured." }, 503);
  }

  var leadId = Number(context.params && context.params.id);
  if (!Number.isSafeInteger(leadId) || leadId < 1) {
    return jsonResponse({ ok: false, error: "Invalid lead id." }, 400);
  }

  var payload;
  try {
    payload = await context.request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  var status = clean(payload.lead_status).toUpperCase();
  var quoteValue = nonNegativeInteger(payload.quote_value_pence);
  var wonRevenue = nonNegativeInteger(payload.won_revenue_pence);
  if (ALLOWED_STATUSES.indexOf(status) === -1) {
    return jsonResponse({ ok: false, error: "Unsupported lead status." }, 400);
  }
  if (quoteValue === null || wonRevenue === null) {
    return jsonResponse({ ok: false, error: "Quote and revenue values must be non-negative whole pence." }, 400);
  }

  await ensurePipelineColumns(env.LEADS_DB);
  var updatedAt = new Date().toISOString();
  var result = await env.LEADS_DB.prepare(
    `UPDATE leads
    SET lead_status = ?, quote_value_pence = ?, won_revenue_pence = ?, status_updated_at = ?
    WHERE id = ?`
  ).bind(status, quoteValue, wonRevenue, updatedAt, leadId).run();

  var changes = result && result.meta ? Number(result.meta.changes || 0) : 0;
  if (!changes) {
    return jsonResponse({ ok: false, error: "Lead not found." }, 404);
  }

  return jsonResponse({
    ok: true,
    lead: {
      id: leadId,
      lead_status: status,
      quote_value_pence: quoteValue,
      won_revenue_pence: wonRevenue,
      status_updated_at: updatedAt
    }
  }, 200);
}

export async function onRequest(context) {
  if (context.request.method !== "PATCH") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }
  return onRequestPatch(context);
}
