-- Gestaffelte Rabatte je Gutschein: Der Flyer verspricht 25 % auf die Einlagerung und 10 %
-- auf alles andere -- ein einzelner `gutscheine.rabatt_prozent` kann das nicht abbilden.
--
-- Aufbau: je Gutschein beliebig viele Regeln. `artikel_id IS NULL` ist die Auffangregel
-- ("alles andere"), eine Regel mit artikel_id gilt genau fuer diese Leistung. Die
-- spezifischste Regel gewinnt. `gutscheine.rabatt_prozent` bleibt als Standard und
-- Rueckfallwert erhalten -- Bestandscodes ohne Regeln funktionieren unveraendert weiter.
CREATE TABLE IF NOT EXISTS gutschein_regeln (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  gutschein_id   uuid NOT NULL REFERENCES gutscheine(id) ON DELETE CASCADE,
  artikel_id     uuid REFERENCES artikel(id) ON DELETE CASCADE,
  rabatt_prozent integer NOT NULL CHECK (rabatt_prozent >= 0 AND rabatt_prozent <= 100),
  erstellt_am    timestamptz DEFAULT now()
);

-- Je Gutschein hoechstens EINE Auffangregel und je Leistung hoechstens eine Regel --
-- sonst waere nicht bestimmbar, welcher Satz gilt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gutschein_regel_auffang
  ON gutschein_regeln (gutschein_id) WHERE artikel_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gutschein_regel_artikel
  ON gutschein_regeln (gutschein_id, artikel_id) WHERE artikel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gutschein_regeln_gutschein ON gutschein_regeln (gutschein_id);
