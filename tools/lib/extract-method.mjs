// Schneidet eine Methode aus einer Modulquelle, damit ein Pruefstand sie
// ohne Foundry-Globale ausfuehren kann.
//
// Ein echter Import scheitert: die Moduldateien ziehen Foundry-Globale wie
// FormApplication herein, die es in Node nicht gibt. Der Schnitt ist der
// billigste Weg, der trotzdem den ECHTEN Code misst und nicht eine Kopie,
// die auseinanderdriftet.
//
// Nach Klammern gezaehlt statt nach Zeilennummern, damit eine Verschiebung im
// Modul den Pruefstand nicht stillschweigend auf die falsche Stelle setzt.

/**
 * @param {string} text        Quelltext der Moduldatei
 * @param {string} name        Methodenname ohne `async` und ohne Klammern
 * @param {object} [grenzen]   Erwartete Laenge in Zeilen, als Schutz gegen
 *                             einen Schnitt, der zu frueh oder zu spaet endet
 * @returns {string}           Der Ausschnitt, beginnend mit der Signatur
 */
export function extractMethod(text, name, { minZeilen = 3, maxZeilen = 200 } = {}) {
  // Alle vier Schreibweisen, die im Bestand vorkommen. Fehlt eine, meldet der
  // Schnitt "nicht gefunden" fuer eine Methode, die sehr wohl da ist.
  let from = -1
  for (const prefix of ["  static async ", "  async ", "  static ", "  "]) {
    from = text.indexOf(`${prefix}${name}(`)
    if (from >= 0) break
  }
  if (from < 0) throw new Error(`Methode ${name} nicht in der Quelle gefunden`)

  // Erst das Ende der Parameterliste suchen, dann den Rumpf. Ein einfaches
  // indexOf("{") wuerde bei einem destrukturierenden Parameter wie
  // `fn(actor, { a, b })` dessen Klammer erwischen und der Schnitt endete
  // nach zwei Zeichen.
  let paren = 0
  let p = text.indexOf("(", from)
  if (p < 0) throw new Error(`Methode ${name} hat keine Parameterliste`)
  for (; p < text.length; p++) {
    if (text[p] === "(") paren++
    else if (text[p] === ")") {
      paren--
      if (paren === 0) break
    }
  }
  if (paren !== 0) throw new Error(`Die Parameterliste von ${name} ist nicht geschlossen`)

  let depth = 0
  let i = text.indexOf("{", p)
  if (i < 0) throw new Error(`Methode ${name} hat keinen Rumpf`)
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++
    else if (text[i] === "}") {
      depth--
      if (depth === 0) break
    }
  }
  if (depth !== 0) throw new Error(`Methode ${name} ist nicht geschlossen`)

  const cut = text.slice(from, i + 1)

  // Die Klammerzaehlung laeuft ueber den Rohtext, also auch durch
  // Zeichenketten, Vorlagen, regulaere Ausdruecke und Kommentare. Heute geht
  // das auf, aber eine kuenftige Klammer in einem Text wuerde das Ende still
  // verschieben. Zwei billige Zusicherungen fangen das ab, damit der
  // Pruefstand abbricht statt eine andere Stelle zu messen.
  if (!new RegExp(`^\\s*(static\\s+)?(async\\s+)?${name}\\s*\\(`).test(cut)) {
    throw new Error(`Der Schnitt von ${name} beginnt nicht mit seiner Signatur`)
  }
  const zeilen = cut.split("\n").length
  if (zeilen < minZeilen || zeilen > maxZeilen) {
    throw new Error(`Der Schnitt von ${name} hat ${zeilen} Zeilen, erwartet waren ${minZeilen} bis ${maxZeilen}. Der Schnitt endet vermutlich an der falschen Klammer.`)
  }
  return cut
}

/**
 * Schneidet eine Konstante mitsamt ihrem Wert aus der Quelle, damit ein
 * Pruefstand den echten Wert misst statt einer Abschrift, die driftet.
 */
export function extractConst(text, name) {
  const m = new RegExp(`^const\\s+${name}\\s*=\\s*([^;\\n]+);?\\s*$`, "m").exec(text)
  if (!m) throw new Error(`Konstante ${name} nicht in der Quelle gefunden`)
  return `const ${name} = ${m[1].trim()};`
}

/**
 * Baut eine ausfuehrbare Klasse aus geschnittenen Methoden. `prelude` nimmt
 * Konstanten auf, die die Methoden aus dem Modulscope erwarten.
 */
export function buildProbe(bodies, prelude = "") {
  return new Function(`${prelude}\nreturn class Probe {\n${bodies.join("\n")}\n}`)()
}
