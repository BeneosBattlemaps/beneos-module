/**
 * EIN FALSCHER HAKENNAME IST EIN STILLER FEHLER, UND DIESER HAT EINEN
 * KUNDENAUSFALL GETRAGEN.
 *
 * `OP-PRJ-216`. Bis zum 2026-11-09 band `ItemSheetExtender.register()` den
 * Namen `renderItemSheet`, und der gehoert zu Fassung 12. Gemessen am
 * 2026-11-08 in der Welt `v13-streaming` mit einem Zaehler auf beiden Namen:
 * beim Oeffnen eines Item-Blattes feuert `renderItemSheet` NULL mal und
 * `renderItemSheet5e` EIN mal.
 *
 * Was das gekostet hat: `_inject()` wurde nie gerufen. An einem Item MIT
 * vollstaendigen Beute-Vermerken stand `.beneos-loot-extras` null mal im
 * Blatt, und kein einziges Element mit `beneos` im Namen. Die Tabelle aus
 * Typ, Set-Typ und Stufe sah der Kunde nicht. Nichts davon war ein Fehler,
 * den irgendeine Pruefung melden konnte: der Haken registriert sich ohne
 * Klage, und ein Name, der nie feuert, sieht wie ein Blatt ohne
 * Beute-Vermerke aus.
 *
 * DIESER SATZ LIEST QUELLTEXT UND FAEHRT NICHTS, und das steht hier, damit
 * ihn niemand fuer mehr haelt. Er kann nicht pruefen, dass der Haken feuert;
 * das braucht ein laufendes Foundry mit dnd5e und ist `TC-PRJ-STR-308`. Was
 * er kann, ist die Klasse von Fehler zu fangen, die hier wirklich passiert
 * ist: ein Name aus der falschen Fassung, von Hand hineingeschrieben.
 *
 * Nach dem Vorbild von `scripts/stream/stream-bilder.test.mjs`, das dieselbe
 * Frage fuer die fuenf Bildflaechen stellt.
 *
 * Lauf:  node scripts/loot/item-sheet-extender.test.mjs
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HIER = dirname(fileURLToPath(import.meta.url))
const QUELLE = readFileSync(join(HIER, "item-sheet-extender.mjs"), "utf8")
const NACHBAR = readFileSync(
  join(HIER, "..", "codex2", "item-companion.mjs"), "utf8")

let rot = 0
let gruen = 0

function gleich(name, ist, soll) {
  if (ist === soll) {
    gruen += 1
    console.log(`  ok   ${name}`)
  } else {
    rot += 1
    console.log(`  ROT  ${name}`)
    console.log(`       ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`)
  }
}

function wahr(name, bedingung) { gleich(name, !!bedingung, true) }

// ===========================================================================
console.log("Der Hakenname steht als Konstante und ist der gemessene")

/*
 * DIE SUCHE SELBST IST EIN SATZ. Findet sie nichts, liefen alle folgenden
 * Pruefungen ueber eine leere Zeichenkette gruen durch, und genau so sieht
 * ein kaputtes Suchmuster aus.
 */
const treffer = QUELLE.match(/^const HAKEN = "(\w+)";$/m)
wahr("item-sheet-extender.mjs fuehrt eine HAKEN-Konstante", Boolean(treffer))

const HAKEN = treffer?.[1] ?? ""
gleich("HAKEN ist der gemessene Name", HAKEN, "renderItemSheet5e")

/*
 * UND DIE KONSTANTE WIRD AUCH BENUTZT. Eine richtige Konstante neben einem
 * hartgeschriebenen `Hooks.on("renderItemSheet", ...)` waere dieselbe Luecke
 * wie vorher, nur mit einem beruhigenden Namen daneben. Dieselbe Lehre wie
 * bei `OP-PRJ-120`: eine gepruefte Groesse, die niemand ruft, ist wertlos.
 */
wahr("register() bindet die Konstante und keinen getippten Namen",
  /Hooks\.on\(HAKEN,/.test(QUELLE))
gleich("es gibt keinen zweiten Hooks.on mit einer Zeichenkette",
  (QUELLE.match(/Hooks\.on\(\s*"/g) || []).length, 0)
gleich("und genau einen Hooks.on ueberhaupt",
  (QUELLE.match(/Hooks\.on\(/g) || []).length, 1)

// ===========================================================================
console.log("\nDie stummen Namen, und sie sind der Inhalt dieses Satzes")

/*
 * `renderItemSheet` ist der Name aus Fassung 12 und stand bis zum 2026-11-09
 * genau hier. `renderItemSheetV2` ist der Name, den `renderActorSheetV2`
 * naheliegend macht, und er feuert bei dnd5e 5.3.3 ebenfalls nicht, weil
 * `ItemSheet5e` nicht von `ItemSheetV2` erbt. `renderActorSheet` und
 * `renderActorSheetV2` sind das falsche Dokument.
 */
for (const stumm of ["renderItemSheet", "renderItemSheetV2",
                     "renderActorSheet", "renderJournalSheet"]) {
  gleich(`der stumme Name ${stumm} steht NICHT in der Datei`,
    (QUELLE.match(new RegExp(`"${stumm}"`, "g")) || []).length, 0)
}

/*
 * UND DIE ZU BREITEN NAMEN. Foundry V13 laesst alle Eltern-Haken der
 * Klassenkette feuern. `renderDocumentSheetV2` traegt Item, Actor UND
 * Journal, `renderApplicationV2` traegt jedes Fenster. Ein Haken darauf
 * riefe `_inject()` mehrfach je Render; der Doppelschutz faengt das, aber
 * dreimal zu rechnen, um zweimal nichts zu tun, ist kein Entwurf.
 */
for (const zuBreit of ["renderDocumentSheetV2", "renderApplicationV2",
                       "renderHandlebarsApplication", "renderDocumentSheet5e"]) {
  gleich(`${zuBreit} steht nicht in der Datei, es doppelte den Lauf`,
    (QUELLE.match(new RegExp(`"${zuBreit}"`, "g")) || []).length, 0)
}

// ===========================================================================
console.log("\nDer Nachbar traegt denselben Namen, und das ist die Gegenprobe")

/*
 * WARUM DER NACHBAR MITGEPRUEFT WIRD. `item-companion.mjs` hing von Anfang
 * an am richtigen Namen und traegt die Begruendung im Kommentar. Er ist
 * damit die unabhaengige Quelle fuer die Zahl oben: stimmt der Name in
 * dieser Datei mit dem des Nachbarn ueberein, ist er nicht aus meinem
 * Gedaechtnis, sondern aus einem zweiten Bestand.
 *
 * WAS DAS NICHT BEWEIST: dass der Name richtig IST. Wenn dnd5e ihn eines
 * Tages umbenennt, sind beide Dateien gleich falsch, und dieser Satz bleibt
 * gruen. Dagegen hilft nur ein Lauf im echten Foundry.
 */
const nachbarListe = NACHBAR.match(/const ATTACH_HOOKS = \[([^\]]*)\]/)
wahr("item-companion.mjs fuehrt eine ATTACH_HOOKS-Liste",
  Boolean(nachbarListe))
const nachbarNamen = [...(nachbarListe?.[1] ?? "")
  .matchAll(/"(\w+)"/g)].map((m) => m[1])
gleich("der Nachbar nennt genau einen Namen", nachbarNamen.length, 1)
gleich("und es ist derselbe wie hier", nachbarNamen[0], HAKEN)

// ===========================================================================
console.log("\nDie Dokumentaufloesung kennt `document`, sonst aendert der Name nichts")

/*
 * DER TEIL, DEN DER HAKENNAME ALLEIN NICHT LOEST.
 *
 * `_inject()` holte das Item mit `sheet?.item ?? sheet?.object`. Ein
 * ApplicationV2-Blatt fuehrt sein Dokument unter `document`, und `item` kann
 * fehlen. Waere nur der Haken gezogen worden, haette `_inject()` gefeuert und
 * waere in der zweiten Zeile ausgestiegen: dieselbe leere Flaeche, nur eine
 * Ebene tiefer. **Ein Hakenname, der feuert, ist nicht dasselbe wie eine
 * Flaeche, die erscheint.**
 *
 * Geprueft wird am Rumpf von `_inject` und nicht an der ganzen Datei, denn
 * die Zeichenfolge steht auch im Kommentar darueber.
 */
const rumpf = QUELLE.match(
  /static async _inject\([^)]*\)\s*\{([\s\S]*?)\n    const loot/)
wahr("_inject ist lesbar", Boolean(rumpf))
wahr("es liest `document` zuerst",
  /const item = sheet\?\.document \?\? /.test(rumpf?.[1] ?? ""))
wahr("und steigt ohne Dokument aus",
  /if \(!item\) return;/.test(rumpf?.[1] ?? ""))

/*
 * Der Haken filtert zusaetzlich auf Items. Die Abfrage kostet nichts und
 * haelt die Funktion unabhaengig vom Namen darueber; derselbe Riegel steht
 * beim Nachbarn.
 */
wahr("der Haken laesst nur Item-Dokumente durch",
  /doc\?\.documentName !== "Item"/.test(QUELLE))
/*
 * DER NACHBAR TRAEGT DEN RIEGEL ZWEIMAL, einmal am Anhaengen und einmal am
 * Abhaengen, und das wird GEZAEHLT und nicht getestet.
 *
 * Beim Sabotagelauf am 2026-11-09 ist genau hier eine Sabotage
 * durchgerutscht: nimmt man dem Nachbarn den Riegel am ANHAENGEN, bleibt
 * der am Abhaengen stehen, und ein `.test()` findet ihn und bleibt gruen.
 * **Ein Vorkommen beweist nichts, wenn es mehrere gibt.** Dieselbe Lehre
 * wie bei `OP-PRJ-172`, dort traf ein Sabotagemuster die falsche von vier
 * gleichlautenden Zeilen.
 *
 * WARUM FREMDER CODE HIER UEBERHAUPT GEPRUEFT WIRD, und es ist kein
 * Beifang: der Nachbar ist die unabhaengige Quelle fuer den Hakennamen
 * oben. Haelt seine Bauart nicht mehr, taugt er als Quelle nicht mehr, und
 * dann soll dieser Satz roeten, damit jemand hinsieht.
 */
gleich("der Nachbar riegelt an beiden Haken auf Item",
  (NACHBAR.match(/doc\?\.documentName !== "Item"/g) || []).length, 2)

// ===========================================================================
console.log("\nDer Doppelschutz bleibt, er ist jetzt die zweite Linie")

/*
 * Mit einem Namen statt dreien feuert der Haken einmal je Render. Der
 * Doppelschutz ist damit nicht ueberfluessig, sondern die Linie gegen den
 * zweiten Render desselben Blattes, den Foundry von sich aus faehrt.
 */
wahr("_inject bricht ab, wenn die Flaeche schon steht",
  /\.beneos-loot-extras\[data-beneos-loot\]/.test(QUELLE))

// ===========================================================================
console.log(`\n  bestanden: ${gruen}`)
console.log(`  rot:       ${rot}`)

/*
 * NICHT PRUEFBAR, UND ZWAR AN DIESEM SATZ DAUERHAFT:
 *
 * - DASS DER HAKEN FEUERT. Dieser Satz liest Quelltext. Die Zahl 0 gegen 1
 *   stammt aus einer Messung im laufenden Foundry am 2026-11-08 und ist hier
 *   nicht nachgefahren. Der Feldtest ist `TC-PRJ-STR-308`.
 * - DASS DIE FLAECHE ERSCHEINT. `_inject()` baut DOM. Ob die Vorlage traegt,
 *   ob der Einfuegepunkt im Blatt von dnd5e 5.3.3 wirklich existiert und ob
 *   `.beneos-loot-extras` am Ende sichtbar ist, entscheidet ein Browser.
 * - OB DER NAME RICHTIG BLEIBT. Benennt dnd5e die Klasse um, sind diese
 *   Datei und ihr Nachbar gleich falsch, und dieser Satz bleibt gruen. Die
 *   Nachbarpruefung zeigt Uebereinstimmung, nicht Richtigkeit.
 */

process.exit(rot ? 1 : 0)
