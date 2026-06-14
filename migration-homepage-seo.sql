-- SEO-optimierte Homepage-Texte
UPDATE homepage_sektionen SET
  headline = $$Reifenservice & Fahrzeugtechnik – schnell, fair, zuverlässig$$,
  subline  = $$Räderwechsel, Reifeneinlagerung, Reifen & Felgen sowie HU/TÜV-Service bei Schröder & Scholz. Jetzt bequem online Ihren Wunschtermin buchen.$$,
  cta_text = $$Termin online buchen$$
WHERE typ='hero';

UPDATE homepage_sektionen SET
  headline = $$Räderwechsel$$,
  inhalt = $$Schneller Räder- und Reifenwechsel von Sommer- auf Winterreifen und zurück. Wir montieren fachgerecht, wuchten aus und ziehen mit dem korrekten Drehmoment an – inklusive Sichtprüfung von Profiltiefe und Reifenalter für Ihre Sicherheit.$$
WHERE sortierung=20;

UPDATE homepage_sektionen SET
  headline = $$Reifeneinlagerung$$,
  inhalt = $$Platzsparend und sicher: Wir lagern Ihre Sommer- und Winterräder trocken und fachgerecht ein, reinigen und prüfen sie. So kommen Sie jede Saison entspannt vorbei und wir montieren den passenden Satz – ganz ohne Schlepperei.$$
WHERE sortierung=30;

UPDATE homepage_sektionen SET
  headline = $$Reifen & Felgen kaufen$$,
  inhalt = $$Beratung, Verkauf und Montage von Reifen und Felgen aller gängigen Marken und Größen – vom Kleinwagen über SUV bis zum Transporter. Wir finden die passende Kombination für Fahrprofil, Fahrzeug und Budget.$$
WHERE sortierung=40;

UPDATE homepage_sektionen SET
  headline = $$HU/TÜV & Fahrzeugservice$$,
  inhalt = $$Hauptuntersuchung (HU/TÜV) und Service rund ums Rad aus einer Hand. Wir koordinieren den Termin und kümmern uns um die Details, damit Ihr Fahrzeug sicher und vorschriftsmäßig unterwegs ist.$$
WHERE sortierung=50;

UPDATE homepage_sektionen SET
  headline = $$Über Schröder & Scholz$$,
  inhalt = $$Schröder & Scholz ist Ihr zuverlässiger Partner für Reifenservice und Fahrzeugtechnik. Mit langjähriger Erfahrung, modernem Equipment und einem fairen Preis-Leistungs-Verhältnis bringen wir Sie sicher durch jede Saison – vom Räderwechsel über die Reifeneinlagerung bis zum kompletten Service. Persönlich, ehrlich und kompetent.$$
WHERE sortierung=60;

UPDATE homepage_sektionen SET headline=$$Öffnungszeiten$$ WHERE typ='oeffnungszeiten';
UPDATE homepage_sektionen SET headline=$$Kontakt & Anfahrt$$ WHERE typ='kontakt';
