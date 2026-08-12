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
