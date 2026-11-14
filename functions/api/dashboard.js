function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
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

function clean(value) {
  return String(value || "").trim();
}

function countValue(rows, key) {
  if (!rows.length) return 0;
  var value = rows[0][key];
  return Number(value || 0);
}

function normalizedOriginSql(columnName) {
  return [
    "CASE",
    "  WHEN COALESCE(NULLIF(" + columnName + ", ''), '') <> '' AND LOWER(" + columnName + ") LIKE '%facebook.com%' THEN 'facebook'",
    "  WHEN COALESCE(NULLIF(" + columnName + ", ''), '') <> '' AND LOWER(" + columnName + ") LIKE '%fb.com%' THEN 'facebook'",
    "  WHEN COALESCE(NULLIF(" + columnName + ", ''), '') <> '' AND LOWER(" + columnName + ") LIKE '%instagram.com%' THEN 'instagram'",
    "  WHEN COALESCE(NULLIF(" + columnName + ", ''), '') <> '' AND (LOWER(" + columnName + ") LIKE '%google.%' OR LOWER(" + columnName + ") LIKE '%google.com%' OR LOWER(" + columnName + ") LIKE '%g.co%') THEN 'google'",
    "  WHEN COALESCE(NULLIF(" + columnName + ", ''), '') <> '' AND LOWER(" + columnName + ") LIKE '%bing.com%' THEN 'bing'",
    "  WHEN COALESCE(NULLIF(" + columnName + ", ''), '') <> '' AND LOWER(" + columnName + ") LIKE '%linkedin.com%' THEN 'linkedin'",
    "  WHEN COALESCE(NULLIF(" + columnName + ", ''), '') <> '' AND (LOWER(" + columnName + ") LIKE '%twitter.com%' OR LOWER(" + columnName + ") LIKE '%x.com%') THEN 'x / twitter'",
    "  WHEN COALESCE(NULLIF(" + columnName + ", ''), '') <> '' AND (LOWER(" + columnName + ") LIKE '%whatsapp.com%' OR LOWER(" + columnName + ") LIKE '%wa.me%') THEN 'whatsapp'",
    "  WHEN COALESCE(NULLIF(" + columnName + ", ''), '') <> '' AND (LOWER(" + columnName + ") LIKE '%youtube.com%' OR LOWER(" + columnName + ") LIKE '%youtu.be%') THEN 'youtube'",
    "  ELSE " + columnName,
    "END"
  ].join("\n");
}

async function queryAll(db, sql) {
  var result = await db.prepare(sql).all();
  return result.results || [];
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

async function ensureDashboardSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submitted_at TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      postcode TEXT,
      service TEXT,
      timeframe TEXT,
      message TEXT,
      page TEXT,
      source TEXT,
      marketing_consent INTEGER NOT NULL DEFAULT 0,
      delivery_status TEXT NOT NULL DEFAULT 'pending',
      delivery_errors TEXT,
      lead_status TEXT NOT NULL DEFAULT 'NEW',
      quote_value_pence INTEGER NOT NULL DEFAULT 0,
      won_revenue_pence INTEGER NOT NULL DEFAULT 0,
      status_updated_at TEXT,
      user_agent TEXT,
      ip_hash TEXT,
      landing_page TEXT,
      referrer TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT,
      gclid TEXT,
      fbclid TEXT,
      msclkid TEXT,
      session_id TEXT,
      client_id TEXT,
      form_name TEXT,
      property_size TEXT,
      booking_id TEXT
    )`
  ).run();
  await ensurePipelineColumns(db);
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_submitted_at ON leads (submitted_at DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_source ON leads (source)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (lead_status)").run();

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
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_lead_events_event_name ON lead_events (event_name)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_lead_events_session_id ON lead_events (session_id)").run();
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

async function requireDashboardAccess(context) {
  var env = context.env || {};
  var configured = clean(env.LEADS_EXPORT_TOKEN);
  var authHeader = clean(context.request.headers.get("authorization"));
  var bearerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  var requestToken = bearerToken;

  if (await hasConfiguredAccessAuth(context.request, env)) {
    return { ok: true, mode: "access" };
  }

  if (!configured) {
    return { ok: false, status: 503, error: "Dashboard access is not configured." };
  }

  if (!requestToken || requestToken !== configured) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  return { ok: true, mode: "token" };
}

export async function onRequestGet(context) {
  try {
    var access = await requireDashboardAccess(context);
    if (!access.ok) {
      return textResponse(access.error, access.status);
    }

    var env = context.env || {};
    if (!env.LEADS_DB) {
      return textResponse("Lead database is not configured.", 503);
    }

    await ensureDashboardSchema(env.LEADS_DB);

    var totalsRows = await queryAll(
      env.LEADS_DB,
      `SELECT
        COUNT(*) AS total_leads,
        SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) AS delivered_leads,
        SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) AS failed_leads,
        SUM(CASE WHEN lead_status = 'WON' THEN 1 ELSE 0 END) AS won_leads,
        SUM(quote_value_pence) AS quoted_value_pence,
        SUM(won_revenue_pence) AS won_revenue_pence
      FROM leads`
    );

    var pipelineRows = await queryAll(
      env.LEADS_DB,
      `SELECT lead_status AS status, COUNT(*) AS count
      FROM leads
      GROUP BY lead_status
      ORDER BY count DESC, lead_status ASC`
    );

    var eventTotalsRows = await queryAll(
      env.LEADS_DB,
      `SELECT event_name, COUNT(*) AS count
      FROM lead_events
      GROUP BY event_name
      ORDER BY count DESC, event_name ASC`
    );

    var originRows = await queryAll(
      env.LEADS_DB,
      `SELECT
        CASE
          WHEN COALESCE(NULLIF(utm_source, ''), '') <> '' THEN LOWER(utm_source)
          WHEN COALESCE(NULLIF(fbclid, ''), '') <> '' THEN 'facebook'
          WHEN COALESCE(NULLIF(gclid, ''), '') <> '' THEN 'google'
          WHEN COALESCE(NULLIF(msclkid, ''), '') <> '' THEN 'bing'
          WHEN COALESCE(NULLIF(referrer, ''), '') <> '' THEN ${normalizedOriginSql("referrer")}
          WHEN COALESCE(NULLIF(source, ''), '') <> '' AND LOWER(source) <> 'website' THEN LOWER(source)
          ELSE 'direct / unknown'
        END AS origin,
        COUNT(*) AS count
      FROM leads
      GROUP BY
        CASE
          WHEN COALESCE(NULLIF(utm_source, ''), '') <> '' THEN LOWER(utm_source)
          WHEN COALESCE(NULLIF(fbclid, ''), '') <> '' THEN 'facebook'
          WHEN COALESCE(NULLIF(gclid, ''), '') <> '' THEN 'google'
          WHEN COALESCE(NULLIF(msclkid, ''), '') <> '' THEN 'bing'
          WHEN COALESCE(NULLIF(referrer, ''), '') <> '' THEN ${normalizedOriginSql("referrer")}
          WHEN COALESCE(NULLIF(source, ''), '') <> '' AND LOWER(source) <> 'website' THEN LOWER(source)
          ELSE 'direct / unknown'
        END
      ORDER BY count DESC, origin ASC
      LIMIT 10`
    );

    var serviceRows = await queryAll(
      env.LEADS_DB,
      `SELECT
        COALESCE(NULLIF(service, ''), 'Website enquiry') AS service,
        COUNT(*) AS count
      FROM leads
      GROUP BY COALESCE(NULLIF(service, ''), 'Website enquiry')
      ORDER BY count DESC, service ASC
      LIMIT 10`
    );

    var revenueOriginRows = await queryAll(
      env.LEADS_DB,
      `SELECT
        CASE
          WHEN COALESCE(NULLIF(utm_source, ''), '') <> '' THEN LOWER(utm_source)
          WHEN COALESCE(NULLIF(fbclid, ''), '') <> '' THEN 'facebook'
          WHEN COALESCE(NULLIF(gclid, ''), '') <> '' THEN 'google'
          WHEN COALESCE(NULLIF(msclkid, ''), '') <> '' THEN 'bing'
          WHEN COALESCE(NULLIF(referrer, ''), '') <> '' THEN ${normalizedOriginSql("referrer")}
          WHEN COALESCE(NULLIF(source, ''), '') <> '' AND LOWER(source) <> 'website' THEN LOWER(source)
          ELSE 'direct / unknown'
        END AS origin,
        COUNT(*) AS leads,
        SUM(CASE WHEN lead_status = 'WON' THEN 1 ELSE 0 END) AS won_leads,
        SUM(quote_value_pence) AS quote_value_pence,
        SUM(won_revenue_pence) AS won_revenue_pence
      FROM leads
      GROUP BY
        CASE
          WHEN COALESCE(NULLIF(utm_source, ''), '') <> '' THEN LOWER(utm_source)
          WHEN COALESCE(NULLIF(fbclid, ''), '') <> '' THEN 'facebook'
          WHEN COALESCE(NULLIF(gclid, ''), '') <> '' THEN 'google'
          WHEN COALESCE(NULLIF(msclkid, ''), '') <> '' THEN 'bing'
          WHEN COALESCE(NULLIF(referrer, ''), '') <> '' THEN ${normalizedOriginSql("referrer")}
          WHEN COALESCE(NULLIF(source, ''), '') <> '' AND LOWER(source) <> 'website' THEN LOWER(source)
          ELSE 'direct / unknown'
        END
      ORDER BY won_revenue_pence DESC, leads DESC, origin ASC
      LIMIT 10`
    );

    var landingPageRows = await queryAll(
      env.LEADS_DB,
      `SELECT
        COALESCE(NULLIF(landing_page, ''), COALESCE(NULLIF(page, ''), 'Unknown')) AS landing_page,
        COUNT(*) AS count
      FROM lead_events
      WHERE event_name IN ('page_view', 'quote_cta_click', 'phone_click', 'whatsapp_click', 'email_click', 'lead_form_submit_attempt', 'lead_form_error', 'generate_lead', 'chat_lead', 'chat_lead_error')
      GROUP BY COALESCE(NULLIF(landing_page, ''), COALESCE(NULLIF(page, ''), 'Unknown'))
      ORDER BY count DESC, landing_page ASC
      LIMIT 10`
    );

    var dailyRows = await queryAll(
      env.LEADS_DB,
      `SELECT
        SUBSTR(submitted_at, 1, 10) AS day,
        COUNT(*) AS count
      FROM leads
      GROUP BY day
      ORDER BY day DESC
      LIMIT 14`
    );

    var recentLeads = await queryAll(
      env.LEADS_DB,
      `SELECT
        id,
        submitted_at,
        name,
        phone,
        email,
        postcode,
        service,
        timeframe,
        page,
        source,
        landing_page,
        referrer,
        utm_source,
        utm_medium,
        utm_campaign,
        delivery_status,
        delivery_errors,
        lead_status,
        quote_value_pence,
        won_revenue_pence,
        status_updated_at
      FROM leads
      ORDER BY submitted_at DESC
      LIMIT 12`
    );

    var recentEvents = await queryAll(
      env.LEADS_DB,
      `SELECT
        occurred_at,
        event_name,
        page,
        landing_page,
        link_text,
        link_url,
        source,
        medium,
        campaign,
        service
      FROM lead_events
      ORDER BY occurred_at DESC
      LIMIT 20`
    );

    var recentEventsWithCount = {};
    for (var i = 0; i < eventTotalsRows.length; i += 1) {
      recentEventsWithCount[eventTotalsRows[i].event_name] = Number(eventTotalsRows[i].count || 0);
    }

    return jsonResponse({
      ok: true,
      generated_at: new Date().toISOString(),
      totals: {
        leads: countValue(totalsRows, "total_leads"),
        delivered_leads: countValue(totalsRows, "delivered_leads"),
        failed_leads: countValue(totalsRows, "failed_leads"),
        won_leads: countValue(totalsRows, "won_leads"),
        quoted_value_pence: countValue(totalsRows, "quoted_value_pence"),
        won_revenue_pence: countValue(totalsRows, "won_revenue_pence")
      },
      event_totals: recentEventsWithCount,
      origin_summary: originRows,
      revenue_origin_summary: revenueOriginRows,
      pipeline_summary: pipelineRows,
      service_summary: serviceRows,
      landing_page_summary: landingPageRows,
      daily_leads: dailyRows,
      recent_leads: recentLeads,
      recent_events: recentEvents
    }, 200);
  } catch (error) {
    return textResponse("Could not load the dashboard.", 500);
  }
}
