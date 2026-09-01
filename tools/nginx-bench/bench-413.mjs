// Beneos Pruefstand, Messlauf.
//
// Schickt echte multipart-Uploads durch echtes nginx an eine echte laufende
// Foundry-Instanz und laesst die ANTWORT DES SERVERS durch genau die
// Funktionen laufen, die im Modul entscheiden. Nichts ist nachgestellt: kein
// erfundener Fehlertext, kein angenommener Statuscode.
//
// Aufruf: node bench-413.mjs <nginx-verzeichnis> <isolat.mjs>

import http from "node:http"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"

const NGINX_DIR = process.argv[2]
const ISO       = process.argv[3]
const { classifyTransferError, errorBodyExcerpt } = await import("file:///" + ISO.replace(/\\/g, "/"))

const DIRECT = Number(process.argv[4] || 30000)   // Foundry ohne Proxy, die Gegenprobe
const PROXY  = Number(process.argv[5] || 8443)    // durch nginx
const STAGE  = process.argv[6] || "V13"

function upload(port, bytes) {
  return new Promise(resolve => {
    const b = "----beneosbench"
    const head = Buffer.from(
      `--${b}\r\nContent-Disposition: form-data; name="source"\r\n\r\ndata\r\n` +
      `--${b}\r\nContent-Disposition: form-data; name="target"\r\n\r\nbeneos_assets/cloud/battlemaps\r\n` +
      `--${b}\r\nContent-Disposition: form-data; name="upload"; filename="beneos-size-probe.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n`)
    const tail = Buffer.from(`\r\n--${b}--\r\n`)
    const body = Buffer.concat([head, Buffer.alloc(bytes), tail])
    const req = http.request({
      host: "127.0.0.1", port, path: "/upload", method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${b}`, "Content-Length": body.length },
    }, r => {
      let t = ""
      r.on("data", c => t += c)
      r.on("end", () => resolve({ status: r.statusCode, text: t }))
    })
    req.on("error", e => resolve({ status: null, text: String(e.message) }))
    req.end(body)
  })
}

function setLimit(value) {
  writeFileSync(`${NGINX_DIR}\\conf\\beneos-limit.conf`, `client_max_body_size ${value};\n`)
  execFileSync(`${NGINX_DIR}\\nginx.exe`, ["-p", NGINX_DIR, "-c", "conf\\beneos-bench.conf", "-s", "reload"])
}

// Genau die Kette aus #serverRefusesSize: Status lesen, Rumpf kuerzen,
// einordnen. Ein Erfolg wird nie zu einem Erfolg umgedeutet.
function verdict(res) {
  if (res.status === null) return { category: "TRANSPORT", detail: res.text.slice(0, 60) }
  if (res.status >= 200 && res.status < 300) return { category: "durchgelassen", detail: res.text.replace(/\s+/g, " ").slice(0, 60) }
  const detail = errorBodyExcerpt(res.text)
  return { category: classifyTransferError(new Error(detail), res.status), detail: detail.slice(0, 60) }
}

const SIZES = [
  ["100 KB", 100 * 1024],
  ["2 MB",   2 * 1024 * 1024],
  ["10 MB",  10 * 1024 * 1024],
]

console.log(`===== Buehne ${STAGE} =====`)
console.log("Gegenprobe ohne Proxy, Foundry direkt auf " + DIRECT + ":")
for (const [label, bytes] of SIZES) {
  const v = verdict(await upload(DIRECT, bytes))
  console.log(`  ${label.padEnd(7)} -> ${v.category}`)
}

for (const limit of ["1m", "8m", "0"]) {
  setLimit(limit)
  await sleep(900)                       // nginx uebernimmt die neue Konfiguration
  console.log(`\nnginx, client_max_body_size ${limit}:`)
  for (const [label, bytes] of SIZES) {
    const res = await upload(PROXY, bytes)
    const v = verdict(res)
    console.log(`  ${label.padEnd(7)} -> HTTP ${String(res.status).padEnd(3)} -> ${v.category.padEnd(14)} | ${v.detail}`)
  }
}

setLimit("1m")
console.log("\nGrenze auf 1m zurueckgesetzt.")
