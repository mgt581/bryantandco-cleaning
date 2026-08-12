ALTER TABLE leads ADD COLUMN lead_status TEXT NOT NULL DEFAULT 'NEW';
ALTER TABLE leads ADD COLUMN quote_value_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN won_revenue_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN status_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (lead_status);
