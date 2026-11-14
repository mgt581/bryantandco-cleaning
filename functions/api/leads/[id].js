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

// --- Cloudflare Access JWT verification ---------------------------------
// Access puts a signed JWT in the Cf-Access-Jwt-Assertion header (and the
// CF_Authorization cookie). Only a token whose RS256 signature verifies
// against the team's published keys, with the right audience, issuer and
// expiry, counts as signed in. The mere presence of a header or cookie
// must never grant access: the pages.dev hostname is not behind Access.
var ACCESS_DEFAULT_TEAM_DOMAIN = "https://mrwhite.cloudflareaccess.com";
var ACCESS_DEFAULT_AUD = "727f3cedecffbd2f27464ee3a38301a206f008487e4ccef2cebc0e6e4c12fa02";
var accessKeyCache = { url: "", fetchedAt: 0, keys: [] };

function accessBase64UrlToBytes(value) {
  var base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function accessDecodeJson(segment) {
  return JSON.parse(new TextDecoder().decode(accessBase64UrlToBytes(segment)));
}

function accessTokenFromRequest(request) {
  var header = String(request.headers.get("cf-access-jwt-assertion") || "").trim();
  if (header) return header;
  var cookies = String(request.headers.get("cookie") || "").split(";");
  for (var i = 0; i < cookies.length; i += 1) {
    var part = cookies[i].trim();
    var eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).toLowerCase() === "cf_authorization") return part.slice(eq + 1).trim();
  }
  return "";
}

async function accessSigningKeys(teamDomain) {
  var url = teamDomain + "/cdn-cgi/access/certs";
  if (accessKeyCache.url === url && Date.now() - accessKeyCache.fetchedAt < 3600000 && accessKeyCache.keys.length) {
    return accessKeyCache.keys;
  }
  var response = await fetch(url);
  if (!response.ok) throw new Error("Could not load Access signing keys");
  var body = await response.json();
  accessKeyCache = { url: url, fetchedAt: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
  return accessKeyCache.keys;
}

async function hasConfiguredAccessAuth(request, env) {
  if (String(env.CLOUDFLARE_ACCESS_ENABLED || "").trim().toLowerCase() !== "true") return false;
  var token = accessTokenFromRequest(request);
  var parts = token.split(".");
  if (parts.length !== 3) return false;

  try {
    var teamDomain = String(env.CLOUDFLARE_ACCESS_TEAM_DOMAIN || ACCESS_DEFAULT_TEAM_DOMAIN).trim().replace(/\/+$/, "");
    var audience = String(env.CLOUDFLARE_ACCESS_AUD || ACCESS_DEFAULT_AUD).trim();
    var header = accessDecodeJson(parts[0]);
    var payload = accessDecodeJson(parts[1]);
    if (header.alg !== "RS256" || !header.kid) return false;

    var keys = await accessSigningKeys(teamDomain);
    var jwk = keys.find(function(key) { return key.kid === header.kid; });
    if (!jwk) return false;

    var key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    var valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      accessBase64UrlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!valid) return false;

    var now = Math.floor(Date.now() / 1000);
    var audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (audiences.indexOf(audience) === -1) return false;
    if (payload.iss !== teamDomain) return false;
    if (typeof payload.exp !== "number" || payload.exp <= now) return false;
    if (typeof payload.nbf === "number" && payload.nbf > now + 60) return false;
    return true;
  } catch (error) {
    return false;
  }
}
// --- end Cloudflare Access JWT verification -----------------------------

async function hasAdminAuth(request, env) {
  if (await hasConfiguredAccessAuth(request, env)) return true;
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
  if (!(await hasAdminAuth(context.request, env))) {
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
