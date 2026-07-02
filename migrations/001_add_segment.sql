-- Adiciona a coluna `segment` em company_leads.
-- Necessária pra prospecção por nicho e pra persistência de leads inbound
-- (WhatsApp/site). Idempotente: pode rodar mais de uma vez sem erro.
alter table company_leads
  add column if not exists segment text;
