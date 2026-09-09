-- Eigener Text fuer die Bestaetigung eines VERSCHOBENEN Termins.
--
-- Das Portal konnte Termine verschieben, verschickte dabei aber keine einzige Mail: Buchen
-- erzeugte zwei Nachrichten, Verschieben null. Der Kunde erfuhr die neue Uhrzeit nur, wenn er
-- selbst nachsah. Die Portal-Sitzung hat den Versand nachgeruestet und faellt ohne diese
-- Spalte auf einen fest eingebauten Text zurueck; mit ihr laesst sich der Text im Adminbereich
-- pflegen wie die drei Schwester-Mails.
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS email_termin_verschoben text;

COMMENT ON COLUMN einstellungen.email_termin_verschoben IS 'Vorlage fuer die Bestaetigung eines verschobenen Termins. Leer = eingebauter Standardtext.';
