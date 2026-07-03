-- Guarda contatos publicos ligados ao decisor, separados dos contatos gerais
-- da empresa. Idempotente: pode rodar mais de uma vez sem erro.
alter table company_leads
  add column if not exists decision_maker_email text,
  add column if not exists decision_maker_phone text,
  add column if not exists decision_maker_whatsapp text,
  add column if not exists decision_maker_linkedin text,
  add column if not exists decision_maker_instagram text,
  add column if not exists decision_maker_contact_sources jsonb,
  add column if not exists decision_maker_contact_layers jsonb;
