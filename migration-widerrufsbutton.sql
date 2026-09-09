-- Widerrufsbutton nach § 356a BGB (in Kraft seit 19.06.2026)
--
-- Wer Verbrauchern ueber eine Online-Oberflaeche den Abschluss von Fernabsatzvertraegen
-- ermoeglicht, muss eine elektronische Widerrufsfunktion bereitstellen: eine staendig
-- verfuegbare, hervorgehoben platzierte Schaltflaeche "Vertrag widerrufen", dahinter eine
-- Bestaetigungsseite mit genau drei Angaben (Name, Angaben zur Identifizierung des Vertrags,
-- elektronisches Kommunikationsmittel fuer die Eingangsbestaetigung) und einer zweiten
-- Schaltflaeche "Widerruf bestaetigen". Der Eingang ist unverzueglich auf einem dauerhaften
-- Datentraeger zu bestaetigen -- eine Webseite genuegt dafuer NICHT, eine E-Mail schon.
--
-- Fehlt die Funktion, verlaengert sich die Widerrufsfrist auf zwoelf Monate und 14 Tage.
-- Ausnahmen fuer kleine Betriebe gibt es nicht; Terminbuchungen (Dienstleistungen) sind erfasst.
--
-- Die Erklaerung wird hier gespeichert, statt nur eine Mail zu senden: Der Eingangszeitpunkt
-- ist die fristwahrende Tatsache und muss belegbar sein, auch wenn eine Mail verlorengeht.

CREATE TABLE IF NOT EXISTS widerrufe (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  eingegangen_am           timestamptz NOT NULL DEFAULT now(),
  name                     text NOT NULL,
  vertrag_angabe           text NOT NULL,
  kontakt_email            text NOT NULL,
  termin_id                uuid REFERENCES termine(id) ON DELETE SET NULL,
  kunden_id                uuid REFERENCES kunden(id) ON DELETE SET NULL,
  ip                       text,
  bestaetigung_gesendet_am timestamptz,
  status                   text NOT NULL DEFAULT 'offen',
  notiz                    text,
  bearbeitet_am            timestamptz,
  bearbeitet_von           uuid REFERENCES users(id),
  CONSTRAINT widerrufe_status_check CHECK (status IN ('offen','bearbeitet','abgelehnt'))
);

CREATE INDEX IF NOT EXISTS idx_widerrufe_status ON widerrufe(status);
CREATE INDEX IF NOT EXISTS idx_widerrufe_eingang ON widerrufe(eingegangen_am DESC);

COMMENT ON COLUMN widerrufe.eingegangen_am IS 'Fristwahrender Eingangszeitpunkt -- wird dem Kunden in der Eingangsbestaetigung genannt.';
COMMENT ON COLUMN widerrufe.vertrag_angabe IS 'Angaben des Kunden zur Identifizierung des Vertrags (§ 356a BGB) -- Freitext, weil Termine keine Buchungsnummer tragen.';

-- Rechte fuer den Anwendungsbenutzer. NEUE TABELLEN ERBEN KEINE RECHTE -- ohne diesen Block
-- laeuft die Anwendung in "permission denied for table widerrufe", und zwar erst beim ersten
-- echten Widerruf eines Kunden.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reifenpro_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE widerrufe TO reifenpro_user;
  END IF;
END $$;
