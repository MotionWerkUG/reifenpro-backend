-- ACHTUNG ZUM DATEINAMEN: Das zz-Praefix ist Absicht, siehe
-- migration-zz-2026-09-07-beleg-pruefsumme.sql. Migrationen laufen alphabetisch; diese Datei
-- ersetzt rechnung_schutz() und muss deshalb NACH allen anderen laufen, die sie definieren.
--
-- Erstattung nach Widerruf: Zahlart und Erstattungsbeleg
--
-- Die Zahlart einer Kassenzahlung wurde bisher gar nicht gespeichert. Damit liess sich die
-- Regel "Erstattung nur ueber dasselbe Zahlungsmittel" nicht einhalten. Und ein Storno einer
-- bar bezahlten Rechnung buchte nichts zurueck — das Geld waere ohne Gegenbuchung in der
-- Kasse geblieben.
--
-- Zusaetzlich kommen die Kassenfelder in den Schutz. Der Verweis auf den Kassenbeleg war
-- bisher frei aenderbar. Einmalig setzbar, danach unveraenderbar — wie PDF-Pfad und Pruefsumme.

ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS kasse_zahlart          text;
ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS kasse_erstattung_beleg text;
ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS kasse_erstattung_am    date;

CREATE OR REPLACE FUNCTION public.rechnung_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
    -- Kassenbezug: einmalig setzbar, danach unveraenderbar. Bisher war der Verweis auf den
    -- Kassenbeleg frei aenderbar — eine Rechnung haette still einem anderen Kassenvorgang
    -- zugeordnet werden koennen. Die Zahlart gehoert dazu, weil eine Erstattung nur ueber
    -- dasselbe Zahlungsmittel laufen darf.
    IF OLD.kasse_beleg_nr IS NOT NULL AND NEW.kasse_beleg_nr IS DISTINCT FROM OLD.kasse_beleg_nr THEN
      RAISE EXCEPTION 'GoBD: Der Kassenbeleg zu Rechnung % darf nicht ausgetauscht werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    IF OLD.kasse_zahlart IS NOT NULL AND NEW.kasse_zahlart IS DISTINCT FROM OLD.kasse_zahlart THEN
      RAISE EXCEPTION 'GoBD: Die Zahlart zu Rechnung % darf nicht nachträglich geändert werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    IF OLD.kasse_erstattung_beleg IS NOT NULL AND NEW.kasse_erstattung_beleg IS DISTINCT FROM OLD.kasse_erstattung_beleg THEN
      RAISE EXCEPTION 'GoBD: Der Erstattungsbeleg zu Rechnung % darf nicht ausgetauscht werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;


DROP TRIGGER IF EXISTS trg_rechnung_schutz ON rechnungen;
CREATE TRIGGER trg_rechnung_schutz
  BEFORE UPDATE OR DELETE ON rechnungen
  FOR EACH ROW EXECUTE FUNCTION rechnung_schutz();
