# Bench: welche Stelle bricht, wenn Foundry einen Globalen entfernt

Foundry 13 hat 378 Klassen und Funktionen in Namensräume verschoben und den alten
globalen Namen als Übergangshilfe stehen gelassen. Die Hilfe trägt bis
einschliesslich Foundry 14 und fällt in **Foundry 15** weg. `module.json` steht auf
`minimum: 13`, `verified: 14`.

```
node bench.mjs
node bench.mjs --verbose
node bench.mjs --foundry "<Pfad zum App-Ordner>"
node bench.mjs --sabotage      # muss rot werden
```

| Austritt | Bedeutung |
|---|---|
| 0 | nicht mehr Stellen als die Obergrenze erlaubt |
| 1 | eine Stelle zu viel, oder eine Selbstprobe rot |
| 2 | nicht messbar: keine Foundry, zu wenige Namen, zu wenige Dateien |

Austritt 2 gibt es, weil "nichts gefunden" und "nichts gemessen" sonst gleich
aussehen. Dieselbe Begründung trägt `v14-import-bench`.

## Die eine Aussage

**Keine Stelle im Modul greift auf einen globalen Namen zu, den Foundry 15
entfernt, ohne dass die Obergrenze es weiss.**

Gemessen am 09.11.2026: **24 Stellen**, verteilt auf acht Namen. Vor diesem Lauf
waren es 30; sechs sind am selben Tag auf den Namensraum umgestellt.

## Die Namensliste wird nicht geraten

Sie kommt aus der installierten Foundry selbst, aus den Aufrufen von
`addBackwardsCompatibilityReferences` in `public/scripts/foundry.mjs`. Damit wächst
sie mit jeder Fassung mit, und ein Name, den Foundry neu verschiebt, erscheint
hier ohne Zutun.

Gemessen am 09.11.2026 über beide installierten Fassungen:

| | Namen |
|---|---|
| Foundry 13 führt sie als veraltet | **378** |
| Foundry 14 führt sie als veraltet | **347** |
| in 13 veraltet, in 14 **gar nicht mehr vorhanden** | **31** |

Die 31 sind `AmbientLightConfig`, `AmbientSoundConfig`, `AudioHelper`, `BaseGrid`,
`Coin`, `DarknessSource`, `DiceTerm`, `Die`, `FateDie`, `GlobalLightSource`,
`GridHex`, `HexagonalGrid`, `JournalTextTinyMCESheet`, `LightSource`, `MathTerm`,
`MersenneTwister`, `MovementSource`, `NumericTerm`, `OperatorTerm`,
`ParentheticalTerm`, `PermissionConfig`, `PoolTerm`, `RollTerm`, `Sound`,
`SoundSource`, `SquareGrid`, `StringTerm`, `UserConfig`, `VisionSource`,
`WordTree` und `twist`.

**Das Modul nutzt keinen dieser 31 ohne Rückfall**, gemessen am 09.11.2026. Die
zehn Stellen an `AudioHelper` und die vier an `Sound` tragen alle eine
`typeof`-Wache oder eine lokale Bindung. An dieser Stelle ist das Modul für
Foundry 14 sauber.

## Warum ein statischer Satz und keine Messung im Browser

Foundry meldet den Zugriff auf einen veralteten Globalen **nur einmal je Name und
Sitzung**, `once: true` in `addBackwardsCompatibilityReferences`. Eine
Konsolenmitschrift nennt deshalb genau die Stellen, die zufällig zuerst gelaufen
sind.

Am 09.11.2026 hat eine Messung im laufenden Foundry 13 genau **eine** der damals
sechs offenen `renderTemplate`-Stellen gezeigt, nämlich
`scripts/loot/item-sheet-extender.mjs:79`. Ein zweiter Durchgang im selben
Browser zeigte **null**, weil die Meldung schon gefallen war. Dieser Satz findet
alle sechs in 0,3 Sekunden.

## Ein Rückfall auf den nackten Namen trägt nicht

Das ist der feine Teil, und das Modul trägt ihn zehnmal falsch:

```js
const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
```

Heute greift die linke Seite, der rechte Zweig wird nie bewertet. Fällt der
Globale in Foundry 15 weg, wirft `?? FilePicker` einen **ReferenceError**, denn
ein nackter Bezeichner ohne Bindung ist kein `undefined`. Richtig wäre
`?? globalThis.FilePicker`, das liefert `undefined`.

Diese zehn Stellen brechen also **nur dann**, wenn Foundry den Namensraum
zusätzlich umbaut. Sie sind eine Falle, kein heutiger Ausfall, und sie stehen
darum in derselben Zahl, aber mit dieser Einordnung.

## Der rote Lauf

Ein grüner Satz, der nicht rot werden kann, beweist nichts. Drei Wege, alle am
09.11.2026 gefahren:

| Sabotage | Lauf |
|---|---|
| `--sabotage`, Obergrenze künstlich überschritten | **Austritt 1**, 123 statt 24 |
| eine echte neue Stelle `new Ray(...)` in `scripts/` gelegt | **Austritt 1**, 25 statt 24 |
| `--foundry` auf einen Ort ohne Foundry | **Austritt 2**, nicht messbar |

Die zweite ist die ernste: eine Datei neben dem Bestand angelegt, Lauf gefahren,
Datei entfernt, danach `git status` gegengeprüft.

## Die sechzehn Selbstproben

Sie laufen bei **jedem** Lauf. Ist der Leser kaputt, meldet der Satz es, statt
still null Befunde zu zeigen. Der Leser muss Code von Text trennen, und das ist
die eigentliche Arbeit: ein Name in einer Zeichenkette, in einem Kommentar, in
einem Regex-Literal oder in einem Template-Literal ist kein Zugriff.

**Die Proben haben beim ersten Lauf einen echten Entwurfsfehler gefangen.** Sie
hingen an Foundrys Namensliste, und `UserConfig` steht dort seit Foundry 14 nicht
mehr: drei Proben meldeten den richtigen Leser als kaputt. Sie laufen jetzt gegen
eine eigene feste Namensmenge, denn sie prüfen den Leser und nicht die Liste.

**Drei Messwege haben vorher falsch gemessen**, und jeder sah nach einem Befund
aus:

| Messweg | meldete | warum falsch |
|---|---|---|
| zeilenweiser Regex | **40** Stellen | ein mehrzeiliges Blockkommentar oder Template-Literal beginnt auf einer anderen Zeile, also galt sein Text als Code |
| Regex-Erkennung über das letzte Zeichen | 1 Fehlalarm | nach `return` ist `/x/` ein Regex, und `zuletzt` hielt nur ein Zeichen; das letzte **Wort** entscheidet |
| Einsetzung `${...}` nicht rekursiv gelesen | 1 Fehlalarm | darin steht wieder Code, und darin wieder Text: `` `A${t === "JournalEntry" ? "Journal" : t}` `` |

Alle drei führen auf dieselbe Zahl, sobald der Messweg stimmt.

## Nicht prüfbar

- **Ein Zugriff, der den Namen zur Laufzeit zusammensetzt**, etwa
  `globalThis["render" + "Template"]`, wird nicht erkannt. Kein Muster fängt ihn.
- **Die 24 verbliebenen Stellen sind nicht bewertet**, nur gezählt. Vierzehn
  liegen in `scripts/beneos-table-top.js`, und ob der Tabletop-Modus in Foundry 15
  ohnehin anders gebaut werden muss, ist eine eigene Frage. Sie stehen als
  eigenes Arbeitspaket.
- **Ordner ausser `scripts/`** fallen nicht in diesen Satz. Vorlagen und
  `tools/` sind nicht gelesen, weil dort kein Modulcode zur Laufzeit läuft.
- **Ob Foundry 15 die Globalen wirklich entfernt**, steht nur in Foundrys eigener
  Ankündigung `until: 15`. Eine Foundry 15 gibt es nicht zum Messen.
- **Wer die Obergrenze hochsetzt, statt die Stelle zu beheben**, wird von keinem
  Satz gefangen. Dagegen schützt allein die Durchsicht des Diffs.
