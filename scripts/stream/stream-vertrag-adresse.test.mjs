/**
 * stream-vertrag-adresse.test.mjs - nimmt das Tor jede /a/-, /c/-, /l/- und
 * /s/-Adresse an, die dieses Modul baut, und holt es dieselbe Datei? Seit
 * 21.11.2026, stre-T-021 (G-2.8) fuer /a/, seit 22.11.2026 stre-T-183 fuer
 * die drei anderen Raeume.
 *
 * DIE DREI ANDEREN RAEUME (stre-T-183). Dieselbe Fallliste wie bei /a/, je
 * Raum mit seinem Ordner im Spiegel: `kreaturen/<release>/` fuer /c/,
 * `beute/<release>/` fuer /l/, `geteilt/<sha256>/` fuer /s/. Das Recht steht
 * fuer /c/ und /l/ im Feld `kreaturen` (ein Rechteraum, siehe
 * darfBeuteStreamen im Tor), fuer /s/ im Feld `releases` des Traegers, und
 * die Pruefsumme steht im Manifest des Traegers. Je Raum eine Zwei-Werte-
 * Probe: ein Leerzeichen bleibt 200 mit demselben Pfad, ein `!` wird 400.
 * Bei /s/ dazu der Unterordner: das Modul baut aus einer Ebene acht Segmente,
 * das Tor antwortet 404 no-route; derselbe Basisname flach bleibt 200. Im
 * Betrieb filtert `routenName` (stream-fetch.mjs) den Unterordner vorher
 * heraus, und es laesst nur [A-Za-z0-9._-] durch. Die /s/-Faelle mit
 * Leerzeichen, Klammern, Apostroph, Plus, Prozent und Umlaut halten deshalb
 * fest, was das Tor annimmt, nicht einen Kundenweg; wird routenName
 * gelockert, ist hier schon gemessen, dass das Tor mitgeht.
 *
 *   node scripts/stream/stream-vertrag-adresse.test.mjs
 *
 * WARUM ES DIESEN SATZ GIBT. Das Modul baut die Adresse einer Kartendatei in
 * `adressSegmente` und `assetUrl` (stream-settings.mjs): je Segment
 * `encodeURIComponent`, der Schluessel an zweiter Stelle. Das Tor zerlegt sie
 * (`/a/` im Router, `validSegment`, `validAssetPath`) und reicht den Pfad
 * kodiert an den Spiegel weiter. Beide Seiten hielt bisher nur ein Kommentar
 * zusammen. Ein Zeichen, das das Modul anders kodiert, als das Tor es kennt,
 * gibt beim Kunden einen stillen Platzhalter statt der Karte.
 *
 * DAS TOR KOMMT VOM NACHBARN. `src/index.js`, `src/raeume.js`, `wrangler.toml`
 * und die Attrappe `tools/pruefe-tor-attrappe.mjs` werden per `git show` vom
 * Integrationszweig des Workers in ein Temp-Verzeichnis geholt, in derselben
 * Ordnerform (Vorgabe origin/master, umlenkbar mit VERTRAG_WORKER_REF). Den
 * Gegensatz faehrt `tools/pruefe-vertrag-adresse.mjs` im Worker: das Tor
 * dort gegen dieses Modul vom Integrationszweig.
 *
 * Der Gegensatz im Worker deckt bis zu seinem eigenen Stand von stre-T-183
 * nur /a/; die Faelle fuer /c/, /l/ und /s/ zieht dort ein eigener Commit
 * nach (Merge ueber gitg-cent-1). Bis dahin misst nur dieser Satz die drei
 * Raeume, und eine Toraenderung an ihnen faellt erst hier auf, nachdem sie
 * auf dem Integrationszweig des Workers liegt.
 *
 * DAS SOLL je Fall, fuer /a/ dieselbe Fallliste wie im Worker: angenommen (200), genau
 * eine Unteranfrage an den Spiegel, und deren Pfad ist, segmentweise
 * dekodiert, der Dateipfad hinter demselben Paketpraefix wie bei einem
 * schlichten Namen.
 *
 * BEKANNTE ABWEICHUNG, festgehalten und nicht still behoben: `!`, `*` und `~`
 * laesst `encodeURIComponent` roh, und `validAssetPath` im Tor kennt sie
 * nicht: 400 bad-path. Das ist H6 bei orch-stre-1 (contract.py, dann der
 * PHP-Regelkern, dann das Tor). Wird H6 umgesetzt, werden diese Faelle rot,
 * und das Soll zieht mit.
 *
 * NACHBAR FEHLT HEISST NICHT GEMESSEN (Rueckgabe 2), nie gruen. Der Haken
 * dieses Repositoriums meldet 2 bei den Saetzen stream-vertrag-* als
 * "NICHT GEMESSEN" (tools/haken/pre-commit, Schleife ueber die Staende).
 *
 * Ohne Foundry (nur `game.settings.get` als Attrappe), ohne Netz, ohne
 * Geheimnis. Der Schluessel ist erfunden.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { pathToFileURL } from "node:url"
import { pruefstand } from "../../tools/lib/foundry-attrappe.mjs"
import { SETTING, assetUrl, GETEILT_RAUM } from "./stream-settings.mjs"

// Aus einem Haken heraus erbt jeder Kindprozess GIT_DIR, GIT_INDEX_FILE und
// Verwandte des Aufrufers; `git -C <nachbar>` laese dann DIESES Repositorium
// statt des Nachbarn (Kalt-Review 21.11.2026, im verknuepften Arbeitsbaum
// gemessen). Deshalb laeuft jedes `git show` ohne die GIT_*-Umgebung.
const OHNE_GIT = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")))

const WORKER = {
  klon: "J:/Beneos_programming/beneos-stream-worker",
  ref: process.env.VERTRAG_WORKER_REF || "origin/master",
}
const git = (...args) => execFileSync("git", ["-C", WORKER.klon, ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, env: OHNE_GIT })

// Jede Datei unter src/ aus dem Stand selbst, keine Abschrift der Menge: ein
// neues Modul im Tor kaeme sonst als ERR_MODULE_NOT_FOUND statt als Messung.
let srcDateien
try {
  srcDateien = git("ls-tree", "-r", "--name-only", WORKER.ref, "--", "src").split("\n").filter((d) => d.endsWith(".js"))
} catch (e) {
  srcDateien = []
}
if (srcDateien.length === 0) {
  console.log(`NICHT GEMESSEN: ${WORKER.klon} ${WORKER.ref}:src ohne .js-Dateien oder nicht lesbar`)
  process.exit(2)
}
const DATEIEN = [...srcDateien, "wrangler.toml", "tools/pruefe-tor-attrappe.mjs"]

const temp = mkdtempSync(join(tmpdir(), "vertrag-adresse-modul-"))
process.on("exit", () => rmSync(temp, { recursive: true, force: true }))
for (const datei of DATEIEN) {
  let inhalt
  try {
    inhalt = git("show", `${WORKER.ref}:${datei}`)
  } catch (e) {
    console.log(`NICHT GEMESSEN: ${WORKER.klon} ${WORKER.ref}:${datei} nicht lesbar`)
    process.exit(2)
  }
  mkdirSync(dirname(join(temp, datei)), { recursive: true })
  writeFileSync(join(temp, datei), inhalt)
}
const { speicher, netz, torUmgebung, abruf, SPIEGEL } =
  await import(pathToFileURL(join(temp, "tools", "pruefe-tor-attrappe.mjs")).href)

const KEY = "pruefschluessel_vertrag_adresse_modul"
// `read` im Modul faengt jeden Fehler und nimmt die Vorgabe; nur der
// Schluessel muss gesetzt sein, die Basis faellt auf die Vorgabeadresse.
globalThis.game = {
  settings: {
    get(modul, name) {
      if (name === SETTING.key) return KEY
      throw new Error(`nicht registriert: ${modul}.${name}`)
    },
  },
}

const { gleich, abschnitt, ende } = pruefstand(`Vertrag /a/ /c/ /l/ /s/, dieses Modul gegen das Tor ${WORKER.ref}`)

// Die Pruefsumme der geteilten Faelle. Das Manifest jedes Traegers fuehrt sie,
// jede andere Datei des Spiegels antwortet mit einem Koerper.
const SHA = "5".repeat(64)
const MANIFEST = "/_stream/stream-manifest.json"
netz((adresse) => {
  if (!adresse.startsWith(SPIEGEL + "/")) return null
  if (adresse.endsWith(MANIFEST)) {
    return new Response(JSON.stringify({ entries: [{ sha256: SHA }] }),
      { status: 200, headers: { "content-type": "application/json" } })
  }
  return new Response("datei", { status: 200 })
})

const REL = "beneos_bm_0001_markt"
const VAR = "4k"
function welt(releases) {
  return torUmgebung({ STREAM_ENTITLEMENTS: speicher({ [`key:${KEY}`]: { releases } }) })
}
// Jede Unteranfrage aller Faelle, nicht nur die an den Spiegel: ein Tor, das
// je Anfrage zusaetzlich einen fremden Host fragt, faellt sonst nicht auf.
const alleUnteranfragen = []
const dekodiert = (url) => new URL(url).pathname.split("/").map(decodeURIComponent).join("/")

/** Fragt das Tor nach der Adresse, die dieses Modul fuer die Datei baut. */
async function hole(release, variante, pfad, rechte = [release]) {
  const url = assetUrl(release, variante, pfad)
  const u = new URL(url)
  const r = await abruf(welt(rechte), u.pathname + u.search)
  alleUnteranfragen.push(...r.unteranfragen.map((a) => a.adresse))
  const spiegel = r.unteranfragen.map((a) => a.adresse).filter((a) => a.startsWith(SPIEGEL + "/"))
  return { url, r, spiegel }
}

const SCHLICHT = "beneos_assets/bm/0001/schlicht.webp"
const schlicht = await hole(REL, VAR, SCHLICHT)
const PRAEFIX = schlicht.spiegel.length === 1 ? dekodiert(schlicht.spiegel[0]).slice(0, -SCHLICHT.length) : null

abschnitt("ABSCHNITT Die Grundlage")
gleich("die Moduladresse ist eine /a/-Adresse mit Schluessel",
  new URL(schlicht.url).pathname.startsWith(`/a/${KEY}/${REL}/${VAR}/`), true)
gleich("schlichter Name: 200", schlicht.r.status, 200)
gleich("schlichter Name: genau eine Unteranfrage an den Spiegel", schlicht.spiegel.length, 1)
gleich("schlichter Name: Praefix ist das Paket", PRAEFIX, `/${REL}_foundry_${VAR}/data/assets/`)

const ANGENOMMEN = [
  ["Leerzeichen", "beneos_assets/bm/0001/markt platz.webp"],
  ["Klammern", "beneos_assets/bm/0001/markt (nacht).webp"],
  ["Apostroph", "beneos_assets/bm/0001/king's hall.webp"],
  ["Plus", "beneos_assets/bm/0001/a+b.webp"],
  ["Prozent", "beneos_assets/bm/0001/100%.webp"],
  ["Umlaut", "beneos_assets/bm/0001/brücke.webp"],
  ["Unterordner", "beneos_assets/bm/0001/tief/unter/ordner.webp"],
  ["Bindestrich", "beneos_assets/bm/0001/markt-still.webp"],
]

abschnitt("ABSCHNITT Angenommen, und dieselbe Datei")
for (const [name, pfad] of ANGENOMMEN) {
  const { r, spiegel } = await hole(REL, VAR, pfad)
  gleich(`${name}: 200`, r.status, 200)
  gleich(`${name}: genau eine Unteranfrage an den Spiegel`, spiegel.length, 1)
  gleich(`${name}: der Spiegel bekommt genau diesen Pfad`, spiegel.length === 1 ? dekodiert(spiegel[0]) : null, PRAEFIX + pfad)
}
{
  const rel = "beneos_bm_0001_markt.v2"
  const { r, spiegel } = await hole(rel, VAR, SCHLICHT)
  gleich("Releasename mit Punkt: 200", r.status, 200)
  gleich("Releasename mit Punkt: das eigene Paket",
    spiegel.length === 1 ? dekodiert(spiegel[0]).startsWith(`/${rel}_foundry_${VAR}/`) : false, true)
}
{
  const { r } = await hole("beneos_bm_0001-markt", VAR, SCHLICHT)
  gleich("Releasename mit Bindestrich: 200", r.status, 200)
}

abschnitt("ABSCHNITT Bekannt abgewiesen (H6 bei orch-stre-1)")
for (const [name, pfad] of [
  ["Ausrufezeichen", "beneos_assets/bm/0001/wow!.webp"],
  ["Stern", "beneos_assets/bm/0001/stern*.webp"],
  ["Tilde", "beneos_assets/bm/0001/welle~1.webp"],
]) {
  const { r, spiegel } = await hole(REL, VAR, pfad)
  gleich(`${name}: 400 bad-path (bekannt H6)`, `${r.status} ${r.daten && r.daten.error}`, "400 bad-path")
  gleich(`${name}: keine Unteranfrage`, spiegel.length, 0)
}

abschnitt("ABSCHNITT Releasename ausserhalb der Zeichenmenge")
{
  const { r } = await hole("beneos bm 0001", VAR, SCHLICHT)
  gleich("Releasename mit Leerzeichen: 400 bad-path", `${r.status} ${r.daten && r.daten.error}`, "400 bad-path")
}

/*
 * DIE DREI ANDEREN RAEUME (stre-T-183). Dieselben Namen wie oben, ohne den
 * Kartenordner davor. Die Probennamen tragen den Raum vorn, damit eine rote
 * Probe ihren Raum nennt.
 */
const H6 = [["Ausrufezeichen", "wow!.webp"], ["Stern", "stern*.webp"], ["Tilde", "welle~1.webp"]]
const ohneKarte = (pfad) => pfad.replace("beneos_assets/bm/0001/", "")
const status = (r) => `${r.status} ${r.daten && r.daten.error}`

/** Fragt das Tor nach einer fertigen Moduladresse; leer heisst keine Adresse. */
async function frage(url, recht) {
  if (!url) return { url, r: null, spiegel: [], dateien: [] }
  const u = new URL(url)
  const r = await abruf(torUmgebung({ STREAM_ENTITLEMENTS: speicher({ [`key:${KEY}`]: recht }) }), u.pathname + u.search)
  alleUnteranfragen.push(...r.unteranfragen.map((a) => a.adresse))
  const spiegel = r.unteranfragen.map((a) => a.adresse).filter((a) => a.startsWith(SPIEGEL + "/"))
  return { url, r, spiegel, dateien: spiegel.filter((a) => !a.endsWith(MANIFEST)) }
}

for (const [raum, rel, ordner] of [["c", "beneos_ct_0001_wolf", "kreaturen"], ["l", "beneos_lt_0001_schwert", "beute"]]) {
  const R = `/${raum}/`
  const holeRaum = (release, pfad) => frage(assetUrl(release, "", pfad), { kreaturen: [release] })
  abschnitt(`ABSCHNITT ${R} Grundlage, angenommen, abgewiesen`)
  const s = await holeRaum(rel, "token/schlicht.webp")
  gleich(`${R} die Moduladresse ist eine ${R}-Adresse mit Schluessel`,
    new URL(s.url).pathname.startsWith(`${R}${KEY}/${rel}/`), true)
  gleich(`${R} schlichter Name: 200`, s.r.status, 200)
  gleich(`${R} schlichter Name: genau eine Unteranfrage an den Spiegel`, s.spiegel.length, 1)
  gleich(`${R} schlichter Name: Praefix ist der Raumordner`,
    s.spiegel.length === 1 ? dekodiert(s.spiegel[0]) : null, `/${ordner}/${rel}/token/schlicht.webp`)
  for (const [name, pfad] of ANGENOMMEN) {
    const datei = `token/${ohneKarte(pfad)}`
    const { r, spiegel } = await holeRaum(rel, datei)
    gleich(`${R} ${name}: 200`, r.status, 200)
    gleich(`${R} ${name}: genau eine Unteranfrage an den Spiegel`, spiegel.length, 1)
    gleich(`${R} ${name}: der Spiegel bekommt genau diesen Pfad`,
      spiegel.length === 1 ? dekodiert(spiegel[0]) : null, `/${ordner}/${rel}/${datei}`)
  }
  for (const [name, datei] of H6) {
    const { r, spiegel } = await holeRaum(rel, `token/${datei}`)
    gleich(`${R} ${name}: 400 bad-path (bekannt H6)`, status(r), "400 bad-path")
    gleich(`${R} ${name}: keine Unteranfrage`, spiegel.length, 0)
  }
  {
    const punkt = `${rel}.v2`
    const { r, spiegel } = await holeRaum(punkt, "token/schlicht.webp")
    gleich(`${R} Releasename mit Punkt: 200`, r.status, 200)
    gleich(`${R} Releasename mit Punkt: der eigene Ordner`,
      spiegel.length === 1 ? dekodiert(spiegel[0]).startsWith(`/${ordner}/${punkt}/`) : false, true)
    const strich = await holeRaum(rel.replace("0001_", "0001-"), "token/schlicht.webp")
    gleich(`${R} Releasename mit Bindestrich: 200`, strich.r.status, 200)
    // 200 allein reicht nicht: das Tor verweigert ebenfalls mit 200 (Platzhalter).
    gleich(`${R} Releasename mit Bindestrich: genau eine Unteranfrage an den Spiegel`, strich.spiegel.length, 1)
    // Das Raumpraefix bleibt stehen, sonst baute das Modul eine /a/-Adresse.
    const leer = await holeRaum(rel.replace("0001_", "0001 "), "token/schlicht.webp")
    gleich(`${R} Releasename mit Leerzeichen: die Adresse bleibt im Raum`,
      new URL(leer.url).pathname.startsWith(`${R}${KEY}/`), true)
    gleich(`${R} Releasename mit Leerzeichen: 400 bad-path`, status(leer.r), "400 bad-path")
  }
}

{
  const R = "/s/"
  const TRAEGER = { release: REL, variant: VAR }
  const holeGeteilt = (name, traeger = TRAEGER) =>
    frage(assetUrl(GETEILT_RAUM, SHA, name, traeger), { releases: [traeger.release] })
  abschnitt("ABSCHNITT /s/ Grundlage, angenommen, abgewiesen")
  const s = await holeGeteilt("schlicht.ogg")
  gleich(`${R} die Moduladresse ist eine /s/-Adresse mit Schluessel und Traeger`,
    new URL(s.url).pathname.startsWith(`/s/${KEY}/${REL}/${VAR}/${GETEILT_RAUM}/${SHA}/`), true)
  gleich(`${R} schlichter Name: 200`, s.r.status, 200)
  gleich(`${R} schlichter Name: das Manifest des Traegers wird gelesen`,
    s.spiegel.filter((a) => a.endsWith(MANIFEST)).map(dekodiert).join(" "), `/${REL}_foundry_${VAR}${MANIFEST}`)
  gleich(`${R} schlichter Name: genau eine Dateianfrage an den Spiegel`, s.dateien.length, 1)
  gleich(`${R} schlichter Name: Praefix ist der geteilte Ordner`,
    s.dateien.length === 1 ? dekodiert(s.dateien[0]) : null, `/geteilt/${SHA}/schlicht.ogg`)
  for (const [name, pfad] of ANGENOMMEN.filter(([n]) => n !== "Unterordner")) {
    const datei = ohneKarte(pfad)
    const { r, dateien } = await holeGeteilt(datei)
    gleich(`${R} ${name}: 200`, r.status, 200)
    gleich(`${R} ${name}: genau eine Dateianfrage an den Spiegel`, dateien.length, 1)
    gleich(`${R} ${name}: der Spiegel bekommt genau diesen Namen`,
      dateien.length === 1 ? dekodiert(dateien[0]) : null, `/geteilt/${SHA}/${datei}`)
  }
  for (const [name, datei] of H6) {
    const { r, spiegel } = await holeGeteilt(datei)
    gleich(`${R} ${name}: 400 bad-path (bekannt H6)`, status(r), "400 bad-path")
    gleich(`${R} ${name}: keine Unteranfrage`, spiegel.length, 0)
  }
  {
    const tief = await holeGeteilt("tief/unter.ogg")
    gleich(`${R} Unterordner: die Adresse hat acht Segmente`, new URL(tief.url).pathname.split("/").length - 1, 8)
    gleich(`${R} Unterordner: 404 no-route`, status(tief.r), "404 no-route")
    gleich(`${R} Unterordner: keine Unteranfrage`, tief.spiegel.length, 0)
    const flach = await holeGeteilt("unter.ogg")
    gleich(`${R} Unterordner, derselbe Name flach: 200`, flach.r.status, 200)
    gleich(`${R} Unterordner, derselbe Name flach: der Spiegel bekommt genau diesen Namen`,
      flach.dateien.length === 1 ? dekodiert(flach.dateien[0]) : null, `/geteilt/${SHA}/unter.ogg`)
    const punkt = await holeGeteilt("schlicht.ogg", { release: `${REL}.v2`, variant: VAR })
    gleich(`${R} Traeger mit Punkt im Release: 200`, punkt.r?.status, 200)
    gleich(`${R} Traeger mit Punkt im Release: genau eine Dateianfrage an den Spiegel`, punkt.dateien.length, 1)
    const kreatur = await holeGeteilt("schlicht.ogg", { release: "beneos_ct_0001_wolf", variant: VAR })
    gleich(`${R} Kreaturrelease als Traeger: keine Adresse`, kreatur.url, "")
  }
}

abschnitt("ABSCHNITT Keine Unteranfrage ausser an den Spiegel")
gleich("ueber alle Faelle: jede Unteranfrage geht an den Spiegel",
  alleUnteranfragen.filter((a) => !a.startsWith(SPIEGEL + "/")).join(", "), "")

ende()
