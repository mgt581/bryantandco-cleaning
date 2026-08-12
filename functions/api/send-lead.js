export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' });
  }

  let lead;
  try {
    lead = await request.json();
  } catch (_) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!env.LEADS_DB) {
    return json({ error: 'Lead storage is not configured.' }, 503);
  }

  const isReview = lead.service === 'Customer Review' || lead.form_name === 'Customer review form';
  if (isReview) {
    const rating = Number.parseInt(String(lead.rating || ''), 10);
    if (!lead.first_name || !lead.email || !Number.isInteger(rating) || rating < 1 || rating > 5 || !lead.message) {
      return json({ error: 'Please provide your name, email, rating and review.' }, 400);
    }
    try {
      await saveReview(lead, env, rating);
    } catch (error) {
      return json({ error: error && error.message ? error.message : 'The review could not be published yet.' }, 503);
    }
  }

  // A selected time is treated as a booking request. The D1-backed booking
  // check happens before the lead email is sent so two people cannot request
  // the same slot without one of them receiving a conflict response.
  let bookingId = '';
  if (lead.booking_date) {
    try {
      bookingId = await reserveBooking(lead, env);
    } catch (error) {
      const status = error && error.status ? error.status : 500;
      return json({
        error: error && error.message ? error.message : 'Booking could not be created',
        bookingId: ''
      }, status);
    }
  }

  const leadRecord = normalizeLead(lead, bookingId);
  let storedLeadId = 0;
  try {
    storedLeadId = await storeLead(env, request, leadRecord, 'pending', []);
  } catch (error) {
    console.error('Lead database storage failed:', error instanceof Error ? error.message : String(error));
    return json({ error: 'Your enquiry could not be stored safely. Please call or WhatsApp us.' }, 503);
  }

  const fromAddress = env.LEAD_FROM_EMAIL || 'Bryant & Co Cleaning <onboarding@resend.dev>';
  const toAddresses = (env.LEAD_TO_EMAILS || 'ajbryantsleads@gmail.com')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  const fields = [
    ['Page', lead.page_url],
    ['Form', lead.form_name],
    ['Service', lead.service || lead.home_service || lead.gallery_service],
    ['Name', [lead.first_name, lead.last_name].filter(Boolean).join(' ')],
    ['Email', lead.email],
    ['Phone', lead.phone],
    ['Rating', lead.rating],
    ['Postcode', lead.postcode],
    ['Property size', lead.property_size],
    ['Preferred date', lead.preferred_date],
    ['Requested date', lead.booking_date ? lead.booking_date : ''],
    ['Requested start time', lead.booking_date ? lead.booking_start : ''],
    ['Requested duration', lead.booking_date ? lead.booking_duration : ''],
    ['Requested frequency', lead.booking_date ? lead.booking_recurrence : ''],
    ['Recurring until', lead.booking_date && lead.booking_recurrence !== 'once' ? lead.booking_until : ''],
    ['Booking reference', bookingId],
    ['Landing page', lead.landing_page],
    ['Referrer', lead.referrer],
    ['UTM source', lead.utm_source],
    ['UTM medium', lead.utm_medium],
    ['UTM campaign', lead.utm_campaign],
    ['Message', lead.message]
  ].filter(([, value]) => value);

  const text = fields.map(([label, value]) => `${label}: ${value}`).join('\n');
  const html = '<h2>New Bryant & Co Cleaning lead</h2><table>' + fields.map(([label, value]) => (
    `<tr><th align="left" style="padding:6px 12px 6px 0;">${escapeHtml(label)}</th><td style="padding:6px 0;">${escapeHtml(String(value))}</td></tr>`
  )).join('') + '</table>';

  const deliveryErrors = [];
  let delivered = false;

  if (!env.RESEND_API_KEY) {
    deliveryErrors.push('RESEND_API_KEY is not configured');
  } else if (!toAddresses.length) {
    deliveryErrors.push('No destination email is configured');
  } else {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddress,
          to: toAddresses,
          reply_to: lead.email || 'info@bryantandcocleaning.co.uk',
          subject: lead.service === 'Customer Review' ? 'New customer review - Bryant & Co Cleaning' : (lead.service ? `New quote request - ${lead.service}` : 'New Bryant & Co Cleaning quote request'),
          text,
          html
        })
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Resend email failed: ${response.status} ${details}`);
      }

      delivered = true;
    } catch (error) {
      deliveryErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    await updateLeadDelivery(env.LEADS_DB, storedLeadId, delivered ? 'delivered' : 'failed', deliveryErrors);
    await storeLeadEvent(env, request, leadRecord, delivered ? 'generate_lead' : 'lead_delivery_failed');
  } catch (error) {
    console.error('Lead delivery status update failed:', error instanceof Error ? error.message : String(error));
  }

  if (!delivered) {
    if (deliveryErrors.length) console.error('Lead delivery failed:', deliveryErrors.join(' | '));
    return json({
      error: 'Sorry, your message could not be sent online. Please call or WhatsApp us and we will help straight away.'
    }, deliveryErrors.length ? 502 : 503);
  }

  return json({ ok: true });
}

function cleanLeadValue(value, maxLength = 1000) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function consentValue(value) {
  const text = cleanLeadValue(value).toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function inferredLeadSource(lead) {
  const utmSource = cleanLeadValue(lead.utm_source, 160).toLowerCase();
  const suppliedSource = cleanLeadValue(lead.source, 160).toLowerCase();
  const referrer = cleanLeadValue(lead.referrer, 1000).toLowerCase();

  if (utmSource) return utmSource;
  if (lead.fbclid || referrer.includes('facebook.com') || referrer.includes('fb.com')) return 'facebook';
  if (referrer.includes('instagram.com')) return 'instagram';
  if (lead.gclid || referrer.includes('google.') || referrer.includes('g.co')) return 'google';
  if (lead.msclkid || referrer.includes('bing.com')) return 'bing';
  if (referrer.includes('linkedin.com')) return 'linkedin';
  if (referrer.includes('twitter.com') || referrer.includes('x.com')) return 'x / twitter';
  if (referrer.includes('whatsapp.com') || referrer.includes('wa.me')) return 'whatsapp';
  if (suppliedSource && suppliedSource !== 'website') return suppliedSource;
  return 'direct / unknown';
}

async function ensurePipelineColumns(db) {
  const result = await db.prepare('PRAGMA table_info(leads)').all();
  const columns = new Set((result.results || []).map((item) => item.name));
  const additions = [
    ['lead_status', "TEXT NOT NULL DEFAULT 'NEW'"],
    ['quote_value_pence', 'INTEGER NOT NULL DEFAULT 0'],
    ['won_revenue_pence', 'INTEGER NOT NULL DEFAULT 0'],
    ['status_updated_at', 'TEXT']
  ];

  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      await db.prepare(`ALTER TABLE leads ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

function normalizeLead(lead, bookingId) {
  const splitName = [lead.first_name, lead.last_name].map((item) => cleanLeadValue(item, 160)).filter(Boolean).join(' ');
  const name = cleanLeadValue(lead.name || lead.full_name || splitName, 240);
  const service = cleanLeadValue(lead.service || lead.home_service || lead.gallery_service || 'Website enquiry', 160);
  const page = cleanLeadValue(lead.page || lead.page_url, 1000);

  return {
    submittedAt: new Date().toISOString(),
    name: name || 'Website visitor',
    phone: cleanLeadValue(lead.phone, 80),
    email: cleanLeadValue(lead.email, 240),
    postcode: cleanLeadValue(lead.postcode, 80),
    service,
    timeframe: cleanLeadValue(lead.preferred_date || (lead.booking_date ? `${lead.booking_date} ${lead.booking_start || ''}` : ''), 240),
    message: cleanLeadValue(lead.message, 4000),
    page,
    source: inferredLeadSource(lead),
    marketingConsent: consentValue(lead.marketing_consent || lead.consent),
    landingPage: cleanLeadValue(lead.landing_page || page, 1000),
    referrer: cleanLeadValue(lead.referrer, 1000),
    utmSource: cleanLeadValue(lead.utm_source, 240),
    utmMedium: cleanLeadValue(lead.utm_medium, 240),
    utmCampaign: cleanLeadValue(lead.utm_campaign, 240),
    utmTerm: cleanLeadValue(lead.utm_term, 240),
    utmContent: cleanLeadValue(lead.utm_content, 240),
    gclid: cleanLeadValue(lead.gclid, 300),
    fbclid: cleanLeadValue(lead.fbclid, 300),
    msclkid: cleanLeadValue(lead.msclkid, 300),
    sessionId: cleanLeadValue(lead.session_id, 120),
    clientId: cleanLeadValue(lead.client_id, 120),
    formName: cleanLeadValue(lead.form_name, 200),
    propertySize: cleanLeadValue(lead.property_size, 120),
    bookingId: cleanLeadValue(bookingId, 120)
  };
}

async function hashIp(ip) {
  if (!ip || !crypto.subtle) return '';
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function ensureLeadSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS leads (
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
    )
  `).run();
  await ensurePipelineColumns(db);
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_submitted_at ON leads (submitted_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_source ON leads (source)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (lead_status)').run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS lead_events (
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
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_lead_events_occurred_at ON lead_events (occurred_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_lead_events_event_name ON lead_events (event_name)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_lead_events_session_id ON lead_events (session_id)').run();
}

async function storeLead(env, request, lead, deliveryStatus, deliveryErrors) {
  if (!env.LEADS_DB) return false;
  await ensureLeadSchema(env.LEADS_DB);

  const ipHash = await hashIp(request.headers.get('cf-connecting-ip') || '');
  const userAgent = cleanLeadValue(request.headers.get('user-agent'), 1000);

  const result = await env.LEADS_DB.prepare(`
    INSERT INTO leads (
      submitted_at, name, phone, email, postcode, service, timeframe, message,
      page, source, marketing_consent, delivery_status, delivery_errors,
      user_agent, ip_hash, landing_page, referrer, utm_source, utm_medium,
      utm_campaign, utm_term, utm_content, gclid, fbclid, msclkid, session_id,
      client_id, form_name, property_size, booking_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    lead.submittedAt,
    lead.name,
    lead.phone,
    lead.email,
    lead.postcode,
    lead.service,
    lead.timeframe,
    lead.message,
    lead.page,
    lead.source,
    lead.marketingConsent ? 1 : 0,
    deliveryStatus,
    deliveryErrors.join(' | '),
    userAgent,
    ipHash,
    lead.landingPage,
    lead.referrer,
    lead.utmSource,
    lead.utmMedium,
    lead.utmCampaign,
    lead.utmTerm,
    lead.utmContent,
    lead.gclid,
    lead.fbclid,
    lead.msclkid,
    lead.sessionId,
    lead.clientId,
    lead.formName,
    lead.propertySize,
    lead.bookingId
  ).run();

  return result && result.meta ? Number(result.meta.last_row_id || 0) : 0;
}

async function updateLeadDelivery(db, leadId, deliveryStatus, deliveryErrors) {
  await db.prepare(`
    UPDATE leads
    SET delivery_status = ?, delivery_errors = ?
    WHERE id = ?
  `).bind(deliveryStatus, deliveryErrors.join(' | '), leadId).run();
}

async function storeLeadEvent(env, request, lead, eventName) {
  if (!env.LEADS_DB) return false;
  await ensureLeadSchema(env.LEADS_DB);

  const ipHash = await hashIp(request.headers.get('cf-connecting-ip') || '');
  const userAgent = cleanLeadValue(request.headers.get('user-agent'), 1000);

  await env.LEADS_DB.prepare(`
    INSERT INTO lead_events (
      occurred_at, event_name, page, landing_page, referrer, source, medium,
      campaign, term, content, gclid, fbclid, msclkid, service, session_id,
      client_id, user_agent, ip_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    new Date().toISOString(),
    eventName,
    lead.page,
    lead.landingPage,
    lead.referrer,
    lead.utmSource || lead.source,
    lead.utmMedium,
    lead.utmCampaign,
    lead.utmTerm,
    lead.utmContent,
    lead.gclid,
    lead.fbclid,
    lead.msclkid,
    lead.service,
    lead.sessionId,
    lead.clientId,
    userAgent,
    ipHash
  ).run();

  return true;
}

async function saveReview(lead, env, rating) {
  if (!env.BOOKING_DB) {
    throw new Error('Reviews are not configured yet. Please call 07843969254.');
  }

  const db = env.BOOKING_DB;
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
  await db.prepare(`
    INSERT INTO reviews (id, first_name, last_name, email, rating, message, published, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(
    crypto.randomUUID(),
    String(lead.first_name).trim(),
    String(lead.last_name || '').trim(),
    String(lead.email).trim(),
    rating,
    String(lead.message).trim(),
    new Date().toISOString()
  ).run();
}

async function reserveBooking(lead, env) {
  const db = env.BOOKING_DB;
  if (!db) {
    const error = new Error('Live booking availability is not configured yet. Please call 07843969254.');
    error.status = 503;
    throw error;
  }

  const date = String(lead.booking_date || '');
  const start = String(lead.booking_start || '');
  const duration = Number(lead.booking_duration);
  const recurrence = String(lead.booking_recurrence || 'once');
  const until = recurrence === 'once' ? date : String(lead.booking_until || '');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start)) {
    const error = new Error('Please select an available date and start time.');
    error.status = 400;
    throw error;
  }
  if (!['once', 'weekly', 'fortnightly', 'monthly'].includes(recurrence)) {
    const error = new Error('Please select a valid booking frequency.');
    error.status = 400;
    throw error;
  }
  if (!Number.isInteger(duration) || duration < 30 || duration > 480 || duration % 30 !== 0) {
    const error = new Error('Please select a valid cleaning duration.');
    error.status = 400;
    throw error;
  }
  if (recurrence !== 'once' && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < date)) {
    const error = new Error('Please select a valid end date for the recurring request.');
    error.status = 400;
    throw error;
  }

  const startDate = parseDate(date);
  const endDate = parseDate(until);
  if (!startDate || !endDate || monthsBetween(startDate, endDate) > 24) {
    const error = new Error('Recurring booking requests can be made for up to 24 months.');
    error.status = 400;
    throw error;
  }

  const hours = openingHours(startDate.getUTCDay());
  const startMinutes = timeToMinutes(start);
  if (!hours || startMinutes === null || startMinutes < hours.open || startMinutes + duration > hours.close) {
    const error = new Error('That time is outside our opening hours. Please choose another slot.');
    error.status = 400;
    throw error;
  }

  const dates = occurrenceDates(startDate, endDate, recurrence);
  const slots = [];
  dates.forEach((occurrenceDate) => {
    const occurrenceHours = openingHours(occurrenceDate.getUTCDay());
    if (!occurrenceHours || startMinutes < occurrenceHours.open || startMinutes + duration > occurrenceHours.close) {
      const error = new Error('The selected recurring time does not fit the opening hours on every occurrence.');
      error.status = 400;
      throw error;
    }
    for (let minutes = startMinutes; minutes < startMinutes + duration; minutes += 30) {
      slots.push({ date: formatDate(occurrenceDate), time: minutesToTime(minutes) });
    }
  });

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const statements = [db.prepare(`
    INSERT INTO bookings (
      id, service, first_name, last_name, email, phone, postcode, property_size,
      notes, start_date, start_time, duration_minutes, recurrence, recurrence_until,
      status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).bind(
    id,
    lead.service || lead.home_service || lead.gallery_service || 'Not specified',
    lead.first_name || '',
    lead.last_name || '',
    lead.email || '',
    lead.phone || '',
    lead.postcode || '',
    lead.property_size || '',
    lead.message || '',
    date,
    start,
    duration,
    recurrence,
    recurrence === 'once' ? null : until,
    createdAt
  )];

  slots.forEach((slot) => {
    statements.push(db.prepare(
      'INSERT INTO booking_occurrences (slot_date, slot_time, booking_id) VALUES (?, ?, ?)'
    ).bind(slot.date, slot.time, id));
  });

  try {
    await ensureBookingSchema(db);
    await db.batch(statements);
  } catch (_) {
    const error = new Error('That slot has just been requested by someone else. Please choose another available time.');
    error.status = 409;
    throw error;
  }

  return id;
}

async function ensureBookingSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      postcode TEXT,
      property_size TEXT,
      notes TEXT,
      start_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      recurrence TEXT NOT NULL DEFAULT 'once',
      recurrence_until TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS booking_occurrences (
      slot_date TEXT NOT NULL,
      slot_time TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      PRIMARY KEY (slot_date, slot_time),
      FOREIGN KEY (booking_id) REFERENCES bookings(id)
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS booking_occurrences_date_idx ON booking_occurrences(slot_date)').run();
}

function occurrenceDates(startDate, endDate, recurrence) {
  const dates = [];
  let current = new Date(startDate);
  while (current <= endDate) {
    dates.push(new Date(current));
    if (recurrence === 'once') break;
    if (recurrence === 'weekly') current.setUTCDate(current.getUTCDate() + 7);
    else if (recurrence === 'fortnightly') current.setUTCDate(current.getUTCDate() + 14);
    else {
      const day = current.getUTCDate();
      const nextMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
      const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 2, 0)).getUTCDate();
      current = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), Math.min(day, lastDay)));
    }
  }
  return dates;
}

function openingHours(day) {
  if (day === 0) return null;
  return day === 6 ? { open: 9 * 60, close: 16 * 60 } : { open: 8 * 60, close: 18 * 60 };
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return formatDate(date) === value ? date : null;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function monthsBetween(start, end) {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json'
    }, corsHeaders(), extraHeaders)
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
