-- Zustimmung zum vorzeitigen Leistungsbeginn bei telefonisch vereinbarten Terminen.
--
-- WARUM: Ein am Telefon geschlossener Vertrag ist ein Fernabsatzvertrag (§ 312c BGB) —
-- entscheidend ist der Moment des Vertragsschlusses, nicht wo spaeter gearbeitet wird. Damit gilt
-- dasselbe Widerrufsrecht wie bei einer Online-Buchung. Liegt der Termin innerhalb der 14 Tage,
-- wird gearbeitet, bevor die Frist ablaeuft; ohne ausdrueckliche Zustimmung des Kunden entfaellt
-- bei einem Widerruf danach der Wertersatz (§ 357a Abs. 2 BGB) und die Arbeit bliebe unbezahlt.
--
-- Website und Kundenportal erfassen die Zustimmung bereits. Ein vom Betrieb angelegter Termin
-- trug bisher gar nichts — das ist die dritte und letzte Tuer.
--
-- Der Kunde bestaetigt per Klick auf einen Link in einer E-Mail. Die Mail traegt die vollstaendige
-- Widerrufsbelehrung im Text, weil das Gesetz einen dauerhaften Datentraeger verlangt
-- (Art. 246a § 1 Abs. 2 EGBGB, § 312f BGB) — ein Link auf eine Seite, die sich spaeter aendern
-- kann, erfuellt das nicht sicher.

ALTER TABLE termine
  ADD COLUMN IF NOT EXISTS zustimmung_token text,
  ADD COLUMN IF NOT EXISTS zustimmung_token_ablauf timestamptz,
  ADD COLUMN IF NOT EXISTS zustimmung_angefragt_am timestamptz,
  ADD COLUMN IF NOT EXISTS vorzeitige_leistung_ip text,
  ADD COLUMN IF NOT EXISTS vorzeitige_leistung_quelle text;

COMMENT ON COLUMN termine.zustimmung_token IS
  'Einmal-Token fuer den Bestaetigungslink in der E-Mail. 256 Bit Zufall, wird beim Einloesen geleert.';
COMMENT ON COLUMN termine.zustimmung_token_ablauf IS
  'Ablauf des Bestaetigungslinks. Danach muss der Betrieb die Anfrage erneut senden.';
COMMENT ON COLUMN termine.zustimmung_angefragt_am IS
  'Wann die Bestaetigungsmail verschickt wurde. Ohne diesen Zeitpunkt liesse sich nicht belegen, dass der Kunde ueberhaupt gefragt wurde.';
COMMENT ON COLUMN termine.vorzeitige_leistung_ip IS
  'IP der Bestaetigung. Dieselbe Beweisqualitaet wie bei den uebrigen Einwilligungen (kunden.einwilligung_ip).';
COMMENT ON COLUMN termine.vorzeitige_leistung_quelle IS
  'Wie die Zustimmung zustande kam: online (Buchungsassistent oder Portal), mail (Klick aus der Bestaetigungsmail) oder telefonisch (vom Betrieb aufgenommen, mit Namen des Mitarbeiters im Vermerk).';

-- Nachschlagen beim Einloesen des Links, nur fuer offene Anfragen.
CREATE INDEX IF NOT EXISTS idx_termine_zustimmung_token
  ON termine (zustimmung_token) WHERE zustimmung_token IS NOT NULL;

-- Bestandsdaten: Was bereits online zugestimmt wurde, bekommt rueckwirkend die richtige Quelle.
UPDATE termine SET vorzeitige_leistung_quelle='online'
 WHERE vorzeitige_leistung = true AND vorzeitige_leistung_quelle IS NULL;

GRANT SELECT, INSERT, UPDATE ON termine TO reifenpro_user;
