-- Termin-Einlagerung: "noch nicht entschieden" von "ausdruecklich zurueckgezogen" trennen.
-- Bisher war einlagern DEFAULT false. Eine frische Buchung MIT gebuchter Einlagerung sah damit
-- aus wie eine, bei der der Betrieb die Einlagerung abgelehnt hat — die Oberflaeche haette
-- "vom Kunden gebucht, vom Betrieb zurueckgezogen" angezeigt, ohne dass jemand etwas tat.
-- Danach gilt: NULL = keine Entscheidung (es zaehlt, was der Kunde gebucht hat),
-- true = vorgemerkt, false = ausdruecklich zurueckgezogen.
ALTER TABLE termine ALTER COLUMN einlagern SET DEFAULT NULL;

-- Bestandsdaten: nur dort auf NULL setzen, wo das false NICHT als Entscheidung gemeint sein kann,
-- also bei Terminen OHNE gebuchte Einlagerung. Hat jemand bei einem Termin mit gebuchter
-- Einlagerung bewusst "nein" gesetzt, bleibt diese Entscheidung erhalten.
UPDATE termine t SET einlagern = NULL
 WHERE t.einlagern = false
   AND NOT (
     COALESCE((SELECT a.name ILIKE '%einlagerung%' FROM artikel a WHERE a.id = t.artikel_id), false)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(t.leistungen,'[]'::jsonb)) p
                WHERE p->>'bezeichnung' ILIKE '%einlagerung%')
   );
