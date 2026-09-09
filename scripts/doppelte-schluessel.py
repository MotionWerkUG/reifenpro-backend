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
    for m in re.finditer(r"\n  ([a-z]{2}): \{(.*?)\n  \}", quelltext, re.S):
        bloecke[m.group(1)] = set(re.findall(r"(?:^|[\s{,])([a-zA-Z_][a-zA-Z_0-9]*):", m.group(2)))
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

gefunden = False
for datei in dateien:
    s = io.open(datei, encoding='utf-8').read()
    if datei.endswith('.html'):
        js = '\n'.join(m.group(1) for m in re.finditer(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', s, re.S))
    else:
        js = s
    f = [] if nur_sprachen else schluessel_doppler(js)
    l = sprach_luecken(js, s)   # Woerterbuecher aus dem Skript, Verwendungen aus der GANZEN Datei
    if f or l:
        print(datei + ':')
        for name, z1, z2 in f: print('   ' + name + '  zuerst bei Zeile ' + str(z1) + ', erneut bei ' + str(z2))
        for name, fehlt_in, _ in l: print('   ' + name + '  fehlt in: ' + ', '.join(fehlt_in) + '  (wird verwendet)')
    else:
        print(datei + ': keine doppelten Schluessel' + ('' if nur_sprachen else ', keine Sprachluecken'))
    if f or l: gefunden = True

sys.exit(1 if gefunden else 0)
