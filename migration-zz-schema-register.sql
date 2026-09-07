-- Register der angewendeten Migrationen.
--
-- WARUM: scripts/test-db-setup.sh zieht das Schema aus der PRODUKTIONSDATENBANK und wendet
-- danach ALLE migration-*.sql in alphabetischer Reihenfolge erneut an. Das Schema enthält aber
-- bereits alles, was jemals angewendet wurde. Die Wiederholung ist damit nicht nur überflüssig,
-- sie ist gefährlich: Eine ältere Datei, die dieselbe Funktion definiert wie eine neuere, setzt
-- sie auf den alten Stand zurück.
--
-- Genau das ist am 07.09.2026 passiert. Eine Migration ersetzte rechnung_schutz() um den Schutz
-- der Beleg-Prüfsumme; migration-rechnung-kassenbeleg.sql lief danach (alphabetisch später) und
-- stellte die alte Fassung wieder her. Die Spalten waren da, der Schutz war dokumentiert, die
-- Tests fühlten sich richtig an -- und die Prüfsumme war in Wahrheit weiter änderbar. Aufgefallen
-- ist es nur, weil ein Test genau diesen Fall nachstellt.
--
-- Die Umbenennung auf ein zz-Präfix ist ein Pflaster: Sie hilft dieser einen Datei und lässt den
-- Nächsten in dieselbe Falle laufen. Hier steht stattdessen, WAS bereits angewendet wurde --
-- dann muss nichts mehr wiederholt werden, was schon im Schema steckt.

CREATE TABLE IF NOT EXISTS schema_migrationen (
  datei         text PRIMARY KEY,
  angewendet_am timestamptz NOT NULL DEFAULT now(),
  bemerkung     text
);

COMMENT ON TABLE schema_migrationen IS
  'Welche migration-*.sql bereits auf dieser Datenbank gelaufen sind. test-db-setup.sh überspringt sie beim Aufbau einer Testdatenbank.';

GRANT SELECT, INSERT ON schema_migrationen TO reifenpro_user;
