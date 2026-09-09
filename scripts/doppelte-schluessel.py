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

gefunden = False
for datei in sys.argv[1:]:
    s = io.open(datei, encoding='utf-8').read()
    if datei.endswith('.html'):
        js = '\n'.join(m.group(1) for m in re.finditer(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', s, re.S))
    else:
        js = s
    f = schluessel_doppler(js)
    if f:
        print(datei + ':')
        for name, z1, z2 in f: print('   ' + name + '  zuerst bei Zeile ' + str(z1) + ', erneut bei ' + str(z2))
    else:
        print(datei + ': keine doppelten Schluessel')
    if f: gefunden = True

sys.exit(1 if gefunden else 0)
