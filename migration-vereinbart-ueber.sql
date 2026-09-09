-- Wie kam der Termin zustande? tresen | telefon | online
--
-- WARUM: Ob ein Verbraucher ein Widerrufsrecht hat, haengt daran, ob der Vertrag im FERNABSATZ
-- geschlossen wurde. Am Tresen gab es persoenlichen Kontakt -- kein Fernabsatz, kein
-- Widerrufsrecht (§ 312c BGB). Am Telefon und online schon.
--
-- Bisher konnte das System beide nicht unterscheiden: Der Betrieb legt Tresen- und
-- Telefontermine ueber dieselbe Route an, beide tragen portal_buchung=false. Das hatte zwei
-- gegenlaeufige Folgen:
--   Im Rechnungswesen musste der Hinweis beim Festschreiben auf portal_buchung=true beschraenkt
--   bleiben. Sonst haette er bei fast jeder am selben Tag angenommenen und abgerechneten Arbeit
--   ausgeloest -- dem Alltagsgeschaeft, in dem gar kein Widerrufsrecht besteht. Eine Warnung,
--   die staendig kommt, wird weggeklickt und fehlt dann dort, wo sie zaehlt.
--   Im Terminfenster musste der Zustimmungskasten bei JEDEM Termin in der Frist erscheinen, mit
--   der Nachfrage "am Telefon vereinbart? dann ...". Dieselbe Abnutzung.
--
-- Der Bediener weiss beim Anlegen ohnehin, wie der Termin zustande kam. Eine Angabe an der
-- Quelle ist besser als eine Vermutung an drei Stellen.
--
-- VORGABE 'tresen': Der haeufigste Fall und zugleich der vorsichtige -- wer versehentlich
-- 'tresen' stehen laesst, bekommt keine Zustimmungsabfrage, und der Betrieb muss den Fall
-- selbst erkennen. Das ist derselbe Stand wie vor dieser Spalte, also keine Verschlechterung.
ALTER TABLE termine ADD COLUMN IF NOT EXISTS vereinbart_ueber text NOT NULL DEFAULT 'tresen';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'termine_vereinbart_ueber_check') THEN
    ALTER TABLE termine ADD CONSTRAINT termine_vereinbart_ueber_check
      CHECK (vereinbart_ueber IN ('tresen', 'telefon', 'online'));
  END IF;
END $$;

-- Bestandsdaten: Was ueber Portal oder Website gebucht wurde, ist belegt online. Fuer den Rest
-- bleibt es bei 'tresen' -- nicht weil wir es wuessten, sondern weil wir es NICHT wissen und die
-- vorsichtige Annahme keinen falschen Hinweis erzeugt. In der Produktion sind das am 09.09.2026
-- vier Termine, allesamt Testdaten.
UPDATE termine SET vereinbart_ueber = 'online' WHERE portal_buchung = true AND vereinbart_ueber = 'tresen';

COMMENT ON COLUMN termine.vereinbart_ueber IS 'Wie der Termin zustande kam: tresen (kein Fernabsatz), telefon oder online (Fernabsatz, § 312c BGB). Steuert die Zustimmungsabfrage im Terminfenster und den Hinweis beim Festschreiben.';

-- Riegel in der Datenbank statt einer Merkregel in vier Routen.
--
-- Termine entstehen an vier Stellen: Adminmaske, Gastbuchung, Portalbuchung und
-- Sammelterminanfrage. Die letzten beiden liegen im Bereich einer anderen Sitzung. Wer dort eine
-- neue Einfuegestelle baut und die Spalte vergisst, bekaeme sonst still 'tresen' -- und ein
-- Fernabsatzvertrag saehe aus wie ein Tresengeschaeft. Genau die Verwechslung, wegen der es
-- diese Spalte gibt.
--
-- portal_buchung=true heisst per Definition: ueber eine Online-Oberflaeche geschlossen. Dann ist
-- 'online' nicht eine Annahme, sondern die einzig richtige Angabe. Der Riegel erzwingt sie.
CREATE OR REPLACE FUNCTION termin_weg_setzen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.portal_buchung IS TRUE AND NEW.vereinbart_ueber IS DISTINCT FROM 'online' THEN
    NEW.vereinbart_ueber := 'online';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_termin_weg ON termine;
CREATE TRIGGER trg_termin_weg BEFORE INSERT OR UPDATE OF portal_buchung, vereinbart_ueber ON termine
  FOR EACH ROW EXECUTE FUNCTION termin_weg_setzen();
