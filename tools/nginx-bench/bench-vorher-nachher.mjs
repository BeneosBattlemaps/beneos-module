// Nimmt die ECHTE Antwort des Pruefstands und laesst sie durch beide Staende
// laufen: den Klassifizierer vor der Aenderung (7330bd7) und den danach.
// Zusaetzlich wird Foundrys eigener Weg nachgefahren, um zu zeigen, warum der
// Statuscode dort verloren geht.

import http from "node:http"

const ALT = await import("file:///" + process.argv[2].replace(/\\/g, "/"))
const NEU = await import("file:///" + process.argv[3].replace(/\\/g, "/"))

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
    }, r => { let t = ""; r.on("data", c => t += c); r.on("end", () => resolve({ status: r.statusCode, text: t })) })
    req.on("error", e => resolve({ status: null, text: String(e.message) }))
    req.end(body)
  })
}

const res = await upload(8443, 2 * 1024 * 1024)
console.log(`Echte Antwort des Pruefstands: HTTP ${res.status}, ${res.text.length} Bytes, beginnt mit`)
console.log(`  ${res.text.split("\n")[0].trim()}`)

// 1. Foundrys Weg. FilePicker.upload liest die Antwort mit response.json().
console.log("\n1. Foundrys eigener Weg, file-picker.mjs:451")
let foundryResult
try {
  JSON.parse(res.text)
  foundryResult = "geparst"
} catch (e) {
  // Genau hier landet Foundry, und sein catch gibt {} zurueck.
  foundryResult = `response.json() wirft: ${e.constructor.name}`
}
console.log(`   ${foundryResult}`)
console.log(`   catch in Zeile 488 liefert daraufhin: {}  ->  kein .path  ->  Aufrufer weiss nichts`)
console.log(`   Der 413-Zweig in Zeile 483 prueft auf HttpError, den plain fetch nie wirft: toter Code.`)

// 2. Der Klassifizierer vor und nach der Aenderung, mit demselben Text.
const detailNeu = NEU.errorBodyExcerpt(res.text)
console.log("\n2. Klassifizierung derselben echten Antwort")
console.log(`   vorher (7330bd7), so wie es beim Kunden ankam:`)
console.log(`     ohne Status, wie Foundry ihn durchreicht : ${ALT.classifyTransferError(new Error("upload returned no path"), null)}`)
console.log(`     selbst mit Status und Rumpf             : ${ALT.classifyTransferError(new Error(detailNeu), res.status)}`)
console.log(`   nachher:`)
console.log(`     Status und Rumpf gelesen                : ${NEU.classifyTransferError(new Error(detailNeu), res.status)}`)
console.log(`\n   Ausschnitt, der in die Konsole geht (${detailNeu.length} Zeichen):`)
console.log(`     ${detailNeu}`)
