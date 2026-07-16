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
