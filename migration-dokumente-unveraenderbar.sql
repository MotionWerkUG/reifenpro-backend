-- Unterschriebene Kundendokumente unveraenderbar machen (GoBD, § 257 HGB, § 147 AO).
--
-- Warum auf DB-Ebene und nicht nur in der Route: Die Anwendungspruefung sitzt an genau einer
-- Stelle. Ein zweiter Einstiegspunkt, ein spaeterer Fehler oder ein direkter Datenbankzugriff
-- haette den Schutz ausgehebelt — und mit dem geloeschten Dokument faellt auch die Loeschsperre
-- der zugehoerigen Einlagerung. Der Trigger ist die zweite, unabhaengige Linie, analog zu dem,
-- was fuer Rechnungen bereits existiert (trg_rechnung_schutz).
--
-- Erlaubt bleibt bewusst: das ERSTE Setzen der Unterschrift (NULL -> Wert) und Verwaltungsfelder,
-- die den Beleginhalt nicht beruehren (einlagerung_id entkoppeln, gueltig_bis fortschreiben).
CREATE OR REPLACE FUNCTION dokument_schutz() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.unterschrift_kunde IS NOT NULL THEN
      RAISE EXCEPTION 'Unterschriebene Dokumente duerfen nicht geloescht werden (Aufbewahrungspflicht).';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.unterschrift_kunde IS NOT NULL THEN
    IF NEW.unterschrift_kunde IS DISTINCT FROM OLD.unterschrift_kunde
       OR NEW.unterschrift_datum IS DISTINCT FROM OLD.unterschrift_datum
       OR NEW.inhalt_html       IS DISTINCT FROM OLD.inhalt_html
       OR NEW.typ               IS DISTINCT FROM OLD.typ
       OR NEW.titel             IS DISTINCT FROM OLD.titel
       OR NEW.kunden_id         IS DISTINCT FROM OLD.kunden_id
       OR NEW.version           IS DISTINCT FROM OLD.version THEN
      RAISE EXCEPTION 'Ein unterschriebenes Dokument darf inhaltlich nicht mehr geaendert werden.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dokument_schutz ON kunden_dokumente;
CREATE TRIGGER trg_dokument_schutz
  BEFORE UPDATE OR DELETE ON kunden_dokumente
  FOR EACH ROW EXECUTE FUNCTION dokument_schutz();
