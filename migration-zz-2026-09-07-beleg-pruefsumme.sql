-- ACHTUNG ZUM DATEINAMEN: Das Praefix "zz-" ist Absicht.
-- scripts/test-db-setup.sh wendet die Migrationen in ALPHABETISCHER Reihenfolge an. Diese
-- Datei ersetzt die Funktion rechnung_schutz(), die auch migration-rechnung-kassenbeleg.sql
-- definiert. Ohne das Praefix liefe die aeltere Datei danach und setzte die Funktion auf den
-- alten Stand zurueck — die Pruefsumme waere dann NICHT geschuetzt, ohne dass es auffaellt.
-- Das ist genau so passiert und nur durch einen Test aufgefallen.
-- Wer kuenftig rechnung_schutz() erneut aendert, muss dafuer sorgen, dass seine Datei NACH
-- dieser laeuft (spaeteres Datum im zz-Namen).

-- Belegsicherung: Pruefsumme je PDF und Belegkette
--
-- Warum: Der Schutztrigger sicherte bisher nur den Datensatz und den Dateipfad, nicht den
-- INHALT der Belegdatei. Wer Schreibzugriff auf das Dateisystem hatte, konnte ein Beleg-PDF
-- austauschen, ohne dass die Datenbank es bemerkt. Die GoBD (Rz. 110) halten eine blosse
-- Ablage im Dateisystem ausdruecklich fuer nicht ausreichend, solange keine zusaetzlichen
-- Massnahmen die Unveraenderbarkeit sichern; Rz. 119/120 verlangen fuer tatsaechlich
-- aufbewahrte elektronische Dokumente die Unveraenderbarkeit ueber die gesamte Frist.
--
-- pdf_sha256            Pruefsumme der Datei im Moment der Erzeugung.
-- beleg_hash            Kettenglied: schliesst den Vorgaenger ein. Damit faellt auch auf,
--                       wenn ein vollstaendiger Beleg samt Datei entfernt oder nachtraeglich
--                       eingeschoben wurde — nicht nur, wenn eine Datei veraendert wurde.
-- beleg_hash_vorgaenger Das eingeschlossene Kettenglied, damit die Kette ohne Neuberechnung
--                       der gesamten Historie pruefbar bleibt.
--
-- Alle drei sind EINMALIG setzbar (NULL -> Wert) und danach unveraenderbar, wie pdf_pfad.

ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS pdf_sha256            text;
ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS beleg_hash            text;
ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS beleg_hash_vorgaenger text;

CREATE OR REPLACE FUNCTION rechnung_schutz() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('festgeschrieben','storniert') THEN
      RAISE EXCEPTION 'GoBD: Festgeschriebene/stornierte Rechnung % darf nicht gelöscht werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('festgeschrieben','storniert') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'festgeschrieben' AND NEW.status = 'storniert') THEN
      RAISE EXCEPTION 'GoBD: Unzulässiger Statuswechsel % -> % (Rechnung %).', OLD.status, NEW.status, COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    IF NEW.rechnungsnr          IS DISTINCT FROM OLD.rechnungsnr
       OR NEW.kunden_id         IS DISTINCT FROM OLD.kunden_id
       OR NEW.empfaenger_anrede   IS DISTINCT FROM OLD.empfaenger_anrede
       OR NEW.empfaenger_vorname  IS DISTINCT FROM OLD.empfaenger_vorname
       OR NEW.empfaenger_nachname IS DISTINCT FROM OLD.empfaenger_nachname
       OR NEW.empfaenger_name     IS DISTINCT FROM OLD.empfaenger_name
       OR NEW.empfaenger_firma    IS DISTINCT FROM OLD.empfaenger_firma
       OR NEW.empfaenger_strasse  IS DISTINCT FROM OLD.empfaenger_strasse
       OR NEW.empfaenger_plz      IS DISTINCT FROM OLD.empfaenger_plz
       OR NEW.empfaenger_ort      IS DISTINCT FROM OLD.empfaenger_ort
       OR NEW.empfaenger_land     IS DISTINCT FROM OLD.empfaenger_land
       OR NEW.aussteller          IS DISTINCT FROM OLD.aussteller
       OR NEW.rechnungsdatum      IS DISTINCT FROM OLD.rechnungsdatum
       OR NEW.leistungsdatum      IS DISTINCT FROM OLD.leistungsdatum
       OR NEW.faelligkeit         IS DISTINCT FROM OLD.faelligkeit
       OR NEW.netto_summe         IS DISTINCT FROM OLD.netto_summe
       OR NEW.mwst_summe          IS DISTINCT FROM OLD.mwst_summe
       OR NEW.brutto_summe        IS DISTINCT FROM OLD.brutto_summe
       OR NEW.mwst_aufschluesselung IS DISTINCT FROM OLD.mwst_aufschluesselung
       OR NEW.storno_von_id       IS DISTINCT FROM OLD.storno_von_id
       OR NEW.festgeschrieben_am  IS DISTINCT FROM OLD.festgeschrieben_am
       OR NEW.erstellt_von        IS DISTINCT FROM OLD.erstellt_von
       OR NEW.erstellt_am         IS DISTINCT FROM OLD.erstellt_am
       OR NEW.notizen             IS DISTINCT FROM OLD.notizen THEN
      RAISE EXCEPTION 'GoBD/§14: Inhalt der festgeschriebenen Rechnung % ist unveränderbar.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    IF OLD.pdf_pfad IS NOT NULL AND NEW.pdf_pfad IS DISTINCT FROM OLD.pdf_pfad THEN
      RAISE EXCEPTION 'GoBD: Der Beleg-PDF-Pfad der Rechnung % darf nicht ausgetauscht werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    -- Pruefsumme und Kettenglieder: einmalig setzbar, danach unveraenderbar. Waeren sie
    -- nachtraeglich aenderbar, koennte man eine ausgetauschte Datei einfach "passend machen".
    IF OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256 THEN
      RAISE EXCEPTION 'GoBD: Die Prüfsumme des Belegs % darf nicht nachträglich geändert werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    IF OLD.beleg_hash IS NOT NULL AND NEW.beleg_hash IS DISTINCT FROM OLD.beleg_hash THEN
      RAISE EXCEPTION 'GoBD: Das Kettenglied des Belegs % darf nicht nachträglich geändert werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    IF OLD.beleg_hash_vorgaenger IS NOT NULL AND NEW.beleg_hash_vorgaenger IS DISTINCT FROM OLD.beleg_hash_vorgaenger THEN
      RAISE EXCEPTION 'GoBD: Der Kettenverweis des Belegs % darf nicht nachträglich geändert werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rechnung_schutz ON rechnungen;
CREATE TRIGGER trg_rechnung_schutz
  BEFORE UPDATE OR DELETE ON rechnungen
  FOR EACH ROW EXECUTE FUNCTION rechnung_schutz();
