-- Cadencia de disparo para leads ja descobertos em company_leads.
-- Idempotente: pode rodar mais de uma vez sem erro.
alter table company_leads
  add column if not exists porte text,
  add column if not exists capital_social numeric,
  add column if not exists outreach_status text not null default 'pending',
  add column if not exists outreach_touch_count int not null default 0,
  add column if not exists next_outreach_at timestamptz default now(),
  add column if not exists last_outreach_at timestamptz,
  add column if not exists outreach_error text;

create index if not exists idx_company_leads_outreach_due
  on company_leads (outreach_status, next_outreach_at)
  where notified = true;
