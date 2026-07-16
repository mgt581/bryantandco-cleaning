export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' });
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ error: 'RESEND_API_KEY is not configured' }, 500);
  }

  let lead;
  try {
    lead = await request.json();
  } catch (_) {
    return json({ error: 'Invalid JSON body' }, 400);
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

  const fromAddress = env.LEAD_FROM_EMAIL || 'Bryant & Co Cleaning <onboarding@resend.dev>';
  const toAddresses = (env.LEAD_TO_EMAILS || 'ajbryantsleads@gmail.com')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  if (!toAddresses.length) {
    return json({ error: 'No destination email is configured' }, 500);
  }

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
    ['Message', lead.message]
  ].filter(([, value]) => value);

  const text = fields.map(([label, value]) => `${label}: ${value}`).join('\n');
  const html = '<h2>New Bryant & Co Cleaning lead</h2><table>' + fields.map(([label, value]) => (
    `<tr><th align="left" style="padding:6px 12px 6px 0;">${escapeHtml(label)}</th><td style="padding:6px 0;">${escapeHtml(String(value))}</td></tr>`
  )).join('') + '</table>';

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromAddress,
        to: toAddresses,
        reply_to: lead.email || 'info@bryantandcocleaning.co.uk',
        subject: lead.service ? `New quote request - ${lead.service}` : 'New Bryant & Co Cleaning quote request',
        text,
        html
      })
    });
  } catch (error) {
    return json({
      error: 'Failed to reach Resend API',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }

  if (!response.ok) {
    const details = await response.text();
    const status = response.status >= 400 && response.status < 500 ? 400 : 500;
    return json({ error: 'Resend email failed', details }, status);
  }

  return json({ ok: true });
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
  await db.exec(`
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
    );

    CREATE TABLE IF NOT EXISTS booking_occurrences (
      slot_date TEXT NOT NULL,
      slot_time TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      PRIMARY KEY (slot_date, slot_time),
      FOREIGN KEY (booking_id) REFERENCES bookings(id)
    );

    CREATE INDEX IF NOT EXISTS booking_occurrences_date_idx
      ON booking_occurrences(slot_date);
  `);
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
