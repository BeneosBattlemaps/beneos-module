#!/usr/bin/env node
/**
 * Pruefsatz fuer tools/schluessel-suche/suche.mjs (stre-T-065).
 *
 * Fixtures im Temp, je Lauf ein zufaelliger Schluessel. Jede Ausgabe jedes
 * Laufs (stdout und stderr) wird darauf geprueft, dass weder der Schluessel
 * noch ein Stueck von acht Zeichen daraus darin steht.
 *
 *   node tools/schluessel-suche/test.mjs
 *   node tools/schluessel-suche/test.mjs --skript <pfad>   Sabotage-Fassung pruefen
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

const hier = dirname(fileURLToPath(import.meta.url))
let skript = join(hier, "suche.mjs")
const i = process.argv.indexOf("--skript")
if (i > 0 && process.argv[i + 1]) skript = process.argv[i + 1]

const KEY = randomBytes(16).toString("hex")
const BASIS = "https://gate.beneos.stream"
const wurzel = mkdtempSync(join(tmpdir(), "schluessel-suche-"))

let gruen = 0
let rot = 0
function ok(name, bed, beleg = "") {
  if (bed) { gruen++; console.log("  ok   " + name) }
  else { rot++; console.log("  ROT  " + name + (beleg ? " - " + beleg : "")) }
}
function schreib(p, inhalt) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt, null, 2))
}
function lauf(pfad, ...extra) {
  const r = spawnSync(process.execPath, [skript, pfad, ...extra], { encoding: "utf8" })
  const alles = (r.stdout || "") + (r.stderr || "")
  return { rc: r.status, out: r.stdout || "", alles }
}
function zeile(out, typ, feld) {
  const z = out.split(/\r?\n/).find((l) => l.startsWith(typ + "\t" + feld + "\t"))
  if (!z) return null
  const t = z.split("\t")
  return { treffer: Number(t[2]), platzhalter: Number(t[3]) }
}
function summe(out) {
  const m = /SUMME treffer=(\d+) platzhalter=(\d+)/.exec(out)
  return m ? { treffer: Number(m[1]), platzhalter: Number(m[2]) } : null
}
// Kein Wert in der Ausgabe: nicht ganz, und kein Stueck von 8 Zeichen.
function leckfrei(alles) {
  for (let a = 0; a + 8 <= KEY.length; a++) if (alles.includes(KEY.slice(a, a + 8))) return false
  return true
}
const leckBeleg = (r) => "rc=" + r.rc + " (Ausgabe nicht gezeigt, sie koennte den Schluessel tragen)"

try {
  // ─── W1: Schluessel in Scene und Actor.img ─────────────────────────────────
  const w1 = join(wurzel, "w1")
  schreib(join(w1, "scenes", "s1.json"), {
    _key: "!scenes!aaa", name: "Karte",
    background: { src: `${BASIS}/a/${KEY}/beneos_bm_0001/4k/map.webp` },
  })
  schreib(join(w1, "actors", "a1.json"), {
    _key: "!actors!bbb", name: "Kreatur",
    img: `${BASIS}/c/${KEY}/beneos_tok_0001/avatar.webp`,
    prototypeToken: { texture: { src: "beneos://c/beneos_tok_0001/token.webp" } },
  })
  // Eine Journalseite mit zwei Adressen im eingebetteten HTML, eine davon maskiert.
  schreib(join(w1, "journal", "j1.json"), {
    _key: "!journal!ccc",
    pages: [{ text: { content: `<img src="${BASIS}/l/${KEY}/beneos_loot_0001/x-front.webp"><img src="${BASIS}/a/-/r/v/y.webp">` } }],
  })
  const r1 = lauf(w1)
  ok("W1 liest ohne Fehler, rc 0", r1.rc === 0, "rc=" + r1.rc)
  ok("W1 zaehlt Scene background.src", zeile(r1.out, "scenes", "background.src")?.treffer === 1)
  ok("W1 zaehlt Actor img", zeile(r1.out, "actors", "img")?.treffer === 1)
  ok("W1 zaehlt die Journalseite, die maskierte Adresse nicht",
     zeile(r1.out, "journal", "pages[].text.content")?.treffer === 1)
  ok("W1 Platzhalter im prototypeToken zaehlt als Platzhalter, nicht als Treffer",
     zeile(r1.out, "actors", "prototypeToken.texture.src")?.platzhalter === 1
       && zeile(r1.out, "actors", "prototypeToken.texture.src")?.treffer === 0)
  ok("W1 Summe 3 Treffer", summe(r1.out)?.treffer === 3, String(summe(r1.out)?.treffer))
  ok("W1 gibt keinen Wert aus", leckfrei(r1.alles), leckBeleg(r1))

  // ─── W2: nur Platzhalter und maskierte Formen ──────────────────────────────
  const w2 = join(wurzel, "w2")
  schreib(join(w2, "actors", "a1.json"), { _key: "!actors!ddd", img: "beneos://c/beneos_tok_0001/avatar.webp" })
  schreib(join(w2, "items", "i1.json"), { _key: "!items!eee", flags: { "beneos-module": { loot: { render: "beneos://l/beneos_loot_0001/x-front.webp" } } } })
  schreib(join(w2, "scenes", "s1.json"), { _key: "!scenes!fff", background: { src: `${BASIS}/a/-/beneos_bm_0001/4k/map.webp` } })
  const r2 = lauf(w2)
  ok("W2 nur Platzhalter: 0 Treffer", summe(r2.out)?.treffer === 0, String(summe(r2.out)?.treffer))
  ok("W2 zaehlt 2 Platzhalter", summe(r2.out)?.platzhalter === 2, String(summe(r2.out)?.platzhalter))
  ok("W2 rc 0", r2.rc === 0)

  // ─── W3: NDJSON (*.db) und fremder Host ────────────────────────────────────
  const w3 = join(wurzel, "w3")
  schreib(join(w3, "actors.db"),
    JSON.stringify({ _id: "x", img: `${BASIS}/c/${KEY}/r/a.webp` }) + "\n"
    + JSON.stringify({ _id: "y", img: `https://example.org/c/${KEY}/r/a.webp` }) + "\n")
  const r3 = lauf(w3)
  ok("W3 NDJSON: Treffer am Tor gezaehlt, fremder Host nicht",
     zeile(r3.out, "actors", "img")?.treffer === 1, r3.rc + "")
  ok("W3 gibt keinen Wert aus", leckfrei(r3.alles), leckBeleg(r3))

  // ─── W4: unlesbare Datei, die den Schluessel traegt ────────────────────────
  const w4 = join(wurzel, "w4")
  schreib(join(w4, "scenes", "kaputt.json"), `{"_key":"!scenes!g","src":"${BASIS}/a/${KEY}/r/v/m.webp",`)
  const r4 = lauf(w4)
  ok("W4 unlesbar: rc 2 und gemeldet", r4.rc === 2 && /UNLESBAR\tscenes/.test(r4.out), "rc=" + r4.rc)
  ok("W4 auch im Fehlerfall kein Wert in der Ausgabe", leckfrei(r4.alles), leckBeleg(r4))

  // ─── W5: LevelDB wird nicht still als null gezaehlt ────────────────────────
  const w5 = join(wurzel, "w5")
  schreib(join(w5, "data", "actors", "CURRENT"), "MANIFEST-000001\n")
  schreib(join(w5, "data", "actors", "MANIFEST-000001"), "x")
  schreib(join(w5, "data", "actors", "000003.log"), `${BASIS}/c/${KEY}/r/a.webp`)
  const r5 = lauf(w5)
  ok("W5 LevelDB: rc 2 und gemeldet", r5.rc === 2 && /LEVELDB/.test(r5.out), "rc=" + r5.rc)
  ok("W5 kein Wert in der Ausgabe", leckfrei(r5.alles), leckBeleg(r5))

  // ─── W6: Feldname, der Inhalt tragen koennte ───────────────────────────────
  const w6 = join(wurzel, "w6")
  schreib(join(w6, "items", "i.json"), { _key: "!items!h", flags: { [`${KEY}`]: `${BASIS}/l/${KEY}/r/x.webp` } })
  const r6 = lauf(w6)
  ok("W6 Schluessel als Objektschluessel: gezaehlt, nicht ausgegeben",
     summe(r6.out)?.treffer === 1 && leckfrei(r6.alles), leckBeleg(r6))
} finally {
  rmSync(wurzel, { recursive: true, force: true })
}

console.log(`\n${gruen} gruen, ${rot} rot`)
process.exit(rot ? 1 : 0)
