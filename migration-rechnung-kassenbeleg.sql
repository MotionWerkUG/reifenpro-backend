-- Verknuepfung Rechnung <-> Kassenbeleg und Nachtrag zum GoBD-Schutztrigger.
--
-- 1) Drei Felder fuer den Zahlungsvermerk. Sie werden NACH dem Festschreiben gesetzt und
--    gehoeren deshalb bewusst NICHT zu den geschuetzten Inhaltsfeldern — wie zahlungsstatus
--    und bezahlt_am. Gespeichert wird nur die Verknuepfung, nicht der Kassenbeleg selbst:
--    den bewahrt die Kasse auf.
ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS kasse_beleg_nr text;
ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS kasse_beleg_datum date;
ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS kasse_beleg_url text;

-- 2) empfaenger_land in den Schutztrigger aufnehmen. Die Spalte kam nach dem Trigger dazu
--    und war deshalb bisher nach dem Festschreiben aenderbar — sie gehoert aber zum
--    eingefrorenen Empfaenger-Schnappschuss.
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
