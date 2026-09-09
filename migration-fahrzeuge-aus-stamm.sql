-- Altdaten aus den Fahrzeug-Stammfeldern in echte Fahrzeugsaetze ueberfuehren.
--
-- WARUM: Die Kunden-Tabelle traegt aus der Zeit vor der Fahrzeugliste noch kennzeichen,
-- fahrzeug_marke, fahrzeug_modell, fahrzeug_typ und hu_datum. Kunden aus dieser Zeit haben
-- deshalb Fahrzeugdaten, aber keinen Fahrzeugsatz -- im Kundenportal steht bei ihnen "Noch keine
-- Fahrzeuge erfasst", obwohl ihr Auto dem Betrieb bekannt ist.
--
-- Schlimmer war die Folge fuer die Spiegelung: Legt so ein Kunde ein Fahrzeug an, werden die
-- Stammfelder ueberschrieben; loescht er es wieder, blieben die Werte des geloeschten Fahrzeugs
-- stehen. Am 09.09.2026 ist genau das beim Durchklicken des Portals passiert und hat den
-- Datensatz einer echten Kundin mit Testwerten hinterlassen.
--
-- Nach dieser Ueberfuehrung sind die Stammfelder AUSSCHLIESSLICH abgeleitet: Was dort steht,
-- stammt immer aus einem Fahrzeugsatz. Damit darf spiegleFahrzeugInStamm() sie bei null
-- Fahrzeugen leeren, ohne je Altdaten zu vernichten -- es gibt dann keine mehr.
--
-- fahrzeug_typ wird uebernommen, wenn er einem erlaubten Wert entspricht, sonst 'PKW'.
INSERT INTO fahrzeuge (kunden_id, typ, marke, modell, kennzeichen, hu_datum, notiz)
SELECT k.id,
       CASE WHEN k.fahrzeug_typ IN ('PKW','SUV','Transporter','Motorrad','Sonstiges')
            THEN k.fahrzeug_typ ELSE 'PKW' END,
       NULLIF(btrim(COALESCE(k.fahrzeug_marke, '')), ''),
       NULLIF(btrim(COALESCE(k.fahrzeug_modell, '')), ''),
       NULLIF(btrim(COALESCE(k.kennzeichen, '')), ''),
       k.hu_datum,
       'Aus den Stammdaten uebernommen am 09.09.2026'
  FROM kunden k
 WHERE (NULLIF(btrim(COALESCE(k.kennzeichen,'')),'') IS NOT NULL
        OR NULLIF(btrim(COALESCE(k.fahrzeug_marke,'')),'') IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM fahrzeuge f WHERE f.kunden_id = k.id);
