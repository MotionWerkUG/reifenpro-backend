-- Der Admin bietet "Scan hochladen" an (Papier-Unterschrift einscannen). Der POST schickt
-- typ='scan', der Check-Constraint kennt diesen Wert aber nicht: der Upload lief in einen
-- DB-Fehler, es existiert bis heute keine einzige scan-Zeile. Das Feature war eine Sackgasse.
ALTER TABLE kunden_dokumente DROP CONSTRAINT IF EXISTS kunden_dokumente_typ_check;
ALTER TABLE kunden_dokumente ADD CONSTRAINT kunden_dokumente_typ_check
  CHECK (typ IN ('datenschutzerklaerung','einlagerungsvertrag','einlagerungsschein',
                 'auslagerungsschein','scan','sonstiges'));

-- Die neue Faelligkeitspruefung sucht je Einlagerung nach einem unterschriebenen Schein.
-- Ohne Index waere das bei wachsendem Bestand ein Full Scan ueber alle Dokumente.
CREATE INDEX IF NOT EXISTS idx_dokumente_einlagerung_id ON kunden_dokumente(einlagerung_id);
