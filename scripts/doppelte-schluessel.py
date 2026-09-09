#!/usr/bin/env python3
# Findet doppelte Schluessel im SELBEN Objektliteral -- in .js-Dateien und in den <script>-Bloecken
# von .html-Dateien.
#
# WARUM ES DAS GIBT: In JavaScript ist ein doppelter Schluessel kein Fehler. Der spaetere gewinnt,
# der fruehere verschwindet lautlos. Kein Absturz, keine Warnung, kein fehlschlagender Test --
# der Wert ist einfach nie da. Am 09.09.2026 hat die Portal-Sitzung genau so einen Fall gefunden:
# Ein neuer Leertext im Kundenprofil waere NIE erschienen, weil es den Schluessel no_vehicles im
# Woerterbuch schon gab. Die Woerterbuecher des Portals sind mehrere hundert Eintraege lang; von
# Hand findet man das nicht.
#
# Aufruf:  python3 scripts/doppelte-schluessel.py frontend/portal/index.html frontend/index.html
#          --sprachen  nur den Sprachabgleich, ohne die Doppler-Suche
# Rueckgabe: 0 wenn sauber, 1 wenn etwas gefunden wurde (fuer eine Pruefung vor dem Ausliefern).
#
# Zeichenketten, Kommentare und regulaere Ausdruecke werden uebersprungen. Die Zeilennummern
# beziehen sich bei .html-Dateien auf den zusammengesetzten Skriptteil, nicht auf die Datei --
# zum Wiederfinden den Namen greppen.
import io, re, sys

def schluessel_doppler(js):
    i, n = 0, len(js)
    stapel = []          # je offener Klammer: {} von Schluessel -> Zeile
    funde = []
    zeile = 1
    letztes_zeichen = ''
    while i < n:
        c = js[i]
        if c == '\n':
            zeile += 1; i += 1; letztes_zeichen = '\n'; continue
        if c in ' \t\r':
            i += 1; continue
        if js.startswith('//', i):
            j = js.find('\n', i); i = n if j < 0 else j; continue
        if js.startswith('/*', i):
            j = js.find('*/', i + 2)
            if j < 0: break
            zeile += js.count('\n', i, j); i = j + 2; continue
        if c in '"\'`':
            j = i + 1
            while j < n:
                if js[j] == '\\': j += 2; continue
                if js[j] == c: break
                if js[j] == '\n': zeile += 1
                j += 1
            i = j + 1; letztes_zeichen = c; continue
        if c == '/' and letztes_zeichen in '(,=:[!&|?{};\n' :
            j = i + 1; inklasse = False
            while j < n:
                if js[j] == '\\': j += 2; continue
                if js[j] == '[': inklasse = True
                elif js[j] == ']': inklasse = False
                elif js[j] == '/' and not inklasse: break
                elif js[j] == '\n': break
                j += 1
            if j < n and js[j] == '/':
                i = j + 1; letztes_zeichen = '/'; continue
        if c == '{':
            stapel.append({}); i += 1; letztes_zeichen = c; continue
        if c == '}':
            if stapel: stapel.pop()
            i += 1; letztes_zeichen = c; continue
        m = re.match(r"([A-Za-z_$][A-Za-z0-9_$]*|'[^']*'|\"[^\"]*\")\s*:", js[i:])
        if m and stapel and letztes_zeichen in '{,\n':
            name = m.group(1).strip('\'"')
            if name in stapel[-1]:
                funde.append((name, stapel[-1][name], zeile))
            else:
                stapel[-1][name] = zeile
            i += m.end(); letztes_zeichen = ':'; continue
        letztes_zeichen = c; i += 1
    return funde

# ── Zweite Pruefung: fehlen Schluessel in einer Sprache? ────────────────────────────────────────
#
# WARUM ZUSAETZLICH: Die Pruefung oben meldet gleiche Namen in VERSCHIEDENEN Objektliteralen
# absichtlich nicht -- de und en sollen dieselben Schluessel tragen. Genau deshalb faellt der
# umgekehrte Fall dort per Bauart durch: Ein Schluessel, den es nur in EINER Sprache gibt.
# Am 09.09.2026 ist das passiert: Beim Entdoppeln wurde password_repeat auch im englischen Block
# entfernt, wo er gar nicht doppelt war. Englische Nutzer haetten ueber den Rueckfall den
# deutschen Text gesehen -- kein Absturz, kein Test schlaegt fehl, es faellt nur irgendwann auf.
#
# Gemeldet wird nur, was auch VERWENDET wird: Ein ungenutzter Schluessel in einer Sprache ist
# folgenlos, und eine Liste voller folgenloser Meldungen liest bald niemand mehr.
def sprach_luecken(quelltext, verwendungstext=None):
    bloecke = {}
    # Sprachbloecke ueber KLAMMERZAEHLUNG finden, nicht ueber die Einrueckung. Die erste Fassung
    # suchte "\n  xx: {" mit genau zwei Leerzeichen -- ein Umbau, ein Formatierer oder eine
    # zusaetzliche Verschachtelung haetten die Bloecke unsichtbar gemacht, und der Abgleich haette
    # danach still "keine Luecken" gemeldet. Genau die Blindheit, gegen die es das Werkzeug gibt.
    # Hinweis der Admin-Sitzung beim Bau der Selbstpruefung; die schuetzt hier nicht, weil sie die
    # Probe prueft und nicht die echte Datei.
    for m in re.finditer(r"(?:^|[\s{,])([a-z]{2})\s*:\s*\{", quelltext):
        anfang = m.end() - 1          # Position der oeffnenden Klammer
        tiefe, i, n = 0, anfang, len(quelltext)
        while i < n:
            c = quelltext[i]
            if c == '{': tiefe += 1
            elif c == '}':
                tiefe -= 1
                if tiefe == 0: break
            i += 1
        if tiefe != 0:
            continue                  # unausgeglichene Klammern -> kein verwertbarer Block
        inhalt = quelltext[anfang + 1:i]
        # Nur was wie ein Woerterbuch aussieht: mehrere Schluessel, und keine verschachtelten
        # Objekte dazwischen, die die Zaehlung verfaelschen wuerden.
        namen = set(re.findall(r"(?:^|[\s{,])([a-zA-Z_][a-zA-Z_0-9]*)\s*:", inhalt))
        if len(namen) >= 2:
            bloecke[m.group(1)] = namen
    # Ein zweibuchstabiger Schluessel ist noch kein Woerterbuch -- irgendwo koennte auch ein
    # anderes Objekt so heissen. Woerterbuecher erkennt man daran, dass sie DIESELBEN Schluessel
    # tragen: Uebersetzungen derselben Sache. Bloecke ohne jede Ueberschneidung mit dem groessten
    # fliegen deshalb raus. Eine feste Mindestzahl an Schluesseln waere willkuerlich gewesen --
    # die Selbstpruefung hat genau das sofort aufgedeckt, weil ihre Probe kleiner ist.
    if len(bloecke) > 1:
        groesster = max(bloecke.values(), key=len)
        bloecke = {sp: k for sp, k in bloecke.items() if k is groesster or (k & groesster)}
    if len(bloecke) < 2:
        return []
    verwendung = verwendungstext if verwendungstext is not None else quelltext
    alle = set().union(*bloecke.values())
    funde = []
    for name in sorted(alle):
        fehlt_in = sorted(sp for sp, keys in bloecke.items() if name not in keys)
        if not fehlt_in:
            continue
        benutzt = bool(re.search(r"t\(['\"]" + re.escape(name) + r"['\"]\)", verwendung)
                       or re.search(r'data-i18n(?:-[a-z]+)?="' + re.escape(name) + r'"', verwendung))
        funde.append((name, fehlt_in, benutzt))
    return [f for f in funde if f[2]]


nur_sprachen = '--sprachen' in sys.argv
dateien = [a for a in sys.argv[1:] if not a.startswith('--')]

# Eine Datei pruefen. Bewusst als Funktion und nicht im Schleifenkoerper: Die Selbstpruefung
# unten nimmt genau diesen Weg. Sonst prueft sie die Finder einzeln und uebersieht, wenn sie
# falsch verdrahtet sind -- und genau das war der Fehler, gegen den sie schuetzen soll.
def pruefe(inhalt, ist_html, ohne_doppler=False):
    if ist_html:
        js = '\n'.join(m.group(1) for m in re.finditer(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', inhalt, re.S))
    else:
        js = inhalt
    doppler = [] if ohne_doppler else schluessel_doppler(js)
    # Woerterbuecher aus dem Skript, Verwendungen aus der GANZEN Datei: Bei .html stehen die
    # meisten Verwendungen als data-i18n im Markup, nicht im Skript.
    luecken = sprach_luecken(js, inhalt)
    return doppler, luecken

# ── Selbstpruefung ───────────────────────────────────────────────────────────────────────────
#
# Ein Werkzeug, das Fehler finden soll, muss einmal an einem ECHTEN Fehler gezeigt haben, dass es
# ihn findet. "Keine Funde" auf sauberen Dateien beweist gar nichts: Das kann Sauberkeit heissen
# oder Blindheit, und an der Ausgabe sieht man den Unterschied nicht.
#
# Am 09.09.2026 ist genau das passiert: Der erste Sprachabgleich suchte die Verwendungen nur in
# den <script>-Bloecken, waehrend sie bei .html groesstenteils als data-i18n im Markup stehen. Er
# meldete auf allen sauberen Dateien "keine Luecken" und war dabei blind. Aufgefallen ist es nur,
# weil eine Datei absichtlich beschaedigt wurde.
#
# Darum laeuft vor jeder Pruefung ein Beispiel mit, in dem beide Fehlerarten stecken. Schlagen
# die Finder dort nicht an, bricht das Werkzeug mit Rueckgabewert 2 ab -- ein "keine Funde" waere
# dann wertlos und gefaehrlicher als gar keine Pruefung.
# Die Probe muss die Form der echten Woerterbuecher haben: zwei Leerzeichen Einzug,
# zweibuchstabiger Sprachcode, schliessende Klammer wieder auf zwei Leerzeichen.
# ACHTUNG, das ist zugleich eine Empfindlichkeit des Sprachabgleichs: Wird die Einrueckung
# im Portal je geaendert, findet er die Bloecke nicht mehr -- und meldet dann "keine Luecken".
# Genau davor schuetzt diese Selbstpruefung nicht, denn sie prueft die Probe, nicht die Datei.
PROBE_JS = """
var I18N = {
  de: {
    gruss: 'Hallo',
    hinweis: 'ein Text mit { Klammer } und "gruss:" darin',
    /* gruss: 'im Kommentar, zaehlt nicht' */
    muster: /gruss:/,
    nur_deutsch: 'nur hier',
    gruss: 'Guten Tag'
  },
  en: {
    gruss: 'Hello',
    hinweis: 'a text'
  }
};
"""
# Die Verwendung steht NUR im Markup, nicht im Skript. Genau daran scheitert eine Fassung, die
# Verwendungen nur in den <script>-Bloecken sucht -- der Fehler vom 09.09.2026.
PROBE_HTML = '<html><body><span data-i18n="nur_deutsch">x</span><script>' + PROBE_JS + '</script></body></html>'

def selbstpruefung():
    ok = True
    doppler, luecken = pruefe(PROBE_HTML, True)
    if [x[0] for x in doppler] != ['gruss']:
        print('SELBSTPRUEFUNG: Der Doppelschluessel-Finder schlaegt nicht an. Erwartet ["gruss"], '
              'gefunden ' + str([x[0] for x in doppler]) + '.', file=sys.stderr)
        ok = False
    if [x[0] for x in luecken] != ['nur_deutsch']:
        print('SELBSTPRUEFUNG: Der Sprachabgleich schlaegt nicht an. Erwartet ["nur_deutsch"], '
              'gefunden ' + str([x[0] for x in luecken]) + '.', file=sys.stderr)
        ok = False
    if not ok:
        print('Das Werkzeug ist nicht verlaesslich -- ein "keine Funde" waere hier wertlos.', file=sys.stderr)
    return ok

if not selbstpruefung():
    sys.exit(2)

gefunden = False
for datei in dateien:
    s = io.open(datei, encoding='utf-8').read()
    f, l = pruefe(s, datei.endswith('.html'), nur_sprachen)
    if f or l:
        print(datei + ':')
        for name, z1, z2 in f: print('   ' + name + '  zuerst bei Zeile ' + str(z1) + ', erneut bei ' + str(z2))
        for name, fehlt_in, _ in l: print('   ' + name + '  fehlt in: ' + ', '.join(fehlt_in) + '  (wird verwendet)')
    else:
        print(datei + ': keine doppelten Schluessel' + ('' if nur_sprachen else ', keine Sprachluecken'))
    if f or l: gefunden = True

sys.exit(1 if gefunden else 0)
