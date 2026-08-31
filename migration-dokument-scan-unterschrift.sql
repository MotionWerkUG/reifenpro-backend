-- Unterschrift auf Papier: Wird der Schein ausgedruckt, unterschrieben und wieder
-- eingescannt, liegt die Unterschrift nicht in unterschrift_kunde, sondern als Datei.
-- Ohne diese Spalten koennte das System einen so unterschriebenen Beleg nicht als
-- unterschrieben erkennen — die Faelligkeitsmeldung im Dashboard bliebe stehen.
ALTER TABLE kunden_dokumente
  ADD COLUMN IF NOT EXISTS scan_pfad TEXT,
  ADD COLUMN IF NOT EXISTS unterschrift_weg TEXT
    CHECK (unterschrift_weg IS NULL OR unterschrift_weg IN ('tablet', 'scan'));

COMMENT ON COLUMN kunden_dokumente.scan_pfad IS 'Ablagepfad des eingescannten, unterschriebenen Blattes (ausserhalb des Web-Verzeichnisses)';
COMMENT ON COLUMN kunden_dokumente.unterschrift_weg IS 'Wie unterschrieben wurde: tablet (Unterschrift im Browser) oder scan (Papier)';

-- Bestand nachziehen: alles, was heute unterschrieben ist, wurde am Bildschirm unterschrieben.
UPDATE kunden_dokumente SET unterschrift_weg = 'tablet'
 WHERE unterschrift_kunde IS NOT NULL AND unterschrift_weg IS NULL;

-- Die Aufbewahrungssperre kannte bisher nur unterschrift_kunde. Ein per Scan unterschriebener
-- Beleg waere damit weiterhin loesch- und aenderbar gewesen — genau der Beweiswert, den die
-- Sperre schuetzen soll, haette gefehlt. Jetzt zaehlt auch scan_pfad als Unterschrift, und
-- scan_pfad selbst sowie unterschrift_weg sind gegen nachtraegliche Aenderung geschuetzt.
CREATE OR REPLACE FUNCTION dokument_schutz() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.unterschrift_kunde IS NOT NULL OR OLD.scan_pfad IS NOT NULL THEN
      RAISE EXCEPTION 'Unterschriebene Dokumente duerfen nicht geloescht werden (Aufbewahrungspflicht).';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.unterschrift_kunde IS NOT NULL OR OLD.scan_pfad IS NOT NULL THEN
    IF NEW.unterschrift_kunde IS DISTINCT FROM OLD.unterschrift_kunde
       OR NEW.unterschrift_datum IS DISTINCT FROM OLD.unterschrift_datum
       OR NEW.scan_pfad         IS DISTINCT FROM OLD.scan_pfad
       OR NEW.unterschrift_weg  IS DISTINCT FROM OLD.unterschrift_weg
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
