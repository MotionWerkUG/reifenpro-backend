-- Kundenstamm: Privat- und Firmenkunden sauber trennen.
-- Feldsatz abgestimmt zwischen Admin (Kundenstamm), Homepage (Buchungsformular) und
-- Rechnungswesen (Beleg). Bewusst additiv, ohne NOT NULL: Bestandskunden ohne Anschrift
-- bleiben gueltig, die Pflicht wird dort erzwungen, wo eine Leistung entsteht
-- (Einlagerungsvertrag, Terminbuchung), nicht auf der Spalte.
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS kundentyp text NOT NULL DEFAULT 'privat';
-- Bewusst OHNE Spaltenvorgabe: NULL heisst "nie ausgefuellt", 'DE' heisst "jemand hat Deutschland
-- gewaehlt". Das Rechnungswesen faellt fuer Altbestaende auf DE zurueck; das Kundenformular waehlt
-- DE vor, sodass neue Datensaetze den Wert ausdruecklich tragen.
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS land text;
-- Rechnungsempfaenger bei Firmenkunden: sonst geht die Rechnung an den Ansprechpartner in
-- der Werkstatt statt an die Buchhaltung. Rechnungswesen liest sie mit Vorrang vor email.
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS rechnung_email text;

-- Nur die beiden vorgesehenen Werte zulassen (Tippfehler wuerden sonst still zu einem
-- dritten Kundentyp fuehren, den keine Auswertung kennt).
ALTER TABLE kunden DROP CONSTRAINT IF EXISTS kunden_kundentyp_check;
ALTER TABLE kunden ADD CONSTRAINT kunden_kundentyp_check CHECK (kundentyp IN ('privat','firma'));

-- Bestandsdaten einordnen: wer einen Firmennamen oder eine USt-IdNr. traegt, ist eine Firma.
UPDATE kunden SET kundentyp='firma'
 WHERE kundentyp='privat' AND (NULLIF(TRIM(COALESCE(firma,'')),'') IS NOT NULL
                           OR NULLIF(TRIM(COALESCE(ust_id,'')),'') IS NOT NULL);
