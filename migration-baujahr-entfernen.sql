-- Baujahr entfaellt.
--
-- Entscheidung des Inhabers vom 09.09.2026: "Baujahr und Erstzulassung haben nichts miteinander
-- zu tun. Wir erfassen immer die Erstzulassung. Baujahr interessiert uns nicht."
--
-- Das ist fachlich richtig: Massgeblich fuer die Hauptuntersuchung ist die Erstzulassung, und so
-- steht sie im Fahrzeugschein. Ein Fahrzeug kann im Dezember gebaut und im Maerz zugelassen
-- worden sein.
--
-- Vor dem Loeschen geprueft (09.09.2026):
--   kunden.baujahr    0 gefuellte Zeilen
--   fahrzeuge.baujahr 0 gefuellte Zeilen
--   kein Zugriff mehr im Backend, in keiner Oberflaeche, in keinem Bereich
-- Es geht also nichts verloren. Die Erstzulassung samt Genauigkeit (tag/monat/jahr) hat die
-- Aufgabe vollstaendig uebernommen -- auch den Fall "nur das Jahr bekannt", der frueher der
-- einzige Grund fuer diese Spalte war.
ALTER TABLE kunden    DROP COLUMN IF EXISTS baujahr;
ALTER TABLE fahrzeuge DROP COLUMN IF EXISTS baujahr;
