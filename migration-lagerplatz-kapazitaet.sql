-- Mehrere Radsätze auf einem Lagerplatz (Stapelung im Container).
--
-- Der Betrieb lagert liegend und stapelt zwei Sätze übereinander. Bisher galt ein Platz nach dem
-- ersten Satz als voll; wer trotzdem zwei unterbringen wollte, musste sich Schreibweisen wie
-- "A-01-07-OBEN" ausdenken — die kannte der Lagerplan nicht, und nach dem Herausnehmen des unteren
-- Satzes zeigte er den Platz als FREI an, obwohl oben noch Räder lagen.
--
-- Loesung: Der Platz behaelt EINE Bezeichnung, das Regal bekommt eine Kapazitaet. Beide Saetze
-- tragen denselben Lagerplatz; unterschieden werden sie ueber Kundennummer und Kennzeichen auf
-- dem Etikett. Vorteil gegenueber einer Position "oben/unten": Wird der untere Satz herausgenommen
-- und der obere rutscht nach, aendert sich NICHTS — der Beleg des Kunden bleibt richtig.
ALTER TABLE lager_regale ADD COLUMN IF NOT EXISTS plaetze_kapazitaet integer NOT NULL DEFAULT 1;
ALTER TABLE lager_regale DROP CONSTRAINT IF EXISTS lager_regale_kapazitaet_check;
ALTER TABLE lager_regale ADD CONSTRAINT lager_regale_kapazitaet_check
  CHECK (plaetze_kapazitaet BETWEEN 1 AND 4);
COMMENT ON COLUMN lager_regale.plaetze_kapazitaet IS
  'Wie viele Radsätze auf einem Platz dieses Regals liegen dürfen. 1 = einzeln, 2 = zwei Sätze übereinander gestapelt.';
