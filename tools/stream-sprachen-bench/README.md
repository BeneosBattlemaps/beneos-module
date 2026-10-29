# Prüfstand: Streaming-Texte in allen dreizehn Sprachen

Misst `lang/*.json` gegen `templates/stream/*.hbs`.

## Ausführen

```
node bench.mjs
node bench.mjs --liste
```

Kein Foundry und kein Netz nötig.

## Worum es geht

Betreibervorgabe vom 29.10.2026: **zum Release müssen alle Strings in allen Sprachen vorliegen.** Dieser Stand ist die Messung dazu.

Der Anlass war `templates/stream/offline-vorrat.hbs`. Das Fenster, das den Offline-Vorrat zeigt, trug deutsche Festtexte, in einem Produkt mit dreizehn Sprachdateien. Ein Engländer las dort "Die Frist ist abgelaufen."

Beim Nachzählen kamen zwei weitere Lücken heraus, die niemand gemeldet hatte, weil nichts danach sah:

| Lücke | Umfang |
|---|---|
| `BENEOS.Stream.KeyRotated.*` fehlte ganz | 3 Schlüssel in 12 Dateien |
| Die komplette Erklärung beim ersten Weltstart stand auf Englisch | 11 Schlüssel in 12 Dateien |

Das war ausgerechnet der wichtigste Kundentext des ganzen Rollouts.

## Die drei Aussagen

1. **Jeder Schlüssel, den eine Streaming-Vorlage ruft, steht in `en.json`.** Ein Tippfehler im Schlüssel zeigt sonst den Schlüssel selbst auf dem Bildschirm.
2. **Jeder `BENEOS.Stream.*`-Schlüssel steht in allen dreizehn Dateien.** Dazu `BENEOS.Cloud.Bmap.Quota*`, weil die Speicherleiste zum selben Merkmal gehört.
3. **Keine Streaming-Vorlage trägt einen festen Text.** Zwei Leser, weil einer allein nicht reicht: Umlaute finden deutsche Festtexte, sichtbarer Rohtext zwischen zwei Tags findet auch englische.

## Warum "gleich wie Englisch" nur ein Hinweis ist

Kurze Wörter sind in mehreren Sprachen wirklich gleich. "Offline" heisst auf Französisch "Offline", und ein harter Fehler darauf wäre ein Fehlalarm, den irgendwann niemand mehr liest.

Ein **langer** englischer Satz in einer deutschen Datei ist dagegen nie eine Übersetzung, sondern eine vergessene. Die Grenze liegt deshalb bei der Länge, bei 25 Zeichen, und nicht bei der Gleichheit.

## Rot gesehen

Beim ersten Lauf von selbst: 36 fehlende Schlüssel und 96 unübersetzte Sätze. Dazu absichtlich, mit einem deutschen Festtext in der Vorlage:

```
FAIL kein sichtbarer Text steht roh zwischen zwei Tags
     offline-vorrat.hbs:41 "Noch keine Karte offline gestellt."
```

Dieser Satz trägt keinen Umlaut. Die Umlautprobe allein hätte ihn durchgelassen, und genau dafür gibt es die zweite.

## Wenn du einen Text änderst

Schlüssel in `lang/en.json` ändern, dann die zwölf anderen nachziehen. Dieser Stand sagt dir, welche fehlen.
