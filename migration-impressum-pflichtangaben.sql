-- § 5 DDG (Handwerksrolle) und § 36 VSBG: Angaben, die ins Impressum gehoeren, sobald der
-- Betrieb eingetragen ist. Bewusst ALLE nullable und ohne Pflichtpruefung: die Firma wird
-- erst gegruendet, bis dahin muessen die Felder leer bleiben duerfen, ohne den Betrieb
-- zu blockieren. Genutzt werden sie von der Homepage (Impressum), nicht von der Rechnung.
ALTER TABLE einstellungen
  ADD COLUMN IF NOT EXISTS handwerkskammer TEXT,
  ADD COLUMN IF NOT EXISTS berufsbezeichnung TEXT,
  ADD COLUMN IF NOT EXISTS berufsbezeichnung_staat TEXT,
  ADD COLUMN IF NOT EXISTS berufsrechtliche_regelungen TEXT,
  ADD COLUMN IF NOT EXISTS schlichtung_bereit BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schlichtung_stelle TEXT;

COMMENT ON COLUMN einstellungen.handwerkskammer IS 'Zustaendige Handwerkskammer inkl. Anschrift (§ 5 DDG)';
COMMENT ON COLUMN einstellungen.berufsbezeichnung IS 'Gesetzliche Berufsbezeichnung, z. B. Kraftfahrzeugtechniker-Meister';
COMMENT ON COLUMN einstellungen.berufsbezeichnung_staat IS 'Staat, in dem die Berufsbezeichnung verliehen wurde';
COMMENT ON COLUMN einstellungen.berufsrechtliche_regelungen IS 'Verweis/Link auf die berufsrechtlichen Regelungen (HwO)';
COMMENT ON COLUMN einstellungen.schlichtung_bereit IS 'Bereitschaft zur Teilnahme am Streitbeilegungsverfahren (§ 36 VSBG)';
COMMENT ON COLUMN einstellungen.schlichtung_stelle IS 'Name und Anschrift der Verbraucherschlichtungsstelle';
