-- Erstzulassung statt Baujahr.
--
-- WARUM: Das Baujahr ist fuer eine Werkstatt die falsche Angabe. Massgeblich ist die
-- ERSTZULASSUNG -- an ihr haengt der Termin der Hauptuntersuchung, und sie steht so im
-- Fahrzeugschein. Ein Fahrzeug, das im Dezember gebaut und im Maerz zugelassen wurde, hat
-- ein Baujahr und einen davon abweichenden HU-Rhythmus.
--
-- KEINE DATENUEBERNAHME: In kunden und fahrzeuge ist baujahr bei NULL Zeilen gesetzt (geprueft
-- am 09.09.2026). Es gibt nichts umzurechnen -- und das ist gut so: Aus einem Jahr laesst sich
-- kein Monat gewinnen. Ein erfundener '1980-01-01' stuende spaeter auf einer Erinnerung, ohne
-- dass ihn je jemand erfasst haette. Sollte doch einmal ein Baujahr auftauchen, wird es als
-- "Baujahr 1980, Monat nicht erfasst" angezeigt und NICHT umgerechnet.
--
-- baujahr bleibt vorerst stehen und faellt weg, wenn nichts mehr darauf zugreift.
ALTER TABLE fahrzeuge ADD COLUMN IF NOT EXISTS erstzulassung date;
ALTER TABLE kunden    ADD COLUMN IF NOT EXISTS erstzulassung date;

COMMENT ON COLUMN fahrzeuge.erstzulassung IS 'Tag der Erstzulassung. Wird nur der Monat erfasst (Eingabefeld type="month"), steht hier der Monatserste -- normalisiert in src/lib/datum.js.';
COMMENT ON COLUMN kunden.erstzulassung IS 'Erstzulassung des Stammfahrzeugs. Rueckfall wie die uebrigen Fahrzeug-Stammfelder, siehe src/lib/kundendaten.js.';
