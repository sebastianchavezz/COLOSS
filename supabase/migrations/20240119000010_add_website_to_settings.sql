-- ADD WEBSITE TO EVENT SETTINGS
--
-- Doel: Website URL toevoegen aan event settings (voor Atleta-style config).

alter table public.event_settings
  add column if not exists website text;
