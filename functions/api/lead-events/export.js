function clean(value) {
  return String(value || "").trim();
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

  if (await hasConfiguredAccessAuth(context.request, env)) {
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
