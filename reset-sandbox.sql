-- ============================================================
-- RESET VOR GO-LIVE: loescht ALLE operativen Daten (Kunden, Fahrzeuge,
-- Einlagerungen, Termine, Rechnungen, Kontaktanfragen) und setzt die
-- Nummernkreise zurueck, sodass der Echtbetrieb sauber bei 1 startet.
--
-- BLEIBT erhalten: Einstellungen, Artikel, Lager-Konfiguration,
-- Mitarbeiter-Konten (users) und die Homepage-Inhalte.
--
-- Ausfuehren:  sudo -u postgres psql -d reifenpro -f reset-sandbox.sql
-- DANACH die erzeugten Rechnungs-PDFs entfernen:
--   rm -f /home/deploy/projekte/reifenpro/rechnungen/*.pdf
-- ============================================================
BEGIN;

TRUNCATE
  rechnung_positionen,
  rechnungen,
  rechnung_counter,
  termine,
  einlagerungen,
  fahrzeuge,
  kontakt_anfragen,
  kunden
RESTART IDENTITY CASCADE;

-- Optional: Protokolle leeren (auskommentieren, falls behalten gewuenscht)
TRUNCATE audit_log, email_log, dsgvo_anfragen RESTART IDENTITY CASCADE;

-- Nummernkreise auf Anfang
ALTER SEQUENCE seq_kunden_nr RESTART WITH 1;
ALTER SEQUENCE seq_beleg_nr  RESTART WITH 1;

COMMIT;

-- Kontrolle
SELECT 'kunden' t, count(*) FROM kunden
UNION ALL SELECT 'einlagerungen', count(*) FROM einlagerungen
UNION ALL SELECT 'termine', count(*) FROM termine
UNION ALL SELECT 'rechnungen', count(*) FROM rechnungen
UNION ALL SELECT 'kontakt_anfragen', count(*) FROM kontakt_anfragen;
