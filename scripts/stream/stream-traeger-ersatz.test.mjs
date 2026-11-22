/**
 * Pruefsatz fuer den Traeger-Rueckfall am echten Abrufersatz (stre-T-173,
 * Kalt-Review cab0a2e).
 *
 * `stream-traeger.test.mjs` faehrt `offlineHalten` ohne `installStreamFetch`,
 * also wie im Download-Betrieb. Im Streaming-Betrieb laeuft jeder Abruf von
 * `offlineHalten` durch den Abrufersatz, und dessen Abweisungszweig hat
 * Nebenwirkungen: eine Konsolenzeile, einen Hinweis an die Spielleitung, das
 * Kartenschild. Bis stre-T-173 war eine Abweisung endgueltig und die Meldung
 * damit wahr. Mit dem Rueckfall ist sie es nur noch, wenn auch der letzte
 * Traeger abweist.
 *
 * Die Zwei-Werte-Probe:
 *   - zwei Traeger, der erste abgewiesen: geholt, und keine Meldung an den Kunden;
 *   - ein einziger Traeger, abgewiesen: gemeldet wie vorher.
 * Dazu: eine Adresse mit Abfrageteil wird bei einem Traeger nur einmal geholt.
 *
 * Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-traeger-ersatz.test.mjs
 */
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { pruefstand, installiereFoundry, netz, nimmAbrufe, meldungen } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, abschnitt, ende } = pruefstand("stream-traeger-ersatz, Rueckfall am echten Abrufersatz")

const HIER = dirname(fileURLToPath(import.meta.url))
const UI = join(HIER, "..", "..", "ui")
const MODULPFAD = "/modules/beneos-module/ui/"
const BASIS = "https://gate.beneos.stream"
const SCHLUESSEL = "k-attrappe-0002"
installiereFoundry({
  einstellungen: {
    "beneos-stream-mode": true,
    "beneos-stream-key": SCHLUESSEL,
    "beneos-stream-base": BASIS,
    // An: ohne Vorrat haelt `offlineHalten` nichts und fragt das Tor gar nicht.
    "beneos-stream-local-cache": true,
    "beneos-stream-offline-held": {},
    "beneos-stream-offline-shared": {},
  },
})

// Ein Cache Storage im Speicher, wie in stream-traeger.test.mjs.
const ablage = new Map()
{
  const schl = (anfrage, ohneSuche) => {
    const u = new URL(typeof anfrage === "string" ? anfrage : anfrage.url)
    if (ohneSuche) u.search = ""
    return u.href
  }
  const store = {
    async match(anfrage, opt) {
      const k = schl(anfrage, opt?.ignoreSearch)
      for (const [s, r] of ablage) if (schl(s, opt?.ignoreSearch) === k) return r.clone()
      return undefined
    },
    async put(anfrage, antwort) { ablage.set(schl(anfrage, false), antwort.clone()) },
    async delete(anfrage, opt) {
      const k = schl(anfrage, opt?.ignoreSearch)
      let weg = false
      for (const s of [...ablage.keys()]) if (schl(s, opt?.ignoreSearch) === k) { ablage.delete(s); weg = true }
      return weg
    },
    async keys() { return [...ablage.keys()].map((s) => new Request(s)) },
  }
  globalThis.caches = { async open() { return store }, async delete() { ablage.clear(); return true } }
}

// Konsolenzeilen der Abweisung mitschreiben, alles andere durchreichen.
const zeilen = []
{
  const warn = console.warn.bind(console)
  console.warn = (...a) => {
    const t = a.map(String).join(" ")
    if (t.includes("kein Material")) zeilen.push(t)
    else warn(...a)
  }
}

const einstellungen = await import("./stream-settings.mjs")
const f = await import("./stream-fetch.mjs")
const { assetUrl, GETEILT_RAUM } = einstellungen

const SHA = "c".repeat(64)
const SHA_EINS = "d".repeat(64)
const SHA_ZWEI = "e".repeat(64)
const NAME = "foundry_bm_ui.webp"
const KARTE_A = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0113/4k/map_assets/${NAME}`
const KARTE_B = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0042/hd/map_assets/${NAME}`
const KARTE_C = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0077/4k/map_assets/kompass.webp`
const KARTE_D = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0088/4k/map_assets/rose.webp`
const S_A = assetUrl(GETEILT_RAUM, SHA, NAME, { release: "beneos_bm_0113", variant: "4k" })
const S_B = assetUrl(GETEILT_RAUM, SHA, NAME, { release: "beneos_bm_0042", variant: "hd" })
const S_C = assetUrl(GETEILT_RAUM, SHA_EINS, "kompass.webp", { release: "beneos_bm_0077", variant: "4k" })
const S_D = assetUrl(GETEILT_RAUM, SHA_ZWEI, "rose.webp", { release: "beneos_bm_0088", variant: "4k" })
const S_D_ABFRAGE = `${S_D}?v=2`
// Teil 4: eine eigene Datei mit zwei Traegern, unberuehrt von Teil 1 bis 3.
const SHA_DREI = "f".repeat(64)
const KARTE_E = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0091/4k/map_assets/stern.webp`
const KARTE_F = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0092/hd/map_assets/stern.webp`
const S_E = assetUrl(GETEILT_RAUM, SHA_DREI, "stern.webp", { release: "beneos_bm_0091", variant: "4k" })
const S_F = assetUrl(GETEILT_RAUM, SHA_DREI, "stern.webp", { release: "beneos_bm_0092", variant: "hd" })
// Gegenwert in Teil 4: eine zweite Datei, deren erster Traeger annimmt.
const SHA_VIER = "9".repeat(64)
const KARTE_G = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0093/4k/map_assets/mond.webp`
const KARTE_H = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0094/hd/map_assets/mond.webp`
const S_G = assetUrl(GETEILT_RAUM, SHA_VIER, "mond.webp", { release: "beneos_bm_0093", variant: "4k" })

// Teil 5: ein Manifest und eine Kartendatei, beide abgewiesen.
const MANIFEST_ABGEWIESEN = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0095/4k/stream-manifest.json`
const KARTE_ABGEWIESEN = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0096/4k/karte.webp`
// Teil 7: ein abgewiesenes Video.
const VIDEO_ABGEWIESEN = `${BASIS}/a/${SCHLUESSEL}/beneos_bm_0098/4k/map_assets/wasser.webm`

const ohneAbfrage = (u) => String(u).split("?")[0]
const abgewiesen = new Set([S_A, S_C, S_D, S_E, MANIFEST_ABGEWIESEN, KARTE_ABGEWIESEN, VIDEO_ABGEWIESEN].map(ohneAbfrage))

netz((adresse) => {
  if (adresse.startsWith(MODULPFAD)) {
    const datei = join(UI, adresse.slice(MODULPFAD.length))
    if (!existsSync(datei)) return new Response("fehlt", { status: 404 })
    return new Response(readFileSync(datei), { status: 200, headers: { "Content-Type": "image/webp" } })
  }
  if (adresse === `${BASIS}/health`) return new Response("ok", { status: 200 })
  if (abgewiesen.has(ohneAbfrage(adresse))) {
    return new Response("p", { status: 200, headers: { "x-beneos-denied": "1", "content-type": "image/webp" } })
  }
  if (adresse === S_B || adresse === S_G) {
    return new Response("bild", { status: 200, headers: { "content-type": "image/webp", "content-length": "4" } })
  }
  return undefined
})
f.installStreamFetch()

const amTor = () => nimmAbrufe().map((a) => a.adresse)
  .filter((a) => a.startsWith(`${BASIS}/`) && a !== `${BASIS}/health` && !a.includes("/report"))
const hinweise = () => meldungen.filter((m) => m.art === "warn").length

/** Ruft und faengt: ein Wurf wird eine rote Probe, kein Absturz des Satzes. */
async function versuche(fn) {
  try { return await fn() } catch (e) { return { wurf: String(e?.message || e).slice(0, 120) } }
}
const ruhe = () => new Promise((r) => setTimeout(r, 0))

// Teil 7 faehrt diesen Satz als Kindprozess mit frischer Meldestelle: ein
// einziger abgewiesener Abruf, danach die Warnungen als eine Zeile, dann Ende.
if (process.env.TRAEGER_ERSATZ_KIND) {
  const adresse = process.env.TRAEGER_ERSATZ_KIND === "video" ? VIDEO_ABGEWIESEN : KARTE_ABGEWIESEN
  await versuche(() => globalThis.fetch(adresse))
  await ruhe()
  const texte = meldungen.filter((m) => m.art === "warn").map((m) => m.text)
  process.stdout.write(`\nKIND-ERGEBNIS ${JSON.stringify(texte)}\n`)
  process.exit(0)
}

f.merkePruefsummen([[KARTE_A, SHA], [KARTE_B, SHA], [KARTE_C, SHA_EINS], [KARTE_D, SHA_ZWEI]])

abschnitt("Teil 1: zwei Traeger, der erste abgewiesen")
{
  nimmAbrufe()
  const r = await versuche(() => f.offlineHalten([S_A]))
  await ruhe()
  gleich("erst der erste, dann der zweite gefragt", JSON.stringify(amTor()), JSON.stringify([S_A, S_B]))
  gleich("die Datei ist geholt", r?.geholt, 1)
  gleich("kein Fehlschlag gezaehlt", r?.fehlgeschlagen, 0)
  gleich("sie liegt unter dem geteilten Schluessel", ablage.has(f.vorratsSchluessel(S_A)), true)
  gleich("kein Hinweis an die Spielleitung", hinweise(), 0)
  gleich("keine Konsolenzeile 'kein Material'", zeilen.length, 0)
}

abschnitt("Teil 2: ein Traeger, abgewiesen: gemeldet wie vorher")
{
  nimmAbrufe()
  const r = await versuche(() => f.offlineHalten([S_C]))
  await ruhe()
  gleich("genau ein Abruf", JSON.stringify(amTor()), JSON.stringify([S_C]))
  gleich("ein Traeger: Fehlschlag mit Grund abgewiesen", r?.gruende?.abgewiesen, 1)
  gleich("ein Hinweis an die Spielleitung", hinweise(), 1)
  gleich("eine Konsolenzeile fuer den Traeger", zeilen.filter((z) => z.includes("beneos_bm_0077/4k")).length, 1)
}

abschnitt("Teil 3: Abfrageteil, ein Traeger")
{
  nimmAbrufe()
  const r = await versuche(() => f.offlineHalten([S_D_ABFRAGE]))
  await ruhe()
  gleich("genau ein Abruf, auch mit Abfrageteil", amTor().length, 1)
  gleich("mit Abfrageteil: Fehlschlag mit Grund abgewiesen", r?.gruende?.abgewiesen, 1)
}

abschnitt("Teil 4: ein Abruf ausserhalb von offlineHalten merkt den abgewiesenen Traeger")
/*
 * Bis stre-T-208 stand das in stream-traeger.test.mjs als Strukturprobe am
 * Quelltext. Hier faehrt es der echte Abrufersatz: eine Kachel laedt die
 * geteilte Datei, das Tor weist mit 200 und `x-beneos-denied` ab (ein 403
 * erreicht den Zweig nie, er endet schon an `!response.ok`). Danach muss der
 * Rueckweg den naechsten Traeger nennen. Gegenwert: ein angenommener Abruf
 * aendert nichts.
 */
{
  f.merkePruefsummen([[KARTE_E, SHA_DREI], [KARTE_F, SHA_DREI], [KARTE_G, SHA_VIER], [KARTE_H, SHA_VIER]])
  const G = f.vorratsSchluessel(S_E)
  const H = f.vorratsSchluessel(S_G)
  gleich("Abruf: vorher nennt der Rueckweg den ersten Traeger", f.adresseAusSchluessel(G), S_E)
  nimmAbrufe()
  await versuche(() => globalThis.fetch(S_G))
  await ruhe()
  gleich("Abruf angenommen: das Tor wurde gefragt", JSON.stringify(amTor()), JSON.stringify([S_G]))
  gleich("Abruf angenommen: der Rueckweg bleibt beim ersten Traeger", f.adresseAusSchluessel(H), S_G)
  await versuche(() => globalThis.fetch(S_E))
  await ruhe()
  gleich("Abruf abgewiesen: das Tor wurde gefragt", JSON.stringify(amTor()), JSON.stringify([S_E]))
  gleich("Abruf abgewiesen: der Rueckweg nennt den zweiten Traeger", f.adresseAusSchluessel(G), S_F)
}

/*
 * Teil 5, STEUERDATEIEN MELDEN KEINEN AUSFALL (stre-T-208, vorher eine
 * Textprobe in stream-hinweis). Die Meldestelle zeigt ihren Hinweis einmal je
 * Sitzung, Teil 2 hat ihn schon ausgeloest. Gemessen wird deshalb, ob sie die
 * Adresse als abgewiesen fuehrt: eine Szene mit ihr braucht dann das Schild.
 * Das Manifest bleibt draussen, die Kartendatei daneben kommt hinein.
 */
abschnitt("Teil 5: ein abgewiesenes Manifest meldet keinen Ausfall")
{
  const { schildNoetig } = await import("./stream-hinweis.mjs")
  const szeneMit = (src) => ({ name: "Pruefszene", _source: { background: { src } }, tiles: [], notes: [] })
  await versuche(() => globalThis.fetch(MANIFEST_ABGEWIESEN))
  await versuche(() => globalThis.fetch(KARTE_ABGEWIESEN))
  await ruhe()
  gleich("Manifest abgewiesen: die Meldestelle fuehrt es nicht", schildNoetig(szeneMit(MANIFEST_ABGEWIESEN)), false)
  gleich("Gegenwert: eine abgewiesene Kartendatei fuehrt sie", schildNoetig(szeneMit(KARTE_ABGEWIESEN)), true)
}

/*
 * Teil 6, DIE OFFLINE-ANTWORT MELDET DEN GRUND (stre-T-208, vorher eine
 * Textprobe in stream-hinweis). Steht zuletzt, denn der Zustand bleibt danach
 * offline.
 */
abschnitt("Teil 6: offline meldet der Abrufersatz den Grund")
{
  const online = await import("./stream-online.mjs")
  const offlineMeldungen = () => meldungen.filter((m) => m.text.includes("there is no connection to the server")).length
  gleich("online: keine Offline-Meldung", offlineMeldungen(), 0)
  navigator.onLine = false
  online.noteResult(false, "pruefsatz")
  gleich("Vorbedingung: der Zustand ist offline", online.isOffline(), true)
  await versuche(() => globalThis.fetch(`${BASIS}/a/${SCHLUESSEL}/beneos_bm_0097/4k/offline.webp`))
  await ruhe()
  gleich("offline: der Abruf bringt die Offline-Meldung", offlineMeldungen(), 1)
}

/*
 * Teil 7, DER VIDEO-HINWEIS KOMMT VOR DER ALLGEMEINEN MELDUNG (stre-T-208,
 * vorher eine Textprobe in stream-hinweis). Nach einem Video-Hinweis entfaellt
 * die allgemeine Meldung "nicht im Zugang" (E3). Das zeigt sich nur in einer
 * frischen Sitzung, denn die Meldestelle meldet je Grund einmal; jeder Fall
 * laeuft deshalb als eigener Kindprozess dieses Satzes.
 */
abschnitt("Teil 7: ein abgewiesenes Video bringt nur den Video-Hinweis")
{
  const { execFileSync } = await import("node:child_process")
  const kind = (art) => {
    try {
      const aus = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
        encoding: "utf8", env: { ...process.env, TRAEGER_ERSATZ_KIND: art }, stdio: ["ignore", "pipe", "pipe"],
      })
      const zeile = aus.split("\n").find((z) => z.startsWith("KIND-ERGEBNIS "))
      return zeile ? JSON.parse(zeile.slice("KIND-ERGEBNIS ".length)) : null
    } catch (e) { return { wurf: String(e?.message || e).slice(0, 120) } }
  }
  const istVideoHinweis = (t) => t.includes("animated maps")
  const video = kind("video")
  gleich("Video abgewiesen: genau ein Hinweis", Array.isArray(video) ? video.length : video, 1)
  gleich("Video abgewiesen: es ist der Video-Hinweis, keine allgemeine Meldung",
    Array.isArray(video) ? video.filter((t) => !istVideoHinweis(t)).length : video, 0)
  const bild = kind("bild")
  gleich("Gegenwert: ein abgewiesenes Bild bringt die allgemeine Meldung",
    Array.isArray(bild) ? bild.filter((t) => !istVideoHinweis(t)).length : bild, 1)
}

ende()
