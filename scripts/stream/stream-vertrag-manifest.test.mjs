/**
 * stream-vertrag-manifest.test.mjs - liest das Modul beide Manifestformen so,
 * wie ihre Erzeuger sie schreiben? Seit 21.11.2026, stre-T-021 (G-2.8).
 *
 *   node scripts/stream/stream-vertrag-manifest.test.mjs
 *
 * WARUM ES DIESEN SATZ GIBT. Zwei Erzeuger schreiben `stream-manifest.json`:
 * `beneos-stream-beta` mit `beneos-stream-manifest/2` und `beneos-cloud-server`
 * seit dem 24.08.2026 mit `/4`. Das Modul prueft das Feld `schema` nicht.
 * `loadStreamManifest` verlangt nur eine Liste `entries`, und
 * `buildStreamPack` verteilt jeden Eintrag allein nach `role`, `key`, `pin`,
 * `bytes` und, fuer `shared`, nach `url`. Die Form hielt bisher nur ein
 * Kommentar zusammen; `stream-weiche.test.mjs` prueft die Weiche an
 * GETIPPTEN Eintraegen, nicht an dem, was ein Erzeuger wirklich schreibt.
 *
 * DIE VORLAGEN KOMMEN VOM ERZEUGER, NICHT AUS EINER ABSCHRIFT. Jeder Erzeuger
 * haelt seine Goldvorlage aus seinem echten Code und prueft sie selbst:
 *   /4  beneos-cloud-server  tests/vertrag/stream-manifest-4.json
 *   /2  beneos-stream-beta   vertrag/stream-manifest-2.json
 * Dieser Satz liest sie per `git show` vom Integrationszweig des Nachbarn.
 * Aendert ein Erzeuger seine Form, wird SEIN Satz rot, und wer die Vorlage neu
 * schreibt, macht diesen hier rot, wenn das Modul die neue Form nicht traegt.
 *
 * DAS SOLL, je Vorlage:
 *   - `loadStreamManifest` nimmt sie an und gibt sie unveraendert zurueck.
 *   - Jede Rolle ist dem Modul bekannt: keine Warnung "unbekannte Rolle".
 *   - Jeder Eintrag landet genau einmal: als Dokument, als Download, als
 *     Toradresse oder als bewusst uebersprungen.
 *   - Die Bytes der Weiche gehen auf: Rand plus geteilt plus lokal ist die
 *     Summe aller Eintraege ausser Dokumenten und uebersprungenen.
 *   - `shared` (nur /2) streamt von genau der `url` des Eintrags.
 *   - /4 traegt keine `url`, also auch keine Rolle `shared`.
 * LUECKE, ausgegeben statt verschwiegen: eine Rolle der Weiche, die in keiner
 * Vorlage steht (heute keine, gemessen am 2026-11-22), misst dieser Satz nicht; er meldet sie als
 * Zeile "NICHT GEMESSEN: Rolle ...". Geschlossen wird sie beim Erzeuger, mit je
 * einem Eintrag dieser Rolle in der Goldvorlage. Fuer `local` ist das seit
 * stre-T-182 geschehen: die /4-Vorlage traegt ein Actor-Portrait und ein
 * Tokenbild, und eine Sabotage am Zweig `entry.role === "local"` wird rot.
 * Gegenprobe: eine unbekannte Rolle in einer Kopie der Vorlage MUSS warnen,
 * sonst waere die zweite Probe gruen, weil niemand hinsieht.
 *
 * NACHBAR FEHLT HEISST NICHT GEMESSEN (Rueckgabe 2), nie gruen. Der Haken
 * dieses Repositoriums meldet 2 als "NICHT GEMESSEN". Umlenken fuer einen Lauf
 * vor dem Zusammenfuehren eines Erzeugers:
 *   VERTRAG_CLOUD_REF  Vorgabe origin/design/onboarding-2026-07
 *   VERTRAG_BETA_REF   Vorgabe origin/master
 *
 * Ohne Foundry (Attrappe), ohne Netz, ohne Geheimnis. Der Schluessel ist
 * erfunden.
 */
import { execFileSync } from "node:child_process"
import { pruefstand, installiereFoundry, netz } from "../../tools/lib/foundry-attrappe.mjs"

// Aus einem Haken heraus erbt jeder Kindprozess GIT_DIR, GIT_INDEX_FILE und
// Verwandte des Aufrufers; `git -C <nachbar>` laese dann DIESES Repositorium
// statt des Nachbarn (Kalt-Review 21.11.2026, im verknuepften Arbeitsbaum
// gemessen). Deshalb laeuft jedes `git show` ohne die GIT_*-Umgebung.
const OHNE_GIT = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")))

const NACHBARN = {
  cloud: {
    klon: "J:/Beneos_programming/beneos-cloud-server",
    ref: process.env.VERTRAG_CLOUD_REF || "origin/design/onboarding-2026-07",
    datei: "tests/vertrag/stream-manifest-4.json",
  },
  beta: {
    klon: "J:/Beneos_programming/beneos-stream-beta",
    ref: process.env.VERTRAG_BETA_REF || "origin/master",
    datei: "vertrag/stream-manifest-2.json",
  },
}

function hole({ klon, ref, datei }) {
  let text
  try {
    text = execFileSync("git", ["-C", klon, "show", `${ref}:${datei}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: OHNE_GIT })
  } catch (e) {
    console.log(`NICHT GEMESSEN: ${klon} ${ref}:${datei} nicht lesbar`)
    process.exit(2)
  }
  // Fehlen ist nicht gemessen, eine kaputte Vorlage ist ein Befund.
  try {
    return { daten: JSON.parse(text), stand: `${ref}:${datei}` }
  } catch (e) {
    console.log(`  ROT  Vorlage ${ref}:${datei} ist kein JSON: ${e.message}`)
    process.exit(1)
  }
}

const v4 = hole(NACHBARN.cloud)
const v2 = hole(NACHBARN.beta)

// Die Rollen, die buildStreamPack unterscheidet (stream-install.mjs).
const ROLLEN_DER_WEICHE = ["edge", "shared", "local", "skip", "doc"]
{
  const getragen = new Set([v4.daten, ...Object.values(v2.daten || {})]
    .flatMap((m) => ((m && m.entries) || []).map((e) => e.role)))
  for (const rolle of ROLLEN_DER_WEICHE.filter((r) => !getragen.has(r))) {
    console.log(`NICHT GEMESSEN: Rolle ${rolle} steht in keiner Vorlage, dieser Satz misst sie nicht`)
  }
}

const { SETTING, INSTALL_MODE } = await import("./stream-settings.mjs")
installiereFoundry({
  einstellungen: {
    [SETTING.key]: "pk_vertrag_manifest",
    [SETTING.base]: "https://gate.beneos.stream",
    [SETTING.mode]: true,
    [SETTING.installMode]: INSTALL_MODE.stream,
    [SETTING.pinStills]: true,
  },
})
const { loadStreamManifest, buildStreamPack } = await import("./stream-install.mjs")
const { assetUrl } = await import("./stream-settings.mjs")

const { gleich, abschnitt, ende } = pruefstand(`Vertrag Manifest im Modul, gelesen von ${v4.stand} und ${v2.stand}`)

const warnungen = []
const urWarn = console.warn
console.warn = (...a) => { warnungen.push(a.map(String).join(" ")) }

/** Liefert das Manifest unter der Adresse aus, die das Modul selbst bildet. */
function liefere(release, variante, manifest) {
  const soll = assetUrl(release, variante, "stream-manifest.json")
  netz((adresse) => adresse.split("?")[0] === soll
    ? new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } })
    : undefined)
}

const NICHT_IN_DER_WEICHE = new Set(["doc", "skip"])
const summe = (liste) => liste.reduce((s, e) => s + (Number(e.bytes) || 0), 0)

/**
 * Die Weiche mit ausgeschaltetem `pinStills`: dann nimmt kein Pin-Zweig einen
 * Eintrag vor der Rollenpruefung weg, und eine falsche Rolle an einem sonst
 * gepinnten Eintrag muss warnen. Kunden mit diesem Schalter aus gibt es.
 */
function weicheOhnePins(name, m) {
  const vorher = game.settings.get("beneos-module", SETTING.pinStills)
  game.settings.set("beneos-module", SETTING.pinStills, false)
  try {
    warnungen.length = 0
    const p = buildStreamPack(m, m.release, m.variant)
    gleich(`${name}: keine unbekannte Rolle (Stills aus)`, warnungen.filter((w) => w.includes("unbekannte Rolle")).length, 0)
    const dokumente = Object.keys(p.packInfo).filter((k) => !k.startsWith("data/assets/")).length
    const downloads = Object.keys(p.packInfo).filter((k) => k.startsWith("data/assets/")).length
    gleich(`${name}: jeder Eintrag landet genau einmal (Stills aus)`,
      dokumente + downloads + p.streamTargets.size + p.skipped, m.entries.length)
    gleich(`${name}: die Bytes der Weiche gehen auf (Stills aus)`, p.edgeBytes + p.sharedBytes + p.localBytes,
      summe(m.entries.filter((e) => !NICHT_IN_DER_WEICHE.has(e.role))))
  } finally {
    game.settings.set("beneos-module", SETTING.pinStills, vorher)
  }
}

async function pruefe(name, m, { mitShared }) {
  liefere(m.release, m.variant, m)
  const gelesen = await loadStreamManifest(m.release, m.variant)
  gleich(`${name}: loadStreamManifest nimmt sie an`, JSON.stringify(gelesen), JSON.stringify(m))

  warnungen.length = 0
  const p = buildStreamPack(gelesen, m.release, m.variant)
  gleich(`${name}: keine unbekannte Rolle`, warnungen.filter((w) => w.includes("unbekannte Rolle")).length, 0)

  const dokumente = Object.keys(p.packInfo).filter((k) => !k.startsWith("data/assets/")).length
  const downloads = Object.keys(p.packInfo).filter((k) => k.startsWith("data/assets/")).length
  gleich(`${name}: jeder Eintrag landet genau einmal`,
    dokumente + downloads + p.streamTargets.size + p.skipped, m.entries.length)
  gleich(`${name}: jedes Dokument wird ein Dokument`, dokumente,
    m.entries.filter((e) => e.role === "doc").length)
  gleich(`${name}: die Bytes der Weiche gehen auf`, p.edgeBytes + p.sharedBytes + p.localBytes,
    summe(m.entries.filter((e) => !NICHT_IN_DER_WEICHE.has(e.role))))

  const geteilt = m.entries.filter((e) => e.role === "shared")
  if (mitShared) {
    gleich(`${name}: traegt geteilte Eintraege`, geteilt.length > 0, true)
    const adressen = new Set(p.streamTargets.values())
    gleich(`${name}: shared streamt von der url des Eintrags`,
      geteilt.every((e) => typeof e.url === "string" && e.url !== "" && adressen.has(e.url)), true)
  } else {
    gleich(`${name}: keine Rolle shared`, geteilt.length, 0)
    gleich(`${name}: kein Eintrag traegt url`, m.entries.some((e) => "url" in e), false)
  }
  weicheOhnePins(name, gelesen)
}

abschnitt("/4 aus beneos-cloud-server")
gleich("/4: schema", v4.daten.schema, "beneos-stream-manifest/4")
await pruefe("/4", v4.daten, { mitShared: false })

abschnitt("/2 aus beneos-stream-beta")
gleich("/2: Vorlage traegt mindestens ein Manifest",
  Boolean(v2.daten) && !Array.isArray(v2.daten) && Object.keys(v2.daten).length > 0, true)
for (const [name, m] of Object.entries(v2.daten)) {
  gleich(`/2 ${name}: schema`, m.schema, "beneos-stream-manifest/2")
  await pruefe(`/2 ${name}`, m, { mitShared: true })
}

abschnitt("Gegenprobe: eine unbekannte Rolle warnt")
{
  // Ein eigener, ungepinnter Eintrag: die Gegenprobe haengt so nicht an der
  // Reihenfolge der fremden Vorlage, und kein Pin-Zweig nimmt ihn vorher weg.
  const m = JSON.parse(JSON.stringify(v4.daten))
  m.entries.push({ key: "beneos_assets/gegenprobe/kante.webp", role: "kante", bytes: 1, pin: false })
  warnungen.length = 0
  buildStreamPack(m, m.release, m.variant)
  gleich("unbekannte Rolle: genau eine Warnung", warnungen.filter((w) => w.includes("unbekannte Rolle")).length, 1)
}

console.warn = urWarn
ende()
