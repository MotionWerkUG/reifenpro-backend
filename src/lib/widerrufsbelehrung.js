// Die Widerrufsbelehrung — an EINER Stelle.
//
// WARUM DIESE DATEI: Die Belehrung stand bisher nur in frontend/portal/widerruf.html. Fuer die
// Bestaetigungsmail bei telefonisch vereinbarten Terminen wird sie ein zweites Mal gebraucht, und
// zwar im MAILTEXT selbst: Das Gesetz verlangt sie auf einem dauerhaften Datentraeger
// (Artikel 246a Paragraf 1 Abs. 2 EGBGB, Paragraf 312f BGB). Eine Mail erfuellt das, ein Link auf
// eine Seite, die sich spaeter aendern kann, nicht sicher.
//
// Zwei Fassungen desselben Rechtstextes waeren aber genau das Muster, das uns an diesem Tag
// mehrfach eingeholt hat: Gutschein, Oeffnungszeiten, Adressvorschlaege, Widerrufsfrist — jedes
// Mal liefen zwei Stellen auseinander, und jedes Mal hat es der Kunde zuerst gesehen. Bei einem
// Rechtstext waere es schlimmer als bei einem Preis: Wer sich auf die eine Fassung beruft, haelt
// die andere in der Hand.
//
// Der Wortlaut folgt der gesetzlichen Muster-Widerrufsbelehrung (Anlage 1 zu Artikel 246a
// Paragraf 1 Abs. 2 EGBGB) in der Fassung fuer Dienstleistungen. Bewusst nicht "schoener"
// formuliert als das Gesetz: Wer das Muster verwendet, genuegt der Informationspflicht, jede
// Abweichung ist angreifbar.

function anschriftZeilen(f) {
  const z = [f.firmenname || 'Schröder & Scholz'];
  if (f.strasse) z.push(f.strasse);
  const ort = ((f.plz || '') + ' ' + (f.ort || '')).trim();
  if (ort) z.push(ort);
  if (f.telefon) z.push('Telefon: ' + f.telefon);
  if (f.email) z.push('E-Mail: ' + f.email);
  return z;
}

// Reiner Text — fuer die Mail und fuer alles, was kein HTML kann.
function alsText(f) {
  const adr = anschriftZeilen(f).join('\n');
  return [
    'WIDERRUFSBELEHRUNG',
    '',
    'Widerrufsrecht',
    'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu',
    'widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.',
    '',
    'Um Ihr Widerrufsrecht auszuüben, müssen Sie uns',
    '',
    adr,
    '',
    'mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail)',
    'über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das',
    'untenstehende Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.',
    '',
    'Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des',
    'Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.',
    '',
    'Folgen des Widerrufs',
    'Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten',
    'haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die',
    'Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung',
    'verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt',
    'haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall',
    'werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.',
    '',
    'Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so',
    'haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu',
    'dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten,',
    'bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen',
    'Dienstleistungen entspricht.',
    '',
    'Vorzeitiges Erlöschen des Widerrufsrechts',
    'Ihr Widerrufsrecht erlischt bei einem Vertrag über die Erbringung von Dienstleistungen, wenn',
    'wir die Dienstleistung vollständig erbracht haben und mit der Ausführung der Dienstleistung',
    'erst begonnen haben, nachdem Sie dazu Ihre ausdrückliche Zustimmung gegeben haben und',
    'gleichzeitig Ihre Kenntnis davon bestätigt haben, dass Sie Ihr Widerrufsrecht bei',
    'vollständiger Vertragserfüllung durch uns verlieren.',
    '',
    'MUSTER-WIDERRUFSFORMULAR',
    '(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden',
    'Sie es zurück.)',
    '',
    'An:',
    adr,
    '',
    '– Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über die',
    '  Erbringung der folgenden Dienstleistung (*)',
    '– Bestellt am (*)',
    '– Name des/der Verbraucher(s)',
    '– Anschrift des/der Verbraucher(s)',
    '– Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)',
    '– Datum',
    '(*) Unzutreffendes streichen.'
  ].join('\n');
}

module.exports = { alsText, anschriftZeilen };
