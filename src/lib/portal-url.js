// Die Adresse, die in KUNDEN-MAILS steht -- an einer Stelle, weil ein falscher Rueckfall hier
// teuer ist.
//
// Warum es diese Datei gibt: Der Rueckfall lautete an fuenf Stellen
//   'http://161.97.187.239/reifenpro/portal/'
// also unverschluesseltes http auf eine nackte IP-Adresse, dazu der alte Pfad. Ueber genau diese
// Adresse verschickt das Portal Passwort-Links, Bestaetigungslinks und Zustimmungslinks. Waere
// einstellungen.portal_url je leer, bekaeme der Kunde eine Mail, die
//   - nach Betrugsversuch aussieht (nackte IP statt der Firmenadresse) und
//   - ihn sein neues Passwort ueber eine unverschluesselte Verbindung eingeben laesst.
// Aufgefallen beim ersten vollstaendigen Durchlauf des Passwort-Wegs am 10.09.2026. Die
// IP-Adresse antwortet sogar mit HTTP 200 -- ein Rueckfall, der greift, faellt also nicht auf.
//
// Der Rueckfall zeigt jetzt auf dieselbe Adresse, die auch in den Einstellungen steht. Sie ist
// stabil; die IP kann sich beim naechsten Serverwechsel aendern, der Name nicht.

const STANDARD = 'https://www.schroeder-scholz.de/portal/';

// einst = Zeile aus `einstellungen` (oder irgendein Objekt mit portal_url).
// Rueckgabe: immer eine Adresse mit Schraegstrich am Ende, damit '?reset=...' sauber anhaengt.
//
// Greift der Rueckfall, wird das ins Protokoll geschrieben. Ein stiller Rueckfall ist beim
// naechsten Mal wieder unbemerkt -- und dann steht dieselbe Frage erneut an, nur ohne dass
// jemand danach sucht.
function portalUrl(einst) {
  const gepflegt = String((einst && einst.portal_url) || '').trim();
  if (gepflegt) return gepflegt.endsWith('/') ? gepflegt : gepflegt + '/';
  console.warn('[Portal-Adresse] einstellungen.portal_url ist leer — Rueckfall auf ' + STANDARD +
    ' benutzt. Bitte in den Einstellungen pflegen; Kunden-Mails enthalten diese Adresse.');
  return STANDARD;
}

module.exports = { portalUrl, STANDARD };
