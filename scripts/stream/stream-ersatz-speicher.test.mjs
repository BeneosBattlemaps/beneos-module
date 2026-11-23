/**
 * stream-ersatz-speicher.test.mjs
 *
 * Gegenprobe zu `stream-ersatz-speicher.mjs`, stre-T-222. Laeuft ohne Foundry:
 *
 *   node scripts/stream/stream-ersatz-speicher.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 mindestens einer rot.
 *
 * WAS FESTGEHALTEN WIRD. Bekommt ein Bild bei fehlender Verbindung das
 * Ersatzbild, haelt PIXI es als gueltige Textur je Adresse fest, und Foundry
 * fragt die Datei danach nicht mehr ab (gemessen in T-222 Schritt 1: Szene
 * hin und zurueck und Wiederverbinden zeigten weiter 960x540, erst F5 das
 * echte Bild). Das Modul merkt sich diese Adressen und verwirft sie:
 *
 * - beim Abbau der Szene (`canvasTearDown`), damit der naechste Aufbau frisch
 *   laedt;
 * - beim Uebergang von `offline` nach `online` durch ein Neuzeichnen, damit
 *   Notice.Offline ("until it is back") stimmt. NICHT bei `degraded` nach
 *   `online`: der Zustand pendelt unter einem anhaltenden Bildfehler alle 30 s
 *   zwischen beiden, und jedes Pendeln wuerde die Szene neu zeichnen
 *   (Kalt-Review zum Plan, Befund 1, gemessen 67 Neuzeichnungen in 500 ms bei
 *   gestauchtem Takt).
 *
 * Nur Adressen, die PIXI tatsaechlich geladen hat, zaehlen. Ein Journalbild
 * geht durch denselben Abruf, liegt aber nie in PIXI und darf kein
 * Neuzeichnen ausloesen.
 */
import { pathToFileURL } from "node:url"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { pruefstand } from "../../tools/lib/foundry-attrappe.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const MODUL = pathToFileURL(join(HIER, "stream-ersatz-speicher.mjs")).href

const { gleich, abschnitt, ende } = pruefstand("stream-ersatz-speicher, Verwerfen der Ersatzbilder in PIXI")
const pruefe = (name, ok) => gleich(name, ok, true)

let zaehler = 0
async function frisch() {
  zaehler += 1
  return await import(`${MODUL}?f=${zaehler}`)
}

/** Ein Takt fuer die Mikroaufgaben der abgelehnten und erfuellten Promises. */
const takt = () => new Promise((r) => setTimeout(r, 0))

/**
 * Die Buehne: PIXI-Assets mit promiseCache, Haken, Zustand, Leinwand.
 * `unload` lehnt fuer Adressen in `abweisen` ab, so wie das echte PIXI 7.4.3
 * es tut: asynchron, nie synchron (Kalt-Review Befund 5).
 */
function buehne({ ready = true, abweisen = [], drawAblehnen = false } = {}) {
  const entladen = []
  const promiseCache = {}
  const assets = {
    loader: { promiseCache },
    unload(url) {
      if (abweisen.includes(url)) return Promise.reject(new Error("parser"))
      entladen.push(url)
      delete promiseCache[url]
      return Promise.resolve()
    },
  }
  const haken = new Map()
  const einmal = new Map()
  const hooks = {
    on(name, fn) { haken.set(name, [...(haken.get(name) || []), fn]) },
    once(name, fn) { einmal.set(name, [...(einmal.get(name) || []), fn]) },
    feuere(name) {
      for (const fn of haken.get(name) || []) fn()
      const e = einmal.get(name) || []
      einmal.delete(name)
      for (const fn of e) fn()
    },
  }
  const hoerer = []
  const zustand = {
    onState(fn) { hoerer.push(fn) },
    setze(next) { for (const fn of hoerer) fn(next) },
  }
  const leinwand = {
    ready,
    zeichnungen: 0,
    draw() {
      leinwand.zeichnungen += 1
      return drawAblehnen ? Promise.reject(new Error("draw")) : Promise.resolve()
    },
  }
  return { assets, promiseCache, entladen, hooks, zustand, leinwand }
}

async function installiert(opts = {}) {
  const m = await frisch()
  const b = buehne(opts)
  m.installErsatzVerwerfen({
    hooks: b.hooks,
    onState: (fn) => b.zustand.onState(fn),
    leinwand: () => b.leinwand,
    assets: () => b.assets,
    zustand: () => opts.start ?? null,
  })
  return { m, b }
}

const A = "https://gate.beneos.stream/a/pk_pruefsatz/r1/4k/a.webp"
const B = "https://gate.beneos.stream/a/pk_pruefsatz/r1/4k/b.webp"
const J = "https://gate.beneos.stream/a/pk_pruefsatz/r1/4k/journal.webp"

/* --------------------------------------------------- Teil 1: Szenenabbau */
{
  const { m, b } = await installiert()
  b.promiseCache[A] = {}
  m.merkeErsatz(A)
  pruefe("gemerkter Ersatz zaehlt 1", m.ersatzZahl() === 1)
  b.hooks.feuere("canvasTearDown")
  await takt()
  pruefe("canvasTearDown: Ersatz wird entladen", b.entladen.length === 1 && b.entladen[0] === A)
  // Der Neuaufbau laedt die echte Datei unter derselben Adresse: die darf
  // danach weder zaehlen noch beim naechsten Abbau wieder entladen werden.
  b.promiseCache[A] = {}
  pruefe("canvasTearDown: danach zaehlt nichts mehr", m.ersatzZahl() === 0)
  b.hooks.feuere("canvasTearDown")
  await takt()
  pruefe("zweiter Abbau ohne neuen Ersatz: das echte Bild bleibt geladen", b.entladen.length === 1)
}
{
  const { b } = await installiert()
  b.promiseCache[A] = {}
  b.hooks.feuere("canvasTearDown")
  await takt()
  pruefe("ohne gemerkten Ersatz: kein Entladen, auch wenn PIXI die Adresse kennt", b.entladen.length === 0)
}

/* ------------------------------------- Teil 2: nur, was PIXI geladen hat */
{
  const { m, b } = await installiert()
  m.merkeErsatz(J)
  pruefe("Journalbild ohne PIXI-Eintrag zaehlt nicht", m.ersatzZahl() === 0)
  b.zustand.setze("offline")
  b.zustand.setze("online")
  await takt()
  pruefe("Journalbild allein: kein Neuzeichnen", b.leinwand.zeichnungen === 0)
  b.hooks.feuere("canvasTearDown")
  await takt()
  pruefe("Journalbild allein: kein Entladen ins Leere", b.entladen.length === 0)
}

/* ------------------------------------------ Teil 3: Uebergang nach online */
{
  const { m, b } = await installiert()
  b.promiseCache[A] = {}
  m.merkeErsatz(A)
  b.zustand.setze("offline")
  b.zustand.setze("online")
  await takt()
  pruefe("offline nach online mit Ersatz: genau ein Neuzeichnen", b.leinwand.zeichnungen === 1)
}
{
  const { b } = await installiert()
  b.zustand.setze("offline")
  b.zustand.setze("online")
  await takt()
  pruefe("offline nach online ohne Ersatz: kein Neuzeichnen", b.leinwand.zeichnungen === 0)
}
{
  const { m, b } = await installiert()
  b.promiseCache[A] = {}
  m.merkeErsatz(A)
  b.zustand.setze("online")
  b.zustand.setze("degraded")
  b.zustand.setze("online")
  b.zustand.setze("degraded")
  b.zustand.setze("online")
  await takt()
  pruefe("degraded nach online pendelnd: kein Neuzeichnen", b.leinwand.zeichnungen === 0)
}
{
  const { m, b } = await installiert()
  b.promiseCache[A] = {}
  m.merkeErsatz(A)
  b.zustand.setze("unbekannt")
  b.zustand.setze("online")
  await takt()
  pruefe("unbekannt nach online (Weltstart): kein Neuzeichnen", b.leinwand.zeichnungen === 0)
}
{
  const { m, b } = await installiert()
  b.promiseCache[A] = {}
  m.merkeErsatz(A)
  b.zustand.setze("offline")
  b.zustand.setze("degraded")
  await takt()
  pruefe("Wechsel nach offline und degraded: kein Neuzeichnen", b.leinwand.zeichnungen === 0)
}
{
  const { m, b } = await installiert()
  b.promiseCache[A] = {}
  m.merkeErsatz(A)
  b.zustand.setze("offline")
  b.zustand.setze("degraded")
  b.zustand.setze("online")
  await takt()
  pruefe("offline ueber degraded nach online: genau ein Neuzeichnen", b.leinwand.zeichnungen === 1)
}
{
  // Die Welt startet ohne Netz: `offline` steht fest, bevor der Hoerer
  // existiert (Kalt-Review zum Diff, Befund 1).
  const { m, b } = await installiert({ start: "offline" })
  b.promiseCache[A] = {}
  m.merkeErsatz(A)
  b.zustand.setze("online")
  await takt()
  pruefe("Weltstart offline, dann Rueckkehr: genau ein Neuzeichnen", b.leinwand.zeichnungen === 1)
}

/* ------------------------------ Teil 4: Wechsel waehrend des Zeichnens */
{
  const { m, b } = await installiert({ ready: false })
  b.promiseCache[A] = {}
  m.merkeErsatz(A)
  b.zustand.setze("offline")
  b.zustand.setze("online")
  await takt()
  pruefe("Leinwand nicht bereit: noch kein Neuzeichnen", b.leinwand.zeichnungen === 0)
  b.leinwand.ready = true
  b.hooks.feuere("canvasReady")
  await takt()
  pruefe("nach canvasReady: das Neuzeichnen wird nachgeholt", b.leinwand.zeichnungen === 1)
  b.hooks.feuere("canvasReady")
  await takt()
  pruefe("zweites canvasReady: nicht noch einmal", b.leinwand.zeichnungen === 1)
}
{
  const { m, b } = await installiert({ ready: false })
  b.promiseCache[A] = {}
  m.merkeErsatz(A)
  b.zustand.setze("offline")
  b.zustand.setze("online")
  b.zustand.setze("offline")
  b.zustand.setze("online")
  b.leinwand.ready = true
  b.hooks.feuere("canvasReady")
  await takt()
  pruefe("zwei Rueckkehren waehrend des Zeichnens: nur ein Neuzeichnen", b.leinwand.zeichnungen === 1)
}

/* --------------------------------------------- Teil 5: Fehler gefangen */
{
  const unbehandelt = []
  const fang = (e) => unbehandelt.push(e)
  process.on("unhandledRejection", fang)
  const { m, b } = await installiert({ abweisen: [A], drawAblehnen: true })
  b.promiseCache[A] = {}
  b.promiseCache[B] = {}
  m.merkeErsatz(A)
  m.merkeErsatz(B)
  b.hooks.feuere("canvasTearDown")
  await takt(); await takt()
  pruefe("ein abgewiesenes Entladen haelt das naechste nicht auf", b.entladen.includes(B))
  b.promiseCache[A] = {}
  m.merkeErsatz(A)
  b.zustand.setze("offline")
  b.zustand.setze("online")
  await takt(); await takt()
  pruefe("abgelehntes Neuzeichnen wird versucht", b.leinwand.zeichnungen === 1)
  pruefe("keine unbehandelte Ablehnung", unbehandelt.length === 0)
  process.off("unhandledRejection", fang)
}

/* ------------------------------- Teil 5b: dieselben Zustandsnamen wie die Quelle */
{
  // Die Proben oben sprechen die Zustaende als Literale. Benennt
  // stream-online.mjs sie um, blieben sie gruen und im Spiel wuerde nie neu
  // gezeichnet (Beneos-Review). Diese Probe bindet beide Dateien.
  const { readFileSync } = await import("node:fs")
  const quelle = readFileSync(join(HIER, "stream-online.mjs"), "utf8")
  const zeile = quelle.match(/const STATE = \{([^}]*)\}/)?.[1] ?? ""
  const hat = (n) => new RegExp(`\\b${n}: "${n}"`).test(zeile)
  gleich("[Struktur] stream-online.mjs fuehrt die Zustaende online, offline und degraded unter diesen Namen",
    `${hat("online")}|${hat("offline")}|${hat("degraded")}`, "true|true|true")
}

/* ------------------------------------------- Teil 6: ohne Welt kein Fehler */
{
  const m = await frisch()
  let ok = true
  try { m.merkeErsatz(A); m.ersatzZahl() } catch (_) { ok = false }
  pruefe("ohne PIXI und ohne Einbau wirft nichts", ok)
}

ende()
