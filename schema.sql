-- Run this once against the Cloudflare D1 database bound as BOOKING_DB.
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

CREATE INDEX IF NOT EXISTS booking_occurrences_date_idx ON booking_occurrences(slot_date);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  rating INTEGER NOT NULL,
  message TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS reviews_created_at_idx ON reviews(created_at);

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
  lead_status TEXT NOT NULL DEFAULT 'NEW' CHECK (lead_status IN ('TEST', 'NEW', 'GENUINE', 'SPAM', 'CONTACTED', 'QUOTED', 'WON', 'LOST')),
  quote_value_pence INTEGER NOT NULL DEFAULT 0 CHECK (quote_value_pence >= 0),
  won_revenue_pence INTEGER NOT NULL DEFAULT 0 CHECK (won_revenue_pence >= 0),
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
);

CREATE INDEX IF NOT EXISTS idx_leads_submitted_at ON leads (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads (source);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (lead_status);

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
);

CREATE INDEX IF NOT EXISTS idx_lead_events_occurred_at ON lead_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_events_event_name ON lead_events (event_name);
CREATE INDEX IF NOT EXISTS idx_lead_events_session_id ON lead_events (session_id);
