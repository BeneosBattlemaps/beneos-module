# -*- coding: utf-8 -*-
"""Erzeuger der sechs Streaming-Ersatzbilder unter `ui/`.

WOFUER SIE DA SIND
------------------
Eine Abweisung des Tores kommt als HTTP 200 mit einem durchsichtigen GIF von
42 Byte. Das ist ein gueltiges Bild: Foundry zeichnet es, PIXI meldet nichts,
die Konsole bleibt still, und der Spielleiter sieht ein leeres Feld und haelt
das Modul fuer defekt. Diese sechs Dateien sind die Antwort darauf. Sie werden
von `scripts/stream/stream-fetch.mjs` geladen (`ERSATZ_PFAD`), nicht vom Tor
geholt, und nie in den Vorrat gelegt.

WARUM ES DIESE DATEI GIBT
-------------------------
Die sechs Bilder lagen seit `b14ee5b` im Modul, ihr Erzeuger nirgends. Wer sie
aendern wollte, haette raten muessen. Diese Datei ist eine NEUSCHRIFT nach
Messung der vorhandenen Bilder und kein wiedergefundenes Original; sie trifft
die alten Dateien nicht byte-gleich. Arbeitspaket `OP-PRJ-207`.

DER VERTRAG, DEN SIE NICHT BRECHEN DARF
---------------------------------------
`stream-fetch.mjs` baut den Dateinamen aus zwei Teilen zusammen und setzt den
Inhaltstyp fest auf `image/webp`:

    ui/beneos_stream_<ursache>_<form>.webp
    ursache: offline | denied          (zwei Ursachen, zwei Bilder)
    form:    token | card | journal    (aus `ersatzForm()`, nach der Rolle)

ZWEI URSACHEN, ZWEI BILDER, und das ist keine Verdopplung ohne Grund: ein
einziges Bild fuer beides macht jeden Supportfall unaufloesbar. "offline"
heisst warten, "kein Zugang" heisst klaeren.

DREI FORMEN, weil das Ersatzbild im Feld der ausgefallenen Datei sitzt. Ein
Journalbild ist Breitbild, eine Klappkarte hochkant, ein Token quadratisch.
Ein quadratisches Ersatzbild in einem Breitbildfeld wird verzerrt.

WOHER DIE WERTE KOMMEN
----------------------
Farben: Bone-Palette, `J:/_ai/claude/design/standard.md` Abschnitt 2.5,
Fassung 1.3 vom 2026-11-04. Gemessen an den alten Dateien trugen zwei der drei
Farben bereits exakt ein Token der Palette; die Scheibe lag mit `#0c0c0a` um
zwei Stufen daneben und steht hier auf dem Tokenwert.

    Scheibe  --color-bg-base        #0e0d0a   (alt gemessen: #0c0c0a)
    Rand     --color-border-strong  #463b2c   (alt gemessen: gleich)
    Symbol   --color-text-secondary #a7a596   (alt gemessen: gleich)

Die Symbolfarbe ist Nebentext und ausdruecklich KEINE Zustandsfarbe. Der
Standard sagt dazu in 2.5: "Gesperrt, nicht verbunden, nicht installiert:
keine Zustandsfarbe, Nebentext mit Schloss oder Wort. Gesperrt ist ein
Zustand, kein Fehler." Ein rotes Ersatzbild waere ein Regelverstoss.

Ein Icon ohne Text ist hier erlaubt und richtig: die Beneos-Regel verbietet
das Icon NEBEN einer Beschriftung und erlaubt es als Ersatz fuer sie. Auf
einer Tokentextur gibt es keine Beschriftung, die es begleiten koennte, und
Text auf einem Feld von 512 Pixeln waere in jeder Sprache anders lang.

Geometrie: gemessen an den alten Dateien am 2026-11-08. Kreis mittig,
Durchmesser 68,3 Prozent der kuerzeren Seite (350 von 512, 368 von 540),
Randstaerke 8 Pixel bei 512, Symbolhoehe des Schlosses 33,7 Prozent des
Kreises, Symbolbreite des WLAN-Zeichens 41,7 Prozent.

AUFRUF
------
    python tools/ersatzbilder.py            schreibt nach ui/
    python tools/ersatzbilder.py --pruefen  schreibt nichts, meldet nur Masse

Braucht Pillow (`pip install pillow`). Das Modul selbst braucht es nicht: die
Ergebnisse liegen committet im Repository, diese Datei laeuft nur, wenn jemand
die Bilder aendern will.
"""

import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.stderr.write("Pillow fehlt. pip install pillow\n")
    raise SystemExit(2)


# --- Die Werte, an denen gedreht wird ---------------------------------------

# Farben aus der Bone-Palette, siehe Kopf.
SCHEIBE = (0x0E, 0x0D, 0x0A, 220)
RAND = (0x46, 0x3B, 0x2C, 255)
SYMBOL = (0xA7, 0xA5, 0x96, 255)

# Die drei Formen und ihre Masse. Die Namen sind Vertrag, siehe Kopf.
FORMEN = {
    "token": (512, 512),     # Tokentextur auf der Leinwand, quadratisch
    "card": (512, 768),      # Klappkarte eines Gegenstands, hochkant
    "journal": (960, 540),   # Journalbild einer Kreatur, Breitbild
}

# Kreis: Anteil des Durchmessers an der kuerzeren Seite, und die Randstaerke
# als Anteil derselben Seite. Beide an den alten Dateien gemessen.
KREIS_ANTEIL = 0.683
RAND_ANTEIL = 8.0 / 512.0

# Symbolgroessen als Anteil des Kreisdurchmessers.
SCHLOSS_HOEHE = 0.337
WLAN_BREITE = 0.417

# Das WLAN-Zeichen sitzt etwas tiefer als die Mitte, weil seine Boegen nach
# oben offen sind und es sonst kopflastig wirkt. Anteil des Durchmessers.
WLAN_VERSATZ = 0.026

# Vielfaches, in dem gezeichnet und danach verkleinert wird. Ohne das haetten
# Kreisrand und Boegen harte Treppen; WebP mit Alpha zeigt sie deutlich.
UEBERABTASTUNG = 4

# Qualitaet des WebP-Schreibers. 92 trifft die Groessenordnung der alten
# Dateien (17.6 bis 21.3 KB) ohne sichtbare Artefakte an den Kanten.
WEBP_QUALITAET = 92


# --- Zeichnen ----------------------------------------------------------------

def _kapsel(zeichner, x0, y0, x1, y1, farbe):
    """Ein Rechteck mit halbkreisfoermigen Enden, senkrecht."""
    r = (x1 - x0) / 2.0
    zeichner.ellipse([x0, y0, x1, y0 + 2 * r], fill=farbe)
    zeichner.ellipse([x0, y1 - 2 * r, x1, y1], fill=farbe)
    zeichner.rectangle([x0, y0 + r, x1, y1 - r], fill=farbe)


def _schloss(zeichner, mx, my, hoehe, farbe, loch_farbe):
    """Ein geschlossenes Vorhaengeschloss, Material-Bauart.

    `hoehe` ist die Gesamthoehe aus Buegel und Koerper. Die Verhaeltnisse
    darin sind an der alten Datei gemessen und hier als Bruchteile von
    `hoehe` geschrieben, damit das Zeichen in jeder Groesse gleich aussieht.
    """
    b = hoehe * 0.949          # Gesamtbreite, gemessen 112 zu 118
    koerper_h = hoehe * 0.678
    buegel_b = b * 0.625
    buegel_s = hoehe * 0.170   # Strichstaerke des Buegels
    ecke = b * 0.09

    oben = my - hoehe / 2.0
    unten = my + hoehe / 2.0

    # Buegel: ein Ring, von dem nur der obere Teil sichtbar bleibt, weil der
    # Koerper darueber liegt. Als Ring gezeichnet, damit die Innenkante sauber
    # rund ist statt aus zwei Boegen zusammengesetzt.
    bx0, bx1 = mx - buegel_b / 2.0, mx + buegel_b / 2.0
    by1 = unten - koerper_h
    zeichner.ellipse([bx0, oben, bx1, oben + buegel_b], fill=farbe)
    zeichner.rectangle([bx0, oben + buegel_b / 2.0, bx1, by1], fill=farbe)
    zeichner.ellipse([bx0 + buegel_s, oben + buegel_s,
                      bx1 - buegel_s, oben + buegel_b - buegel_s], fill=(0, 0, 0, 0))
    zeichner.rectangle([bx0 + buegel_s, oben + buegel_b / 2.0,
                        bx1 - buegel_s, by1], fill=(0, 0, 0, 0))

    # Koerper
    zeichner.rounded_rectangle([mx - b / 2.0, unten - koerper_h, mx + b / 2.0, unten],
                               radius=ecke, fill=farbe)

    # Schluesselloch, ausgestanzt. Es traegt die Farbe der Scheibe und nicht
    # Transparenz: das Bild liegt auf der Leinwand ueber dem Spielfeld, ein
    # durchsichtiges Loch zeigte die Karte darunter.
    loch_b = b * 0.152
    loch_h = hoehe * 0.331
    loch_my = unten - koerper_h / 2.0
    _kapsel(zeichner, mx - loch_b / 2.0, loch_my - loch_h / 2.0,
            mx + loch_b / 2.0, loch_my + loch_h / 2.0, loch_farbe)


# Das WLAN-Zeichen, in Anteilen seiner Breite. Alle Werte sind am Zeilenprofil
# der alten Datei gemessen (512er Fassung, Zeichen 146 breit und 109 hoch):
# der aeussere Bogen traegt Aussenradius 105 um einen Mittelpunkt bei (73,105),
# nachgerechnet an drei Zeilen (y=7 ergibt rechnerisch x 35 bis 111, gemessen
# 35 bis 110). Die Boegen sind BREITER als das Zeichen und werden an seinem
# Rahmen abgeschnitten, genau wie im Vorbild.
WLAN_HOEHE = 0.747
WLAN_FUSS = 0.963          # Bogenmittelpunkt, Anteil der Hoehe von oben
WLAN_RADIEN = (0.719, 0.521, 0.274)
WLAN_STRICH = 0.116
# Halbe Winkelspanne je Bogen, in Grad, um die Senkrechte. DIE BOEGEN SIND
# KEINE HALBKREISE: im Vorbild endet der mittlere bei x=20 eines 146 breiten
# Zeichens, was asin(53/77) gleich 43,5 Grad entspricht, und der aeussere
# verlaesst den Rahmen bei asin(73/104) gleich 44,5 Grad. Gesetzt ist 50, weil
# `arc` um die MITTELLINIE zeichnet und das Zeichen mit 44 Grad 132 statt 146
# breit wird; bei 50 trifft es die gemessene Breite genau. Mit 90 Grad statt
# 44 laufen die Boegen senkrecht bis zum Fuss und das Zeichen wird ein
# Halbkreis statt eines Faechers.
WLAN_WINKEL = 50.0
WLAN_PUNKT_R = 0.089
WLAN_PUNKT_Y = 0.880       # Mittelpunkt des Punktes, Anteil der Hoehe
WLAN_TRENNUNG = 0.041      # dunkle Trennlinie je Seite des Balkens
# Halbe Laenge des Balkens, Anteil der Breite. Er endet INNERHALB des Zeichens
# und nicht an dessen Kante: im Vorbild laeuft er von (34,97) nach (110,14)
# eines 146 breiten Zeichens, also 112 lang statt der 153, die eine Diagonale
# durch den ganzen Kasten haette.
WLAN_BALKEN = 0.385


def _wlan_aus(zeichner, mx, my, breite, farbe, schnitt_farbe):
    """Das WLAN-Zeichen mit Balken, Material-Bauart.

    Drei Boegen und ein Punkt, danach ein diagonaler Balken. Der Balken wird
    zweimal gezeichnet: erst breit in der Schnittfarbe, damit er die Boegen
    sichtbar durchtrennt, dann schmaler in der Symbolfarbe. Ohne den ersten
    Schritt laege er nur auf den Boegen und verschwaende in ihnen.

    Zeichnet in einen eigenen Kasten und gibt ihn zurueck, damit der Aufrufer
    die ueberstehenden Boegen abschneiden kann.
    """
    hoehe = breite * WLAN_HOEHE
    oben = my - hoehe / 2.0
    unten = my + hoehe / 2.0
    fuss = oben + hoehe * WLAN_FUSS
    strich = breite * WLAN_STRICH

    for anteil in WLAN_RADIEN:
        # Der Bogen wird um seine Mittellinie gezeichnet, darum der halbe
        # Strich nach innen. `anteil` nennt den AUSSENradius, weil der an den
        # alten Dateien messbar war.
        rm = breite * anteil - strich / 2.0
        zeichner.arc([mx - rm, fuss - rm, mx + rm, fuss + rm],
                     start=270 - WLAN_WINKEL, end=270 + WLAN_WINKEL,
                     fill=farbe, width=int(round(strich)))

    pr = breite * WLAN_PUNKT_R
    py = oben + hoehe * WLAN_PUNKT_Y
    zeichner.ellipse([mx - pr, py - pr, mx + pr, py + pr], fill=farbe)

    # Balken unter 45 Grad, von unten links nach oben rechts, durch die Mitte
    # des Zeichens. Erst die Trennung, dann der Balken selbst.
    d = breite * WLAN_BALKEN / 1.4142
    zeichner.line([mx - d, my + d, mx + d, my - d], fill=schnitt_farbe,
                  width=int(round(strich + 2 * breite * WLAN_TRENNUNG)))
    zeichner.line([mx - d, my + d, mx + d, my - d], fill=farbe,
                  width=int(round(strich)))

    return (mx - breite / 2.0, oben, mx + breite / 2.0, unten)


def baue(ursache, form, breite, hoehe):
    """Ein Bild, in Ueberabtastung gezeichnet und danach verkleinert."""
    s = UEBERABTASTUNG
    bild = Image.new("RGBA", (breite * s, hoehe * s), (0, 0, 0, 0))
    z = ImageDraw.Draw(bild)

    kurz = min(breite, hoehe) * s
    d = kurz * KREIS_ANTEIL
    rand = kurz * RAND_ANTEIL
    mx, my = breite * s / 2.0, hoehe * s / 2.0

    z.ellipse([mx - d / 2.0, my - d / 2.0, mx + d / 2.0, my + d / 2.0], fill=RAND)
    z.ellipse([mx - d / 2.0 + rand, my - d / 2.0 + rand,
               mx + d / 2.0 - rand, my + d / 2.0 - rand], fill=SCHEIBE)

    # Die Scheibe ist halbdurchsichtig. Das Symbol darf nicht durch sie
    # hindurch mit ihr verrechnet werden, also wird ab hier voll deckend
    # gezeichnet und das Ergebnis am Ende ueber die Scheibe gelegt.
    deck = Image.new("RGBA", bild.size, (0, 0, 0, 0))
    zd = ImageDraw.Draw(deck)

    kasten = None
    if ursache == "denied":
        _schloss(zd, mx, my, d * SCHLOSS_HOEHE, SYMBOL, (0, 0, 0, 0))
    elif ursache == "offline":
        kasten = _wlan_aus(zd, mx, my + d * WLAN_VERSATZ, d * WLAN_BREITE,
                           SYMBOL, (0, 0, 0, 0))
    else:
        raise ValueError("Unbekannte Ursache: %r" % ursache)

    # Das Zeichen auf seinen eigenen Kasten begrenzen. Boegen und Balken des
    # WLAN-Zeichens laufen absichtlich darueber hinaus, damit sie an der Kante
    # gerade abschliessen statt rund auszulaufen; das Vorbild macht es so.
    if kasten:
        maske = Image.new("L", bild.size, 0)
        ImageDraw.Draw(maske).rectangle(kasten, fill=255)
        deck.putalpha(Image.composite(deck.getchannel("A"),
                                      Image.new("L", bild.size, 0), maske))
    bild.alpha_composite(deck)

    return bild.resize((breite, hoehe), Image.LANCZOS)


def main(argv):
    nur_pruefen = "--pruefen" in argv
    hier = os.path.dirname(os.path.abspath(__file__))
    ziel = os.path.join(os.path.dirname(hier), "ui")
    if not os.path.isdir(ziel):
        sys.stderr.write("Zielordner fehlt: %s\n" % ziel)
        return 2

    for ursache in ("offline", "denied"):
        for form, (b, h) in FORMEN.items():
            name = "beneos_stream_%s_%s.webp" % (ursache, form)
            pfad = os.path.join(ziel, name)
            bild = baue(ursache, form, b, h)
            if nur_pruefen:
                print("%-40s %4dx%-4d  wuerde geschrieben" % (name, b, h))
                continue
            bild.save(pfad, "WEBP", quality=WEBP_QUALITAET, lossless=False)
            print("%-40s %4dx%-4d %7d Byte" % (name, b, h, os.path.getsize(pfad)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
