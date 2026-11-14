import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function importSource(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const sendLeadApi = await importSource("../functions/api/send-lead.js");
const leadEventApi = await importSource("../functions/api/lead-event.js");
const dashboardApi = await importSource("../functions/api/dashboard.js");
const leadsExportApi = await importSource("../functions/api/leads/export.js");
const leadEventsExportApi = await importSource("../functions/api/lead-events/export.js");
const leadUpdateApi = await importSource("../functions/api/leads/[id].js");

function request(url, body, method = "POST", headers = {}) {
  return new Request(url, {
    method,
    headers: Object.assign({ "content-type": "application/json" }, headers),
    body: body == null ? undefined : JSON.stringify(body)
  });
}

function captureDb() {
  const rows = {
    leads: [],
    events: []
  };

  return {
    rows,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              if (sql.includes("INSERT INTO leads")) rows.leads.push(values);
              if (sql.includes("INSERT INTO lead_events")) rows.events.push(values);
              return { success: true, meta: { changes: sql.includes("UPDATE leads") ? 1 : 0 } };
            }
          };
        },
        async run() {
          return { success: true };
        },
        async all() {
          if (sql.includes("COUNT(*) AS total_leads")) {
            return { results: [{ total_leads: rows.leads.length, delivered_leads: rows.leads.length, failed_leads: 0, won_leads: 0, quoted_value_pence: 0, won_revenue_pence: 0 }] };
          }
          if (sql.includes("GROUP BY event_name")) {
            return { results: [{ event_name: "page_view", count: 1 }, { event_name: "generate_lead", count: rows.events.length }] };
          }
          if (sql.includes("AS origin") && sql.includes("FROM leads")) {
            return { results: [{ origin: "facebook", count: 1 }] };
          }
          if (sql.includes("AS service") && sql.includes("FROM leads")) {
            return { results: [{ service: "Domestic Cleaning", count: 1 }] };
          }
          if (sql.includes("AS landing_page") && sql.includes("FROM lead_events")) {
            return { results: [{ landing_page: "https://example.test/?utm_source=facebook", count: 1 }] };
          }
          if (sql.includes("SUBSTR(submitted_at, 1, 10)")) {
            return { results: [{ day: "2026-08-11", count: 1 }] };
          }
          if (sql.includes("FROM leads") && sql.includes("ORDER BY submitted_at DESC")) {
            return {
              results: [{
                submitted_at: "2026-08-11T12:00:00.000Z",
                id: 1,
                name: "Test Customer",
                phone: "07000000000",
                email: "lead@example.test",
                postcode: "BH1 1AA",
                service: "Domestic Cleaning",
                timeframe: "This week",
                message: "Please quote.",
                page: "https://example.test/contact.html",
                source: "facebook",
                landing_page: "https://example.test/?utm_source=facebook",
                referrer: "https://facebook.com/",
                utm_source: "facebook",
                utm_medium: "social",
                utm_campaign: "test",
                utm_term: "",
                utm_content: "",
                gclid: "",
                fbclid: "",
                msclkid: "",
                session_id: "session-1",
                client_id: "client-1",
                form_name: "Quote request form",
                property_size: "2bed",
                booking_id: "",
                marketing_consent: 1,
                delivery_status: "delivered",
                delivery_errors: "",
                lead_status: "NEW",
                quote_value_pence: 0,
                won_revenue_pence: 0,
                status_updated_at: ""
              }]
            };
          }
          if (sql.includes("FROM lead_events") && sql.includes("ORDER BY occurred_at DESC")) {
            return {
              results: [{
                occurred_at: "2026-08-11T12:00:00.000Z",
                event_name: "page_view",
                page: "https://example.test/",
                landing_page: "https://example.test/",
                link_text: "",
                link_url: "",
                source: "facebook",
                medium: "social",
                campaign: "test",
                service: ""
              }]
            };
          }
          return { results: [] };
        }
      };
    }
  };
}

test("send-lead stores enquiry attribution and delivery status", async () => {
  const originalFetch = globalThis.fetch;
  const db = captureDb();
  globalThis.fetch = async () => new Response("", { status: 200 });

  try {
    const response = await sendLeadApi.onRequest({
      env: {
        RESEND_API_KEY: "test-key",
        LEAD_TO_EMAILS: "owner@example.test",
        LEAD_FROM_EMAIL: "Bryant & Co Cleaning <info@example.test>",
        LEADS_DB: db
      },
      request: request("https://example.test/api/send-lead", {
        form_name: "Quote request form",
        first_name: "Test",
        last_name: "Customer",
        phone: "07000000000",
        email: "lead@example.test",
        postcode: "BH1 1AA",
        service: "Domestic Cleaning",
        property_size: "2bed",
        message: "Please quote.",
        marketing_consent: "yes",
        page: "https://example.test/contact.html",
        landing_page: "https://example.test/?utm_source=facebook",
        referrer: "https://facebook.com/",
        utm_source: "facebook",
        utm_medium: "social",
        utm_campaign: "test",
        session_id: "session-1",
        client_id: "client-1"
      })
    });

    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(db.rows.leads.length, 1);
    assert.equal(db.rows.events.length, 1);
    assert.equal(db.rows.leads[0][17], "facebook");
    assert.equal(db.rows.leads[0][19], "test");
    assert.equal(db.rows.leads[0][27], "Quote request form");
    assert.equal(db.rows.events[0][1], "generate_lead");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("send-lead retains commercial and partner application details", async () => {
  const originalFetch = globalThis.fetch;
  const db = captureDb();
  globalThis.fetch = async () => new Response("", { status: 200 });

  try {
    const response = await sendLeadApi.onRequest({
      env: {
        RESEND_API_KEY: "test-key",
        LEAD_TO_EMAILS: "owner@example.test",
        LEADS_DB: db
      },
      request: request("https://example.test/api/send-lead", {
        form_name: "Cleaning partner application form",
        service: "Cleaning Partner Application",
        company_name: "Example Cleaning Ltd",
        contact_name: "Alex Example",
        email: "partner@example.test",
        phone: "07000000000",
        areas_covered: "South West",
        public_liability: "Yes",
        rams_capability: "Yes"
      })
    });

    assert.equal(response.status, 200);
    assert.equal(db.rows.leads[0][1], "Alex Example");
    assert.deepEqual(JSON.parse(db.rows.leads[0][30]), {
      company_name: "Example Cleaning Ltd",
      contact_name: "Alex Example",
      areas_covered: "South West",
      public_liability: "Yes",
      rams_capability: "Yes"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("lead-event stores supported tracking events", async () => {
  const db = captureDb();
  const response = await leadEventApi.onRequestPost({
    env: { LEADS_DB: db },
    request: request("https://example.test/api/lead-event", {
      event_name: "whatsapp_click",
      page: "https://example.test/",
      landing_page: "https://example.test/?utm_source=facebook",
      referrer: "https://facebook.com/",
      source: "facebook",
      medium: "social",
      campaign: "test",
      link_url: "https://wa.me/447843969254",
      link_text: "WhatsApp",
      whatsapp_number: "447843969254",
      session_id: "session-1",
      client_id: "client-1"
    })
  });

  assert.equal(response.status, 200);
  assert.equal(db.rows.events.length, 1);
  assert.equal(db.rows.events[0][1], "whatsapp_click");
  assert.equal(db.rows.events[0][5], "facebook");
});

test("plain-domain Facebook visits retain Facebook attribution", async () => {
  const originalFetch = globalThis.fetch;
  const db = captureDb();
  globalThis.fetch = async () => new Response("", { status: 200 });

  try {
    const response = await sendLeadApi.onRequest({
      env: {
        RESEND_API_KEY: "test-key",
        LEAD_TO_EMAILS: "owner@example.test",
        LEAD_FROM_EMAIL: "Bryant & Co Cleaning <info@example.test>",
        LEADS_DB: db
      },
      request: request("https://example.test/api/send-lead", {
        first_name: "Facebook",
        last_name: "Visitor",
        email: "facebook@example.test",
        service: "Domestic Cleaning",
        page: "https://example.test/contact",
        landing_page: "https://example.test/",
        referrer: "https://m.facebook.com/",
        source: "website",
        session_id: "session-facebook",
        client_id: "client-facebook"
      })
    });

    assert.equal(response.status, 200);
    assert.equal(db.rows.leads[0][9], "facebook");

    const eventResponse = await leadEventApi.onRequestPost({
      env: { LEADS_DB: db },
      request: request("https://example.test/api/lead-event", {
        event_name: "page_view",
        page: "https://example.test/",
        landing_page: "https://example.test/",
        referrer: "https://lm.facebook.com/",
        source: "website",
        session_id: "session-facebook",
        client_id: "client-facebook"
      })
    });

    assert.equal(eventResponse.status, 200);
    assert.equal(db.rows.events.at(-1)[5], "facebook");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const ACCESS_TEAM = "https://team.example.cloudflareaccess.com";
const ACCESS_AUD = "test-audience-tag";

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessKeyPair(kid) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kid, kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" } };
}

async function signAccessJwt(keyPair, claims) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: keyPair.kid, typ: "JWT" }));
  const payload = base64Url(JSON.stringify(Object.assign({ aud: [ACCESS_AUD], iss: ACCESS_TEAM, iat: now, nbf: now, exp: now + 600, email: "owner@example.test" }, claims)));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

test("dashboard and exports support private Access auth and reject missing auth", async () => {
  const db = captureDb();
  const env = {
    LEADS_DB: db,
    LEADS_EXPORT_TOKEN: "secret-token",
    CLOUDFLARE_ACCESS_ENABLED: "true",
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: ACCESS_TEAM,
    CLOUDFLARE_ACCESS_AUD: ACCESS_AUD
  };
  const realKey = await accessKeyPair("real-key");
  const attackerKey = await accessKeyPair("real-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), `${ACCESS_TEAM}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [realKey.jwk] }), { headers: { "content-type": "application/json" } });
  };

  try {
  const accessHeaders = { "cf-access-jwt-assertion": await signAccessJwt(realKey, {}) };

  // Tokens that must never grant access.
  const rejected = [
    { "cf-access-jwt-assertion": "fake-jwt" },
    { cookie: "CF_Authorization=fake" },
    { "cf-access-jwt-assertion": await signAccessJwt(attackerKey, {}) },
    { "cf-access-jwt-assertion": await signAccessJwt(realKey, { exp: Math.floor(Date.now() / 1000) - 10 }) },
    { "cf-access-jwt-assertion": await signAccessJwt(realKey, { aud: ["another-app"] }) },
    { "cf-access-jwt-assertion": await signAccessJwt(realKey, { iss: "https://evil.cloudflareaccess.com" }) }
  ];
  for (const headers of rejected) {
    for (const [api, path] of [[dashboardApi, "dashboard"], [leadsExportApi, "leads/export"], [leadEventsExportApi, "lead-events/export"]]) {
      const response = await api.onRequestGet({ env, request: request(`https://example.test/api/${path}`, null, "GET", headers) });
      assert.equal(response.status, 401, `${path} must reject ${JSON.stringify(headers).slice(0, 60)}`);
    }
    const patch = await leadUpdateApi.onRequestPatch({
      env,
      params: { id: "12" },
      request: request("https://example.test/api/leads/12", { lead_status: "WON", quote_value_pence: 1, won_revenue_pence: 1 }, "PATCH", headers)
    });
    assert.equal(patch.status, 401);
  }

  const cookieResponse = await dashboardApi.onRequestGet({
    env,
    request: request("https://example.test/api/dashboard", null, "GET", { cookie: `other=1; CF_Authorization=${accessHeaders["cf-access-jwt-assertion"]}` })
  });
  assert.equal(cookieResponse.status, 200);

  const dashboardResponse = await dashboardApi.onRequestGet({
    env,
    request: request("https://example.test/api/dashboard", null, "GET", accessHeaders)
  });
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboardResponse.status, 200);
  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.origin_summary[0].origin, "facebook");

  const leadsCsvResponse = await leadsExportApi.onRequestGet({
    env,
    request: request("https://example.test/api/leads/export", null, "GET", accessHeaders)
  });
  assert.equal(leadsCsvResponse.status, 200);
  assert.match(await leadsCsvResponse.text(), /submitted_at,name,phone,email/);

  const eventsCsvResponse = await leadEventsExportApi.onRequestGet({
    env,
    request: request("https://example.test/api/lead-events/export", null, "GET", accessHeaders)
  });
  assert.equal(eventsCsvResponse.status, 200);
  assert.match(await eventsCsvResponse.text(), /occurred_at,event_name,page/);

  const unauthorized = await dashboardApi.onRequestGet({
    env,
    request: request("https://example.test/api/dashboard", null, "GET")
  });
  assert.equal(unauthorized.status, 401);

  const queryToken = await dashboardApi.onRequestGet({
    env,
    request: request("https://example.test/api/dashboard?token=secret-token", null, "GET")
  });
  assert.equal(queryToken.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pipeline update validates auth, status and revenue fields", async () => {
  const db = captureDb();
  const env = { LEADS_DB: db, LEADS_EXPORT_TOKEN: "secret-token" };

  const response = await leadUpdateApi.onRequestPatch({
    env,
    params: { id: "12" },
    request: request("https://example.test/api/leads/12", {
      lead_status: "WON",
      quote_value_pence: 125000,
      won_revenue_pence: 120000
    }, "PATCH", { authorization: "Bearer secret-token" })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.lead.lead_status, "WON");
  assert.equal(body.lead.won_revenue_pence, 120000);

  const invalid = await leadUpdateApi.onRequestPatch({
    env,
    params: { id: "12" },
    request: request("https://example.test/api/leads/12", {
      lead_status: "INVALID",
      quote_value_pence: 0,
      won_revenue_pence: 0
    }, "PATCH", { authorization: "Bearer secret-token" })
  });
  assert.equal(invalid.status, 400);

  const unauthorized = await leadUpdateApi.onRequestPatch({
    env,
    params: { id: "12" },
    request: request("https://example.test/api/leads/12", {
      lead_status: "NEW",
      quote_value_pence: 0,
      won_revenue_pence: 0
    }, "PATCH")
  });
  assert.equal(unauthorized.status, 401);
});

test("dashboard page is Bryant branded and does not expose a token link", async () => {
  const html = await readFile(new URL("../dashboard.html", import.meta.url), "utf8");

  assert.match(html, /Bryant &amp; Co Cleaning/i);
  assert.match(html, /Cloudflare Access/i);
  assert.doesNotMatch(html, /Casa4/i);
  assert.doesNotMatch(html, /token=YOUR_LEADS_EXPORT_TOKEN/i);
  assert.doesNotMatch(html, /[?&]token=/i);
  assert.match(html, /TEST.*NEW.*GENUINE.*SPAM.*CONTACTED.*QUOTED.*WON.*LOST/s);
});
