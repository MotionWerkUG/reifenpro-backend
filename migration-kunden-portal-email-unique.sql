-- Eindeutige Portal-Anmeldeadresse (Tiefenschutz).
-- Ohne diesen Index koennten zwei kunden-Zeilen dieselbe portal_email tragen; der Login
-- nimmt dann rows[0] und ein Kunde saehe unter Umstaenden die Daten des anderen. Ueber die
-- Registrierung ist das bereits verhindert (portal-auth.js prueft vorab) -- der Index sichert
-- den Weg ueber Admin-Eingabe, Import oder direktes SQL zusaetzlich ab.
--
-- Bewusst als partieller Index auf LOWER(): mehrere Kunden OHNE Portal-Zugang (NULL/leer)
-- bleiben erlaubt, und Gross-/Kleinschreibung darf keine zweite Anmeldung ermoeglichen
-- (der Login vergleicht ebenfalls per LOWER()).
--
-- Bewusst NICHT auf kunden.email: dieselbe Kontaktadresse fuer mehrere Kunden ist fachlich
-- zulaessig (Familie, Firma mit mehreren Fahrzeughaltern). Das waere eine Geschaeftsregel,
-- keine Sicherheitsfrage -- entscheidet der Inhaber.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_kunden_portal_email_uniq
  ON kunden (LOWER(portal_email))
  WHERE portal_email IS NOT NULL AND portal_email <> '';
