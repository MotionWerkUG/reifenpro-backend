-- HU/TUEV-Sektion zu Fahrwerkstechnik umbauen
UPDATE homepage_sektionen SET
  headline = $$Fahrwerkstechnik$$,
  inhalt = $$Stoßdämpfer, Federn, Achs- und Lenkungsbauteile: Wir prüfen Ihr Fahrwerk, beraten ehrlich und tauschen verschlissene Komponenten fachgerecht. Für sicheres Fahrverhalten, gleichmäßigen Reifenverschleiß und mehr Komfort auf jeder Strecke.$$
WHERE sortierung=50;

-- Neue Sektion Bremsenservice einfügen
INSERT INTO homepage_sektionen (id, typ, sortierung, sichtbar, headline, inhalt)
VALUES (gen_random_uuid(), 'leistung', 55, true, $$Bremsenservice$$,
  $$Bremsbeläge, Bremsscheiben und Bremsflüssigkeit – wir kontrollieren Ihre Bremsanlage und erneuern Verschleißteile zuverlässig. Damit Sie sich auf den wichtigsten Sicherheitsbereich Ihres Fahrzeugs jederzeit verlassen können.$$);
