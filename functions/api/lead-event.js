function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function clean(value) {
  return String(value || "").trim().slice(0, 1000);
}

async function hashIp(ip) {
  if (!ip || !crypto.subtle) return "";
  var data = new TextEncoder().encode(ip);
  var digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(function(byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

async function ensureLeadEventSchema(db) {
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

function allowedEventName(value) {
  var name = clean(value);
  return [
    "page_view",
    "quote_cta_click",
    "phone_click",
    "whatsapp_click",
    "email_click",
    "chat_open",
    "chat_question",
    "chat_lead",
    "chat_lead_error",
    "lead_form_submit_attempt",
    "lead_form_error",
    "lead_delivery_failed",
    "generate_lead",
    "lead_thank_you_view"
  ].indexOf(name) !== -1 ? name : "";
}

function inferredEventSource(payload) {
  var utmSource = clean(payload.utm_source).toLowerCase();
  var suppliedSource = clean(payload.source).toLowerCase();
  var referrer = clean(payload.referrer).toLowerCase();

  if (utmSource) return utmSource;
  if (payload.fbclid || referrer.indexOf('facebook.com') !== -1 || referrer.indexOf('fb.com') !== -1) return 'facebook';
  if (referrer.indexOf('instagram.com') !== -1) return 'instagram';
  if (payload.gclid || referrer.indexOf('google.') !== -1 || referrer.indexOf('g.co') !== -1) return 'google';
  if (payload.msclkid || referrer.indexOf('bing.com') !== -1) return 'bing';
  if (referrer.indexOf('linkedin.com') !== -1) return 'linkedin';
  if (referrer.indexOf('twitter.com') !== -1 || referrer.indexOf('x.com') !== -1) return 'x / twitter';
  if (referrer.indexOf('whatsapp.com') !== -1 || referrer.indexOf('wa.me') !== -1) return 'whatsapp';
  if (suppliedSource && suppliedSource !== 'website') return suppliedSource;
  return 'direct / unknown';
}

export async function onRequestPost(context) {
  try {
    var env = context.env || {};
    if (!env.LEADS_DB) {
      return jsonResponse({ ok: false, error: "Lead event database is not configured." }, 503);
    }

    var payload = await context.request.json();
    var eventName = allowedEventName(payload.event_name || payload.event);

    if (!eventName) {
      return jsonResponse({ ok: false, error: "Unsupported event." }, 400);
    }

    var ipHash = await hashIp(context.request.headers.get("cf-connecting-ip") || "");
    var userAgent = clean(context.request.headers.get("user-agent"));

    await ensureLeadEventSchema(env.LEADS_DB);

    await env.LEADS_DB.prepare(
      `INSERT INTO lead_events (
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
        client_id,
        user_agent,
        ip_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      new Date().toISOString(),
      eventName,
      clean(payload.page),
      clean(payload.landing_page),
      clean(payload.referrer),
      inferredEventSource(payload),
      clean(payload.utm_medium || payload.medium),
      clean(payload.utm_campaign || payload.campaign),
      clean(payload.utm_term || payload.term),
      clean(payload.utm_content || payload.content),
      clean(payload.gclid),
      clean(payload.fbclid),
      clean(payload.msclkid),
      clean(payload.service),
      clean(payload.link_url),
      clean(payload.link_text),
      clean(payload.phone_number),
      clean(payload.whatsapp_number),
      clean(payload.session_id),
      clean(payload.client_id),
      userAgent,
      ipHash
    ).run();

    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    return jsonResponse({ ok: false, error: "Could not store lead event." }, 500);
  }
}

export function onRequestGet() {
  return jsonResponse({ ok: false, error: "Use POST to store a lead event." }, 405);
}
