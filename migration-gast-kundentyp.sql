-- Privat-/Firmenkunde schon bei der Gaeste-Buchung erfassen.
-- Grund: Bei Firmenkunden sind andere Angaben rechnungsrelevant (Firmenname als Rechnungsempfaenger).
-- Der Gast-Termin ist der einzige Ort, an dem diese Angaben fuer Buchende ohne Konto anfallen --
-- ohne eigene Spalten landen sie sonst nur im Freitext und stehen der Rechnung nicht strukturiert
-- zur Verfuegung (vgl. Empfaenger-Snapshot bei Gast-Rechnungen).
-- Additiv mit Default: kein Table-Rewrite, bestehende Zeilen gelten als Privatkunden.
ALTER TABLE termine ADD COLUMN IF NOT EXISTS kontakt_kundentyp TEXT NOT NULL DEFAULT 'privat';
ALTER TABLE termine ADD COLUMN IF NOT EXISTS kontakt_firma TEXT;
