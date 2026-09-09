// Prueft, wie der Installer einen gescheiterten Upload einordnet, aus
// scripts/cloud-v2/beneos-native-installer.mjs.
//
// Hintergrund: auf The Forge gab jeder Fehlschlag "unknown" und der Bericht
// riet zum Wiederholen. Bei einer Grenze je Datei kann Wiederholen nie
// gelingen. Gemessen im Lake am 09.09.2026: 296 gescheiterte Dateien in 54
// Laeufen in 24 Forge-Welten, alle "unknown", kein einziges "toolarge".
//
// Aufruf:
//   node bench.mjs          faehrt gegen den aktuellen Code
//   node bench.mjs --alt    faehrt gegen die Fassung vor dem Fix, die auf
//                           The Forge sofort aufgab, und die rot werden MUSS
//
// Kein Foundry noetig. Gestubbt wird nur `ForgeAPI`, also das FREMDE System;
// jede Zeile Beneos-Code kommt geschnitten aus der Quelle.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { extractMethod, extractConst, extractBlock, buildProbe } from "../lib/extract-method.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, "..", "..", "scripts", "cloud-v2", "beneos-native-installer.mjs")
const text = readFileSync(SOURCE, "utf8")

// NACHBAU der Fassung vor dem Fix. Sie existiert im Bestand nicht mehr, und
// deshalb steht sie hier ausdruecklich als Nachbau und nicht als Zitat. Der
// einzige Unterschied ist der Forge-Zweig: er gab sofort auf.
const ALT_DIAGNOSE = `
  async #diagnoseFailedUpload(dir, file, failureMessage = "upload returned no path") {
    void failureMessage
    const unknown  = () => ({ ok: false, category: INSTALL_ERROR.UNKNOWN, error: new Error("upload returned no path") })
    const toolarge = (bytes) => ({
      ok: false,
      category: INSTALL_ERROR.TOOLARGE,
      error: new TransferError("upload refused", INSTALL_ERROR.TOOLARGE, 413),
    })
    if (this._isForge) return unknown()
    const size = Number(file?.size)
    if (!Number.isFinite(size)) return unknown()
    if (size >= this._toolargeMinBytes) return toolarge(size)
    if (this._sizeProbesLeft <= 0) return unknown()
    this._sizeProbesLeft -= 1
    return unknown()
  }
`

const useAlt = process.argv.includes("--alt")

// Kategorien, Fehlerklasse, Klassifizierer und die beiden Textbauer kommen aus
// derselben Quelle, damit der Pruefstand keine zweite Fassung mitfuehrt.
const prelude = [
  extractConst(text, "FORGE_STATUS_TIMEOUT_MS"),
  extractBlock(text, "export const INSTALL_ERROR = {").replace(/^export\s+/, ""),
  extractBlock(text, "class TransferError extends Error {"),
  extractMethod(text, "classifyTransferError", { maxZeilen: 60 }).replace(/^export\s+/, ""),
  extractMethod(text, "uploadFailureMessage", { maxZeilen: 12 }).replace(/^export\s+/, ""),
  extractMethod(text, "forgeSizeRefusalMessage", { maxZeilen: 6 }).replace(/^export\s+/, ""),
  extractMethod(text, "errorBodyExcerpt", { maxZeilen: 6 }),
].join("\n")

const Probe = buildProbe(
  [
    useAlt ? ALT_DIAGNOSE : extractMethod(text, "#diagnoseFailedUpload", { maxZeilen: 60 }),
    extractMethod(text, "#forgeUploadLimit", { maxZeilen: 30 }),
    // Nur mitgeschnitten, damit die privaten Namen deklariert sind. Keine
    // Probe erreicht sie: der selbstgehostete Weg laeuft mit Sondenbudget 0,
    // und ohne Budget kehrt der Rumpf davor zurueck. Ein handgeschriebener
    // Ersatz waere eine zweite Fassung, die driftet.
    extractMethod(text, "#serverRefusesSize", { maxZeilen: 40 }),
    extractMethod(text, "#stubProbeFile", { maxZeilen: 20 }),
    // Der Rumpf ist privat. Diese eine Zeile macht ihn von aussen aufrufbar
    // und ist der einzige Zusatz zum geschnittenen Code.
    "  probe(dir, file, msg) { return this.#diagnoseFailedUpload(dir, file, msg) }",
  ],
  prelude
)

const modul = new Function(`${prelude}\nreturn { INSTALL_ERROR, classifyTransferError, uploadFailureMessage, forgeSizeRefusalMessage }`)()
const { INSTALL_ERROR, classifyTransferError, uploadFailureMessage, forgeSizeRefusalMessage } = modul

// Der Produktivcode meldet die gelesene Grenze mit console.info und eine
// scheiternde Forge-API mit console.debug. Beides ist im Betrieb richtig und
// wuerde hier die Befunde zudecken, denn Probe 4 loest den Fehlerweg absichtlich
// aus. console.warn und console.error bleiben laut, damit ein UNerwarteter
// Ausgang sichtbar bliebe.
console.info = () => {}
console.debug = () => {}

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? "OK  " : "FAIL"} ${name}` + (ok ? "" : `\n       erwartet ${JSON.stringify(want)}\n       gemessen ${JSON.stringify(got)}`))
}

// Am 09.09.2026 auf beneos.forge-vtt.com aus ForgeAPI.status() gelesen.
const FORGE_LIMIT = 262144000
const MB = 1024 * 1024

// Gestubbt wird nur das fremde System. `antwort` ist entweder ein Statusobjekt,
// null (keine Auskunft) oder "wirft" (die API scheitert).
const installer = ({ forge = true, antwort = { quotas: { upload: FORGE_LIMIT } }, probesLeft = 0 } = {}) => {
  globalThis.ForgeAPI = {
    status: async () => {
      if (antwort === "wirft") throw new Error("Forge API unreachable")
      return antwort
    },
  }
  const p = new Probe()
  p._isForge = forge
  p._forgeLimitPromise = null
  p._toolargeMinBytes = Infinity
  p._sizeProbesLeft = probesLeft
  p._result = { forgeUploadLimit: null }
  return p
}
const datei = (bytes) => ({ size: bytes, name: "probe.webm" })

// 1) Der Kundenfall. dranosh, 09.09.2026: 543 Dateien gingen durch, eine mit
//    96,2 MB nicht. Sein Tarif ist uns nicht bekannt, gemessen ist nur die
//    Spanne: die Grenze liegt ueber 51,7 MB (die groesste Datei, die durchging)
//    und unter 96,2 MB. Die Probe nimmt daher 64 MB als Vertreter. Der Wert
//    steht hier ausdruecklich nicht als sein Tarif, sondern als irgendeine
//    Grenze zwischen den beiden gemessenen Dateien.
{
  const p = installer({ antwort: { quotas: { upload: 64 * MB } } })
  const r = await p.probe("dir", datei(96153593), uploadFailureMessage(false))
  check("1 Kundenfall 96,2 MB ueber der Grenze", r.category, INSTALL_ERROR.TOOLARGE)
  check("1 Kundenfall, die Meldung nennt beide Zahlen",
    /96153593 bytes.*67108864 bytes/.test(String(r.error?.message)), true)
  check("1 Kundenfall, kein erfundener HTTP-Status", r.error?.status ?? null, null)
  check("1 die gelesene Grenze steht danach im Ergebnis", p._result.forgeUploadLimit, 64 * MB)
}

// 2) GENAU auf der Grenze. Am 09.09.2026 gegen assets/create gemessen:
//    quotas.upload selbst geht durch, erst ein Byte mehr wird abgewiesen.
//    Das ist die eine Stelle, an der ein > gegen >= unsichtbar bliebe.
{
  const auf     = await installer().probe("dir", datei(FORGE_LIMIT), uploadFailureMessage(false))
  const drueber = await installer().probe("dir", datei(FORGE_LIMIT + 1), uploadFailureMessage(false))
  check("2 genau auf der Grenze ist NICHT zu gross", auf.category, INSTALL_ERROR.UNKNOWN)
  check("2 ein Byte darueber ist zu gross", drueber.category, INSTALL_ERROR.TOOLARGE)
  // Und zwar OHNE dass die Meldung sich selbst widerspricht. In MB gerundet
  // stuenden hier zweimal 250, und das laese sich wie ein Fehler in unserem
  // Code statt wie eine Grenze im Tarif.
  const m = String(drueber.error?.message)
  check("2 ein Byte darueber, die Meldung widerspricht sich nicht",
    /262144001 bytes.*262144000 bytes/.test(m), true)
  check("2 ein Byte darueber, die Meldung nennt keine zwei gleichen Zahlen",
    /\b250 MB is over the 250 MB\b/.test(m), false)
}

// 3) Kontingent statt Groesse. Eine kleine Datei scheitert auf The Forge, weil
//    die Assets Library voll ist. Diese Grenze steht NICHT in status(), also
//    darf der Fall nicht in ein Groessenproblem umbenannt werden.
{
  const r = await installer().probe("dir", datei(3 * MB), uploadFailureMessage(false))
  check("3 kleine Datei bleibt unknown", r.category, INSTALL_ERROR.UNKNOWN)
  check("3 kleine Datei, die Meldung verweist auf die Konsole",
    /reason is in Foundry/.test(String(r.error?.message)), true)
}

// 4) Die Forge-API schweigt oder scheitert. Dann wird nichts erfunden, auch
//    nicht bei einer offensichtlich riesigen Datei. Beide Wege getrennt, weil
//    sie im Rumpf an verschiedenen Stellen enden.
{
  const ohne  = await installer({ antwort: null }).probe("dir", datei(661 * MB), uploadFailureMessage(false))
  const wirft = await installer({ antwort: "wirft" }).probe("dir", datei(661 * MB), uploadFailureMessage(false))
  const leer  = await installer({ antwort: { quotas: {} } }).probe("dir", datei(661 * MB), uploadFailureMessage(false))
  check("4 keine Auskunft bleibt unknown", ohne.category, INSTALL_ERROR.UNKNOWN)
  check("4 scheiternde API bleibt unknown", wirft.category, INSTALL_ERROR.UNKNOWN)
  check("4 Antwort ohne quotas.upload bleibt unknown", leer.category, INSTALL_ERROR.UNKNOWN)
}

// 5) Die Grenze wird HOECHSTENS EINMAL je Lauf gelesen, auch wenn viele
//    Dateien scheitern. Der Uebertragungspool faehrt sie nebenlaeufig, ein
//    Aufruf je Datei waere eine Last auf einem fremden System.
{
  let aufrufe = 0
  const p = installer()
  const echt = globalThis.ForgeAPI.status
  globalThis.ForgeAPI = { status: async () => { aufrufe++; return echt() } }
  await Promise.all([
    p.probe("dir", datei(300 * MB), uploadFailureMessage(false)),
    p.probe("dir", datei(400 * MB), uploadFailureMessage(false)),
    p.probe("dir", datei(500 * MB), uploadFailureMessage(false)),
  ])
  check("5 drei gleichzeitige Fehlschlaege fragen genau einmal", aufrufe, 1)
}

// 6) Selbstgehostet bleibt in der Einordnung unveraendert. Der Forge-Zweig darf
//    den Weg ueber die Sonde nicht anfassen; ohne Sondenbudget endet er in
//    unknown, und die Forge-API wird gar nicht erst gefragt.
{
  let aufrufe = 0
  globalThis.ForgeAPI = { status: async () => { aufrufe++; return null } }
  const p = new Probe()
  p._isForge = false
  p._forgeLimitPromise = null
  p._toolargeMinBytes = Infinity
  p._sizeProbesLeft = 0
  const r = await p.probe("dir", datei(300 * MB), uploadFailureMessage(undefined))
  check("6 selbstgehostet ohne Sondenbudget bleibt unknown", r.category, INSTALL_ERROR.UNKNOWN)
  check("6 selbstgehostet behaelt den historischen Wortlaut", String(r.error?.message), "upload returned no path")
  check("6 selbstgehostet fragt die Forge-API nicht", aufrufe, 0)
}

// 7) Die drei Rueckgabeformen von FilePicker.upload heissen verschieden.
//    Vorher fielen sie alle auf denselben Satz zusammen.
//
//    ACHTUNG, bewusste Verhaltensaenderung auch fuer SELBSTGEHOSTETE: Foundrys
//    eigener FilePicker gibt ebenfalls `false` zurueck, wenn der Wirt mit
//    {error} antwortet. Deren sample_message lautet ab 14.4.9 anders als vorher.
//    Das ist gewollt, weil der alte Satz dort schlicht falsch war, und der
//    Stichtag steht in der Telemetrie-Seite des Wikis.
{
  const a = uploadFailureMessage(false)
  const b = uploadFailureMessage(undefined)
  const c = uploadFailureMessage({})
  check("7 false heisst: der Wirt hat einen Grund genannt", /refused by host/.test(a), true)
  check("7 undefined behaelt den Satz aus den Kundenberichten", b, "upload returned no path")
  check("7 leeres Objekt heisst: Antwort unlesbar", /could not be read/.test(c), true)
  check("7 alle drei sind verschieden", new Set([a, b, c]).size, 3)

  const p = new Probe()
  p._isForge = false
  p._forgeLimitPromise = null
  p._toolargeMinBytes = Infinity
  p._sizeProbesLeft = 0
  const r = await p.probe("dir", datei(3 * MB), uploadFailureMessage(false))
  check("7 selbstgehostet mit false traegt den neuen Wortlaut", String(r.error?.message), a)
}

// 8) Der Wortlaut, den The Forge selbst sendet, wird erkannt. Gemessen am
//    09.09.2026 gegen assets/create mit quotas.upload + 1.
{
  check("8 Forge-Wortlaut wird als toolarge gelesen",
    classifyTransferError(new Error("File size is above acceptable limits."), null), INSTALL_ERROR.TOOLARGE)
  check("8 nginx-Wortlaut bleibt toolarge",
    classifyTransferError(new Error("client intended to send too large body"), null), INSTALL_ERROR.TOOLARGE)
  check("8 ein gewoehnlicher Netzfehler wird davon nicht beruehrt",
    classifyTransferError(new Error("Failed to fetch"), null), INSTALL_ERROR.NETWORK)
  check("8 der Textbauer bleibt unter dem Kappungspunkt der Telemetrie",
    forgeSizeRefusalMessage(692_060_160, FORGE_LIMIT).length < 200, true)
}

console.log(fails ? `\n${fails} FEHLSCHLAEGE` : `\nalle Proben bestanden${useAlt ? " (das waere ein Befund, siehe README)" : ""}`)
process.exit(fails ? 1 : 0)
