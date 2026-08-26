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
-- SCHUTZ: Dieses Skript loescht per TRUNCATE ALLE Rechnungen (auch festgeschriebene) und
-- umgeht damit bewusst den GoBD-Loeschschutz-Trigger — TRUNCATE feuert keine Row-Level-
-- DELETE-Trigger. Deshalb nur zur EINMALIGEN Bereinigung VOR Go-live und nur mit expliziter
-- Bestaetigung ausfuehren, sonst Abbruch:
--   sudo -u postgres psql -d reifenpro -v ja=ja -f reset-sandbox.sql
\if :{?ja}
\else
  \echo '!!! ABBRUCH: reset-sandbox.sql loescht ALLE operativen Daten inkl. festgeschriebener Rechnungen.'
  \echo '!!! Nur VOR Go-live ausfuehren und mit  -v ja=ja  bestaetigen.'
  \quit
\endif
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
