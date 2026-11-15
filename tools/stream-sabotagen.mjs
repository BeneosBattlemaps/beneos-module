/**
 * stream-sabotagen.mjs - werden die Stream-Pruefsaetze rot, wenn der Code an
 * ihrer Stelle falsch ist? Und waren die alten Saetze dort blind?
 * Seit 14.11.2026, stre-T-017.
 *
 * WARUM ES DIESEN LAEUFER GIBT. Ein gruener Pruefsatz sagt nur, dass seine
 * Proben heute stimmen. Ob er eine kaputte Stelle BEMERKT, zeigt erst eine
 * Sabotage: eine einzige Textersetzung im Modulcode, danach muss genau die
 * benannte Probe rot sein. Die Lehre aus stre-T-016 (Worker, Commit 91d8701):
 * eine Probe gilt erst als bewacht, wenn eine Sabotage sie als ZIEL nennt und
 * rot macht; nebenbei rot zaehlt nicht, denn niemand hat dann geprueft, ob sie
 * aus dem richtigen Grund rot wird.
 *
 * DER ALTE SATZ ALS ZEUGE. Mit `--alt` faehrt der Laeufer zusaetzlich den
 * Stand des Satzes vor dem Umbau (Basis 75555bb) gegen jede Sabotage, die als
 * `luecke` markiert ist. Bleibt der alte Satz dort gruen, ist die Luecke
 * belegt, die der Umbau schliesst. Wird er rot, war es keine Luecke, und das
 * ist ein Befund gegen diese Markierung. `--alt` ist der Beleg fuer stre-T-017
 * und an diese Basis gebunden: aendert sich stream-fetch.mjs oder
 * stream-bilder.mjs spaeter weiter, ist die Altkopie ein Mischstand. Der Lauf
 * ohne `--alt` bleibt das dauerhafte Werkzeug.
 *
 * Alles laeuft in Wegwerfkopien unter dem Temp-Verzeichnis. Kein Netz.
 *
 * Aufruf:   node tools/stream-sabotagen.mjs [--satz <name>] [--alt] [--zeig]
 *           node tools/stream-sabotagen.mjs --alle-saetze
 * Rueckgabe 0 alles belegt, 1 ein Befund, 2 nicht pruefbar.
 */

import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASIS = "75555bb";
const LF = "\n";
const CR = "\r";

const SATZDATEI = (satz) => `scripts/stream/stream-${satz}.test.mjs`;

/*
 * DIE SABOTAGEN. Je Eintrag:
 *   satz    welcher Pruefsatz rot werden muss
 *   ziel    die Proben, die rot werden muessen (Name wie in der Ausgabe)
 *   luecke  true: der alte Satz (Basis) bleibt gegen diese Sabotage gruen
 *   ersetze [[datei, anker, ersatz, anzahl = 1, nr = 1], ...]
 * Der Anker muss genau `anzahl` mal in der Datei stehen, ersetzt wird die
 * Stelle `nr`. LF im Anker wird auf das Zeilenende der Datei umgesetzt.
 * Anker `null` legt die Datei mit dem Ersatz als Inhalt NEU an; sie darf im
 * Arbeitsbaum nicht liegen und wird nach dem Lauf wieder entfernt. So ist eine
 * Strukturprobe ueber einen Dateibestand bewachbar.
 */
const REPORT = "scripts/stream/stream-report.mjs";
const SETTINGS = "scripts/stream/stream-settings.mjs";
const FETCH = "scripts/stream/stream-fetch.mjs";
const OFFLINE = "scripts/stream/stream-offline.mjs";
const BILDER = "scripts/stream/stream-bilder.mjs";
const GEN = "tools/ersatzbilder.py";
// Die zwei Modulcodedateien, die stre-T-017 um Naehte erweitert (E2).
const NAEHTE = [FETCH, BILDER];
const basisText = {};
const POSEN = "scripts/stream/stream-posen.mjs";
const UTIL = "scripts/beneos_utility.js";
const CLOUD = "scripts/beneos_cloud.js";
const KARTEN = "scripts/stream/stream-karten.mjs";
const MERKER = "scripts/stream/stream-merker.mjs";
const SHEET = "scripts/loot/item-sheet-extender.mjs";
const COMP = "scripts/codex2/item-companion.mjs";

const SABOTAGEN = [
  // ---------------------------------------------------------------- maske
  { satz: "maske", ziel: ["Kartenroute, nackte Adresse","Kreaturenroute","die gemessene Zeile des Kerns","Abfragezeichenkette dahinter bleibt","zwei Adressen in einer Zeile, beide maskiert","in Anfuehrungszeichen, der Schluessel endet am Zeichen","in spitzen Klammern","im Text: zweimal maskieren aendert nichts mehr","Schluessel direkt vor dem Anfuehrungszeichen, das Zeichen bleibt","Schluessel direkt vor der spitzen Klammer, die Klammer bleibt","Beute, nackte Adresse","Beute, die gemessene Zeile des Kerns","geteilt, nackte Adresse","geteilt, die gemessene Zeile des Kerns","alle vier Raeume in einer Zeile","Raum karte (/a/): der Schluessel steht nicht mehr darin","Raum karte (/a/): der Buchstabe steht noch darin","Raum kreatur (/c/): der Schluessel steht nicht mehr darin","Raum kreatur (/c/): der Buchstabe steht noch darin","Raum beute (/l/): der Schluessel steht nicht mehr darin","Raum beute (/l/): der Buchstabe steht noch darin","Raum geteilt (/s/): der Schluessel steht nicht mehr darin","Raum geteilt (/s/): der Buchstabe steht noch darin","Fliesstext an ohneSchluessel: der Schluessel faellt (Textmaske)","Fliesstext an ohneSchluessel: der Rest bleibt stehen"], ersetze: [[REPORT, "  return s.replace(maskeCache.muster, (_, raum) => `${basis}/${raum}/-`)", "  return s"]] },
  { satz: "maske", ziel: ["Schluessel direkt vor dem Anfuehrungszeichen, das Zeichen bleibt","Schluessel direkt vor der spitzen Klammer, die Klammer bleibt"], ersetze: [[REPORT, '"\'<>]+`, "g")', ']+`, "g")']] },
  { satz: "maske", ziel: ["die Maske laesst die Platzhalterform des Raumes \"karte\" stehen","die Platzhalterform verliert ihre Abfrage, Raum \"karte\"","die Maske laesst die Platzhalterform des Raumes \"kreatur\" stehen","die Platzhalterform verliert ihre Abfrage, Raum \"kreatur\"","die Maske laesst die Platzhalterform des Raumes \"beute\" stehen","die Platzhalterform verliert ihre Abfrage, Raum \"beute\"","die Maske laesst die Platzhalterform des Raumes \"geteilt\" stehen","die Platzhalterform verliert ihre Abfrage, Raum \"geteilt\""], ersetze: [[REPORT, "  if (istPlatzhalter(roh)) return roh\n", "\n"]] },
  { satz: "maske", ziel: ["die alte geteilte Form verliert den Schluessel trotzdem","die alte geteilte Form unter fremdem Host verliert den Schluessel","eine Kartenadresse mit zu wenig Segmenten verliert den Schluessel","und genau das ist der Grund fuer den naechsten Satz: ein Buchstabe AUS der Tabelle verliert ihn","Fliesstext an ohneSchluessel: der Schluessel faellt (Textmaske)","Fliesstext an ohneSchluessel: der Rest bleibt stehen","fremder Host, nicht zerlegbar, an ohneSchluessel: der Schluessel faellt (hostunabhaengig)","fremder Host, nicht zerlegbar, mit Abfrage: die Abfrage faellt mit"], ersetze: [[REPORT, "  if (!buchstabe) return ohneSchluesselOhneZerlegung(roh)", "  if (!buchstabe) return roh"]] },
  { satz: "maske", ziel: ["Fliesstext an ohneSchluessel: der Schluessel faellt (Textmaske)","Fliesstext an ohneSchluessel: der Rest bleibt stehen"], luecke: true, ersetze: [[REPORT, "  try { u = new URL(text) } catch { return text }", "  try { u = new URL(text) } catch { return roh }"]] },
  { satz: "maske", ziel: ["die alte geteilte Form unter fremdem Host verliert den Schluessel","fremder Host, nicht zerlegbar, an ohneSchluessel: der Schluessel faellt (hostunabhaengig)","fremder Host, nicht zerlegbar, mit Abfrage: die Abfrage faellt mit"], ersetze: [[REPORT, '    teile[2] = "-"', "    teile[2] = teile[2]"]] },
  { satz: "maske", ziel: ["ein Raumbuchstabe, den die Tabelle nicht kennt, bleibt unberuehrt"], ersetze: [[REPORT, "RAUM_BUCHSTABEN.includes(teile[1])", "true"]] },
  { satz: "maske", ziel: ["geteilt steht unter /s/ und behaelt seine Pruefsumme"], ersetze: [[REPORT, "  const mitte = t.traeger\n", "  const mitte = false\n"]] },
  { satz: "maske", ziel: ["Kreatur hat keine Variante und bekommt kein leeres Stueck","Beute steht unter /l/ und nicht unter /a/","an der Adresse: zweimal maskieren aendert nichts mehr"], ersetze: [[REPORT, "    : (t.variant ? `${t.release}/${t.variant}` : t.release)", "    : `${t.release}/${t.variant}`"]] },
  { satz: "maske", ziel: ["Karte behaelt ihre Variante","Kreatur hat keine Variante und bekommt kein leeres Stueck","Beute steht unter /l/ und nicht unter /a/","geteilt steht unter /s/ und behaelt seine Pruefsumme","die Abfragezeichenkette fliegt weg, weil der Vergleich am Pfad haengt","an der Adresse: zweimal maskieren aendert nichts mehr"], ersetze: [[REPORT, "  return `${streamBase()}/${buchstabe}/-/${mitte}/${t.pfad}`", "  return `${streamBase()}/${buchstabe}/x/${mitte}/${t.pfad}`"]] },
  { satz: "maske", ziel: ["die Platzhalterform verliert ihre Abfrage, Raum \"karte\"","die Platzhalterform verliert ihre Abfrage, Raum \"kreatur\"","die Platzhalterform verliert ihre Abfrage, Raum \"beute\"","die Platzhalterform verliert ihre Abfrage, Raum \"geteilt\""], ersetze: [[REPORT, '  const roh = String(url || "").split("?")[0]', '  const roh = String(url || "")']] },
  { satz: "maske", ziel: ["Beute, nackte Adresse","Beute, die gemessene Zeile des Kerns","alle vier Raeume in einer Zeile","Beute steht unter /l/ und nicht unter /a/","an der Adresse: zweimal maskieren aendert nichts mehr","[Struktur] und es sind dieselben","beide Bauer nennen fuer \"beute\" den Buchstaben der Tabelle","kein Buchstabe steht doppelt in der Tabelle"], ersetze: [[SETTINGS, '  beute: "l",', '  beute: "a",']] },
  { satz: "maske", ziel: ["[Struktur] und es sind dieselben","beide Bauer nennen fuer \"kreatur\" den Buchstaben der Tabelle","zerlegeAdresse liest den Raum \"kreatur\" unter seinem Tabellennamen zurueck"], ersetze: [[SETTINGS, '    return ["c", encodeURIComponent(release), clean]', '    return ["k", encodeURIComponent(release), clean]']] },
  { satz: "maske", ziel: ["[Struktur] die Tabellenschluessel sind die Raumnamen aus zerlegeAdresse","zerlegeAdresse liest den Raum \"beute\" unter seinem Tabellennamen zurueck"], ersetze: [[SETTINGS, '        raum: "beute",', '        raum: "loot",']] },
  { satz: "maske", ziel: ["und dieselbe Datei in beiden Formen, Raum \"karte\"","und dieselbe Datei in beiden Formen, Raum \"kreatur\"","und dieselbe Datei in beiden Formen, Raum \"beute\"","und dieselbe Datei in beiden Formen, Raum \"geteilt\""], ersetze: [[SETTINGS, '  return `${PLATZHALTER_SCHEMA}//${teile.join("/")}`', '  return `${PLATZHALTER_SCHEMA}//${teile.slice(0, -1).join("/")}`']] },
  { satz: "maske", ziel: ["istPlatzhalter erkennt die Platzhalterform, Raum \"karte\"","istPlatzhalter erkennt die Platzhalterform, Raum \"kreatur\"","istPlatzhalter erkennt die Platzhalterform, Raum \"beute\"","istPlatzhalter erkennt die Platzhalterform, Raum \"geteilt\""], ersetze: [[SETTINGS, '    === PLATZHALTER_SCHEMA + "//"', '    === "nie//"']] },
  // Strukturproben: die Maske liest ihre Buchstaben aus der Tabelle.
  { satz: "maske", ziel: ["[Struktur] die Maske nennt STREAM_RAUM_BUCHSTABE"], ersetze: [[REPORT, "const RAUM_BUCHSTABEN = Object.values(STREAM_RAUM_BUCHSTABE)", 'const RAUM_BUCHSTABEN = ["a", "c", "l", "s"]'], [REPORT, "  const buchstabe = t ? STREAM_RAUM_BUCHSTABE[t.raum] : \"\"", '  const buchstabe = t ? ({ karte: "a", kreatur: "c", beute: "l", geteilt: "s" })[t.raum] : ""'], [REPORT, "zerlegeAdresse,\n  STREAM_RAUM_BUCHSTABE } from", "zerlegeAdresse } from"]] },
  { satz: "maske", ziel: ["[Struktur] kein festgeschriebenes (a|c) mehr im Code"], ersetze: [[REPORT, "const RAUM_BUCHSTABEN = Object.values(STREAM_RAUM_BUCHSTABE)", 'const RAUM_BUCHSTABEN = Object.values(STREAM_RAUM_BUCHSTABE)\nconst ALT = "(a|c)"']] },
  { satz: "maske", ziel: ["[Struktur] ohneSchluessel entscheidet nicht mehr zweiteilig am Raumnamen"], ersetze: [[REPORT, "const RAUM_BUCHSTABEN = Object.values(STREAM_RAUM_BUCHSTABE)", 'const RAUM_BUCHSTABEN = Object.values(STREAM_RAUM_BUCHSTABE)\nconst ALT = (raum) => raum === "kreatur"']] },
  // Gegenfaelle: die Maske greift zu weit.
  { satz: "maske", ziel: ["ein fremder Host mit derselben Pfadform","ein oertlicher Pfad des Kunden","ein Windowspfad mit a im Ordnernamen","die alte geteilte Form unter fremdem Host verliert den Schluessel","und auch im Fliesstext, Raum \"karte\"","und auch im Fliesstext, Raum \"kreatur\"","und auch im Fliesstext, Raum \"beute\"","und auch im Fliesstext, Raum \"geteilt\"","fremder Host, nicht zerlegbar, an ohneSchluessel: der Schluessel faellt (hostunabhaengig)","fremder Host, nicht zerlegbar, mit Abfrage: die Abfrage faellt mit","fremder Host an ohneSchluesselImText: bleibt stehen"], ersetze: [[REPORT, "`${roh}/(", "`(?:${roh})?/("]] },
  { satz: "maske", ziel: ["ein Satz ohne jede Adresse","die Basis allein, ohne Raum","der Freiweg traegt keinen Schluessel und bleibt unberuehrt","null wird zu der Zeichenkette null, nicht zu einem Absturz","eine Zahl kommt als Text zurueck","ein oertlicher Pfad bleibt, wie er ist","ein Raumbuchstabe, den die Tabelle nicht kennt, bleibt unberuehrt"], ersetze: [[REPORT, "  if (!RAUM_TEILSTRINGE.some((t) => s.includes(t))) return s", "  if (!RAUM_TEILSTRINGE.some((t) => s.includes(t))) return \"\""]] },
  { satz: "maske", ziel: ["leere Zeichenkette","null wird zu der Zeichenkette null, nicht zu einem Absturz","leere Eingabe wird eine leere Zeichenkette"], ersetze: [[REPORT, "  const s = String(text)\n", "  const s = String(text || \"-\")\n"]] },
  { satz: "maske", ziel: ["Kartenroute, nackte Adresse","Kreaturenroute","die gemessene Zeile des Kerns","Abfragezeichenkette dahinter bleibt","zwei Adressen in einer Zeile, beide maskiert","in Anfuehrungszeichen, der Schluessel endet am Zeichen","in spitzen Klammern","im Text: zweimal maskieren aendert nichts mehr","Schluessel direkt vor dem Anfuehrungszeichen, das Zeichen bleibt","Schluessel direkt vor der spitzen Klammer, die Klammer bleibt","die Maskierung ist idempotent am schon maskierten Text","Beute, nackte Adresse","Beute, die gemessene Zeile des Kerns","geteilt, nackte Adresse","geteilt, die gemessene Zeile des Kerns","alle vier Raeume in einer Zeile","Fliesstext an ohneSchluessel: der Rest bleibt stehen"], ersetze: [[REPORT, "  return s.replace(maskeCache.muster, (_, raum) => `${basis}/${raum}/-`)", "  return s.replace(maskeCache.muster, (_, raum) => `${basis}/${raum}/-/-`)"]] },
  { satz: "maske", ziel: ["leere Eingabe wird eine leere Zeichenkette"], ersetze: [[REPORT, '  const roh = String(url || "").split("?")[0]', '  const roh = String(url).split("?")[0]']] },
  { satz: "maske", ziel: ["ein oertlicher Pfad bleibt, wie er ist","Fliesstext an ohneSchluessel: der Rest bleibt stehen"], ersetze: [[REPORT, "  try { u = new URL(text) } catch { return text }", "  try { u = new URL(text) } catch { return \"\" }"]] },
  // Die beiden Bauer und das Zuruecklesen.
  { satz: "maske", ziel: ["beide Bauer nennen fuer \"karte\" den Buchstaben der Tabelle","und dieselbe Datei in beiden Formen, Raum \"karte\"","beide Bauer nennen fuer \"kreatur\" den Buchstaben der Tabelle","und dieselbe Datei in beiden Formen, Raum \"kreatur\"","beide Bauer nennen fuer \"beute\" den Buchstaben der Tabelle","und dieselbe Datei in beiden Formen, Raum \"beute\"","beide Bauer nennen fuer \"geteilt\" den Buchstaben der Tabelle","und dieselbe Datei in beiden Formen, Raum \"geteilt\"","zerlegeAdresse liest den Raum \"karte\" unter seinem Tabellennamen zurueck","zerlegeAdresse liest den Raum \"kreatur\" unter seinem Tabellennamen zurueck","zerlegeAdresse liest den Raum \"beute\" unter seinem Tabellennamen zurueck","zerlegeAdresse liest den Raum \"geteilt\" unter seinem Tabellennamen zurueck"], ersetze: [[SETTINGS, "  const teile = adressSegmente(release, variant, path, traeger)\n", "  const teile = adressSegmente(release, variant, path, traeger)\n  if (teile) teile[0] = teile[0].toUpperCase()\n", 2, 1]] },
  { satz: "maske", ziel: ["[Struktur] die Tabellenschluessel sind die Raumnamen aus zerlegeAdresse","zerlegeAdresse liest den Raum \"karte\" unter seinem Tabellennamen zurueck"], ersetze: [[SETTINGS, '        raum: "karte",', '        raum: "map",']] },
  { satz: "maske", ziel: ["[Struktur] die Tabellenschluessel sind die Raumnamen aus zerlegeAdresse","zerlegeAdresse liest den Raum \"geteilt\" unter seinem Tabellennamen zurueck"], ersetze: [[SETTINGS, '        raum: "geteilt",', '        raum: "shared",']] },
  // Strukturproben: die rohe Zaehlung selbst.
  { satz: "maske", ziel: ["[Struktur] die rohe Zaehlung findet ueberhaupt Buchstaben","[Struktur] adressSegmente baut genau so viele Raeume, wie die Tabelle nennt","[Struktur] und es sind dieselben"], ersetze: [[SETTINGS, "export function adressSegmente(", "export function segmenteDerAdresse("], [SETTINGS, "  const teile = adressSegmente(release, variant, path, traeger)", "  const teile = segmenteDerAdresse(release, variant, path, traeger)", 2, 1], [SETTINGS, "  const teile = adressSegmente(release, variant, path, traeger)", "  const teile = segmenteDerAdresse(release, variant, path, traeger)"]] },
  { satz: "maske", ziel: ["[Struktur] adressSegmente baut genau so viele Raeume, wie die Tabelle nennt"], ersetze: [[SETTINGS, "    return [\"c\", encodeURIComponent(release), clean]", "    if (clean === \"nie\") return [\"c\", encodeURIComponent(release), clean]\n    return [\"c\", encodeURIComponent(release), clean]"]] },
  { satz: "maske", ziel: ["[Struktur] der Schnitt endet vor dem naechsten Export"], ersetze: [[SETTINGS, "\nexport function assetUrl(", "\n export function assetUrl("]] },
  { satz: "maske", ziel: ["[Struktur] die rohe Zaehlung findet ueberhaupt Raumnamen","[Struktur] die Tabellenschluessel sind die Raumnamen aus zerlegeAdresse"], ersetze: [[SETTINGS, 'raum: "', '"raum": "', 4, 1], [SETTINGS, 'raum: "', '"raum": "', 3, 1], [SETTINGS, 'raum: "', '"raum": "', 2, 1], [SETTINGS, 'raum: "', '"raum": "']] },
  // ---------------------------------------------------------------- geteilt
  // Der Umrechner, ueber die Naht mit dem Schalter AN.
  { satz: "geteilt", ziel: ["mit Pruefsumme, Schalter AN: der geteilte Schluessel","bei AN idempotent: ein Schluessel bleibt ein Schluessel","bei AN haengt der Vergleich am Pfad, eine Abfrage stoert nicht"], ersetze: [[FETCH, "  const g = geteilterDreiklang(s, t, an)\n", "  const g = null\n"]] },
  { satz: "geteilt", ziel: ["mit Pruefsumme, Schalter AUS (ausgeliefert): der Kartenschluessel bleibt","eine Karte kommt zurueck wie vorher (Legacy, byte-gleich)"], ersetze: [[FETCH, "  return vorratsSchluesselBei(url, GETEILTER_VORRAT_AN)", "  return vorratsSchluesselBei(url, true)"]] },
  { satz: "geteilt", ziel: ["ein geteilter Dreiklang wird nicht zweimal umgerechnet"], ersetze: [[FETCH, "  if (t.raum === \"geteilt\") return null\n", "\n"]] },
  { satz: "geteilt", ziel: ["eine Szenendatei mit bekannter Pruefsumme ist nicht geteilt","und behaelt bei AN ihren Kartenschluessel"], ersetze: [[FETCH, "  if (!istGeteilteDatei(url)) return null\n", "\n"]] },
  { satz: "geteilt", ziel: ["ohne bekannte Pruefsumme: kein Dreiklang, auch bei AN","ohne bekannte Pruefsumme: der Kartenschluessel, auch bei AN"], ersetze: [[FETCH, "  const sha = shaZuAdresse.get(ohneAbfrage(url))\n  if (!sha) return null", "  const sha = shaZuAdresse.get(ohneAbfrage(url)) || \"0\".repeat(64)\n  if (!sha) return null"]] },
  { satz: "geteilt", ziel: ["bei AN haengt der Vergleich am Pfad, eine Abfrage stoert nicht"], ersetze: [[FETCH, "  const sha = shaZuAdresse.get(ohneAbfrage(url))\n", "  const sha = shaZuAdresse.get(url)\n"]] },
  { satz: "geteilt", ziel: ["mit Pruefsumme, Schalter AN: der geteilte Schluessel","bei AN idempotent: ein Schluessel bleibt ein Schluessel","bei AN haengt der Vergleich am Pfad, eine Abfrage stoert nicht","der Dreiklang: Raum, Raumname, Pruefsumme und der Basisname","200 Zeichen gehen noch","aus Unterordnern bleibt nur der Basisname","ein Punkt mitten im Namen ist erlaubt","Bindestrich und Unterstrich sind erlaubt"], ersetze: [[FETCH, "  const name = String(t.pfad).split(\"/\").pop()", "  const name = String(t.pfad)"]] },
  { satz: "geteilt", ziel: ["201 Zeichen: kein Dreiklang"], luecke: true, ersetze: [[FETCH, "name.length > 200", "name.length > 201"]] },
  { satz: "geteilt", ziel: ["200 Zeichen gehen noch"], ersetze: [[FETCH, "name.length > 200", "name.length > 199"]] },
  { satz: "geteilt", ziel: ["ein Name mit Nicht-ASCII-Zeichen: kein Dreiklang"], ersetze: [[FETCH, "!/^[A-Za-z0-9._-]+$/.test(name)", "!/^\\S+$/.test(name)"]] },
  { satz: "geteilt", ziel: ["200 Zeichen gehen noch","ein Punkt mitten im Namen ist erlaubt","Bindestrich und Unterstrich sind erlaubt"], ersetze: [[FETCH, "!/^[A-Za-z0-9._-]+$/.test(name)", "!/^[A-Za-z0-9_]+\\.[a-z]+$/.test(name)"]] },
  { satz: "geteilt", ziel: ["ein fuehrender Punkt: kein Dreiklang"], ersetze: [[FETCH, "  if (name[0] === \".\") return null\n", "\n"]] },
  { satz: "geteilt", ziel: ["ein Schluessel bleibt ein Schluessel"], ersetze: [[FETCH, "  if (s.startsWith(VORRAT_URSPRUNG)) return s\n  const t = zerlegeAdresse(s)\n  if (!t) return s\n  const g", "  const t = zerlegeAdresse(s)\n  if (!t) return s\n  const g"]] },
  { satz: "geteilt", ziel: ["mit Pruefsumme, Schalter AN: der geteilte Schluessel","bei AN idempotent: ein Schluessel bleibt ein Schluessel","bei AN haengt der Vergleich am Pfad, eine Abfrage stoert nicht"], ersetze: [[FETCH, "  const quelle = g || t\n", "  const quelle = t\n"]] },
  // Der Rueckweg und das Sammeln.
  { satz: "geteilt", ziel: ["mit Manifest wird daraus die siebenteilige Adresse des Traegers"], ersetze: [[FETCH, "      return geteilteAdresse(sha, name, adressenZuSha.get(sha)) || s", "      return s"]] },
  { satz: "geteilt", ziel: ["ohne Manifest bleibt der geteilte Schluessel, wie er ist"], ersetze: [[FETCH, "      return geteilteAdresse(sha, name, adressenZuSha.get(sha)) || s", "      return geteilteAdresse(sha, name, adressenZuSha.get(sha))"]] },
  { satz: "geteilt", ziel: ["eine geteilte Adresse sammelt unter ihrem Traeger"], ersetze: [[FETCH, "  if (t.traeger) return `${t.traeger.release}/${t.traeger.variant}`", "  if (t.traeger) return t.release"]] },
  { satz: "geteilt", ziel: ["eine Karte sammelt wie vorher (Legacy, byte-gleich)"], ersetze: [[FETCH, "  return t.variant ? `${t.release}/${t.variant}` : t.release\n}", "  return t.release\n}"]] },
  // Die Adresse: Bau, Traeger, Zerlegung.
  { satz: "geteilt", ziel: ["der Raumname in Grossbuchstaben ist ein anderer Name"], ersetze: [[SETTINGS, "  return String(release || \"\") === GETEILT_RAUM\n", "  return String(release || \"\").toLowerCase() === GETEILT_RAUM\n"]] },
  { satz: "geteilt", ziel: ["Grossbuchstaben fallen"], ersetze: [[SETTINGS, "      && /^[a-f0-9]{64}$/.test(String(variant || \"\"))\n}", "      && /^[a-fA-F0-9]{64}$/.test(String(variant || \"\"))\n}"]] },
  { satz: "geteilt", ziel: ["Raumname mit 63 Zeichen faellt"], ersetze: [[SETTINGS, "      && /^[a-f0-9]{64}$/.test(String(variant || \"\"))\n}", "      && /^[a-f0-9]{1,64}$/.test(String(variant || \"\"))\n}"]] },
  { satz: "geteilt", ziel: ["map_assets nur als ganzer Ordner, nicht im Dateinamen"], ersetze: [[SETTINGS, "  return /\\/map_assets\\//.test(String(url || \"\"))", "  return /map_assets/.test(String(url || \"\"))"]] },
  { satz: "geteilt", ziel: ["Traeger ohne Variante: leer","Kreatur als Traeger: leer","Beute als Traeger: leer","der Raumname als Traeger: leer","ein Traeger mit Schraegstrich: leer","Variante \".\": keine Adresse","Variante \"..\": keine Adresse"], ersetze: [[SETTINGS, "    if (!istTraeger(traeger)) return null\n    return [\"s\"", "    if (!traeger) return null\n    return [\"s\""]] },
  { satz: "geteilt", ziel: ["Kreatur als Traeger: leer","Beute als Traeger: leer","der Raumname als Traeger: leer","eine Kreatur als Traeger wird abgewiesen"], ersetze: [[SETTINGS, "  return r.startsWith(KARTE_PRAEFIX) && segment.test(r) && segment.test(v) && !/^\\.{1,2}$/.test(v)", "  return segment.test(r) && segment.test(v) && !/^\\.{1,2}$/.test(v)"]] },
  { satz: "geteilt", ziel: ["Variante \".\": keine Adresse","Variante \".\": der Platzhalter wird nicht zerlegt","Variante \"..\": keine Adresse","Variante \"..\": der Platzhalter wird nicht zerlegt"], ersetze: [[SETTINGS, "  return r.startsWith(KARTE_PRAEFIX) && segment.test(r) && segment.test(v) && !/^\\.{1,2}$/.test(v)", "  return r.startsWith(KARTE_PRAEFIX) && segment.test(r) && segment.test(v)"]] },
  { satz: "geteilt", ziel: ["Traeger ohne Variante: leer","geteilteAdresse: eine Karte mit unbrauchbarer Variante wird uebersprungen"], ersetze: [[SETTINGS, "  return r.startsWith(KARTE_PRAEFIX) && segment.test(r) && segment.test(v) && !/^\\.{1,2}$/.test(v)", "  return r.startsWith(KARTE_PRAEFIX) && segment.test(r) && !/^\\.{1,2}$/.test(v)"]] },
  { satz: "geteilt", ziel: ["ein Traeger mit Schraegstrich: leer","geteilteAdresse: eine Karte mit unbrauchbarer Variante wird uebersprungen"], ersetze: [[SETTINGS, "  const segment = /^[A-Za-z0-9_.-]{1,120}$/\n", "  const segment = /^[^]{1,120}$/\n"]] },
  { satz: "geteilt", ziel: ["die Adresse hat die Form der Route","genau sieben Segmente nach dem Host","beide Traeger zerlegen sich zu derselben Kennung","der Raum heisst geteilt","release ist der Raumname","variant ist die Pruefsumme","pfad ist der Dateiname","der Traeger wird mitgegeben","hin und zurueck ergibt dasselbe","und wieder zur selben Adresse","eine geteilte Adresse ergibt den geteilten Schluessel","zwei Traeger, ein Vorratsschluessel","und er nennt kein Release","eine geteilte Adresse sammelt unter ihrem Traeger"], ersetze: [[SETTINGS, "    return [\"s\", traeger.release, traeger.variant, GETEILT_RAUM, encodeURIComponent(variant), clean]", "    return [\"s\", traeger.release, GETEILT_RAUM, encodeURIComponent(variant), clean]"]] },
  { satz: "geteilt", ziel: ["die Adresse hat die Form der Route","beide Traeger zerlegen sich zu derselben Kennung","der Raum heisst geteilt","release ist der Raumname","variant ist die Pruefsumme","pfad ist der Dateiname","der Traeger wird mitgegeben","hin und zurueck ergibt dasselbe","und wieder zur selben Adresse","eine geteilte Adresse ergibt den geteilten Schluessel","zwei Traeger, ein Vorratsschluessel","und er nennt kein Release","eine geteilte Adresse sammelt unter ihrem Traeger"], ersetze: [[SETTINGS, "    return [\"s\", traeger.release, traeger.variant, GETEILT_RAUM, encodeURIComponent(variant), clean]", "    return [\"s\", traeger.variant, traeger.release, GETEILT_RAUM, encodeURIComponent(variant), clean]"]] },
  { satz: "geteilt", ziel: ["die Adresse hat die Form der Route","genau sieben Segmente nach dem Host","ohne Traeger: leere Zeichenkette","Traeger ohne Variante: leer","Kreatur als Traeger: leer","Beute als Traeger: leer","der Raumname als Traeger: leer","ein Traeger mit Schraegstrich: leer","ohne Traeger auch keine Platzhalterform","anderer Traeger, andere Adresse","der Raum heisst geteilt","der Traeger wird mitgegeben","hin und zurueck ergibt dasselbe","eine geteilte Adresse sammelt unter ihrem Traeger","Variante \".\": keine Adresse","Variante \"..\": keine Adresse"], ersetze: [[SETTINGS, "  if (istGeteilterRaum(release, variant)) {", "  if (false) {"]] },
  { satz: "geteilt", ziel: ["acht Segmente werden abgewiesen","sechs Segmente werden abgewiesen"], ersetze: [[SETTINGS, "    if (teile[0] === \"s\" && teile[4] === GETEILT_RAUM && teile.length === 7) {", "    if (teile[0] === \"s\" && teile[4] === GETEILT_RAUM && teile.length >= 6) {"]] },
  { satz: "geteilt", ziel: ["ein falscher Raumname wird abgewiesen"], ersetze: [[SETTINGS, "    if (teile[0] === \"s\" && teile[4] === GETEILT_RAUM && teile.length === 7) {", "    if (teile[0] === \"s\" && teile.length === 7) {"]] },
  { satz: "geteilt", ziel: ["Grossbuchstaben in der Pruefsumme werden abgewiesen"], ersetze: [[SETTINGS, "      const sha = decodeURIComponent(teile[5])\n      if (!/^[a-f0-9]{64}$/.test(sha)) return null", "      const sha = decodeURIComponent(teile[5])\n      if (!/^[a-fA-F0-9]+$/.test(sha)) return null"]] },
  { satz: "geteilt", ziel: ["eine Kreatur als Traeger wird abgewiesen","ein leerer Traeger wird abgewiesen","Variante \".\": der Platzhalter wird nicht zerlegt","Variante \"..\": der Platzhalter wird nicht zerlegt"], ersetze: [[SETTINGS, "      if (!istTraeger(traeger)) return null\n      return {\n        raum: \"geteilt\",", "      return {\n        raum: \"geteilt\","]] },
  { satz: "geteilt", ziel: ["der Traeger wird mitgegeben","hin und zurueck ergibt dasselbe","und wieder zur selben Adresse","eine geteilte Adresse sammelt unter ihrem Traeger"], ersetze: [[SETTINGS, "        pfad: decodeURIComponent(teile[6]),\n        traeger,\n", "        pfad: decodeURIComponent(teile[6]),\n"]] },
  { satz: "geteilt", ziel: ["geteilteAdresse: eine Karte mit unbrauchbarer Variante wird uebersprungen"], ersetze: [[SETTINGS, "    const traeger = { release: t.release, variant: t.variant }\n    if (!istTraeger(traeger)) continue\n", "    const traeger = { release: t.release, variant: t.variant }\n"]] },
  { satz: "geteilt", ziel: ["geteilteAdresse: andere erste Karte, anderer Traeger","mit Manifest wird daraus die siebenteilige Adresse des Traegers"], ersetze: [[SETTINGS, "  for (const a of kartenAdressen || []) {", "  for (const a of (kartenAdressen || []).slice(1)) {"]] },
  { satz: "geteilt", ziel: ["der Raum heisst shared","die Adresse hat die Form der Route","ein falscher Raumname wird abgewiesen","eine geteilte Adresse ergibt den geteilten Schluessel"], ersetze: [[SETTINGS, "export const GETEILT_RAUM = ", "export const GETEILT_RAUM = \"geteilt\" || "]] },
  // Strukturproben.
  { satz: "geteilt", ziel: ["[Struktur] die Regel ist genau einmal definiert","[Struktur] stream-offline.mjs importiert sie","[Struktur] das Muster map_assets steht im Code nur an der einen Stelle"], ersetze: [[OFFLINE, "streamBase, VIDEO_EXT, istGeteilteDatei } from \"./stream-settings.mjs\"", "streamBase, VIDEO_EXT } from \"./stream-settings.mjs\"\nfunction istGeteilteDatei(url) { return /\\/map_assets\\//.test(String(url || \"\")) }"]] },
  { satz: "geteilt", ziel: ["[Struktur] der Raumname ist genau einmal gesetzt","[Struktur] stream-fetch.mjs importiert ihn"], ersetze: [[FETCH, "downloadMode, GETEILT_RAUM, geteilteAdresse", "downloadMode, geteilteAdresse"], [FETCH, "const GETEILTER_VORRAT_AN = false\n", "const GETEILTER_VORRAT_AN = false\nconst GETEILT_RAUM = \"shared\"\n"]] },
  // ---------------------------------------------------------------- geteilt, zweite Welle
  { satz: "geteilt", ziel: ["kein Kreaturenrelease heisst shared","die Adresse hat die Form der Route","genau sieben Segmente nach dem Host","ohne Traeger: leere Zeichenkette","Traeger ohne Variante: leer","Kreatur als Traeger: leer","Beute als Traeger: leer","der Raumname als Traeger: leer","ein Traeger mit Schraegstrich: leer","ohne Traeger auch keine Platzhalterform","anderer Traeger, andere Adresse","beide Traeger zerlegen sich zu derselben Kennung","ohne Pruefsumme kommt die Kartenadresse","der Raum heisst geteilt","variant ist die Pruefsumme","der Traeger wird mitgegeben","hin und zurueck ergibt dasselbe","eine geteilte Adresse ergibt den geteilten Schluessel","und er nennt kein Release","mit Manifest wird daraus die siebenteilige Adresse des Traegers","eine geteilte Adresse sammelt unter ihrem Traeger","Variante \".\": keine Adresse","Variante \"..\": keine Adresse"], ersetze: [[SETTINGS, "  return String(release || \"\").startsWith(KREATUR_PRAEFIX)\n", "  return String(release || \"\").startsWith(KREATUR_PRAEFIX) || release === \"shared\"\n"]] },
  { satz: "geteilt", ziel: ["kein Beuterelease heisst shared","die Adresse hat die Form der Route","genau sieben Segmente nach dem Host","ohne Traeger: leere Zeichenkette","Traeger ohne Variante: leer","Kreatur als Traeger: leer","Beute als Traeger: leer","der Raumname als Traeger: leer","ein Traeger mit Schraegstrich: leer","ohne Traeger auch keine Platzhalterform","anderer Traeger, andere Adresse","beide Traeger zerlegen sich zu derselben Kennung","ohne Pruefsumme kommt die Kartenadresse","der Raum heisst geteilt","variant ist die Pruefsumme","der Traeger wird mitgegeben","hin und zurueck ergibt dasselbe","eine geteilte Adresse ergibt den geteilten Schluessel","und er nennt kein Release","mit Manifest wird daraus die siebenteilige Adresse des Traegers","eine geteilte Adresse sammelt unter ihrem Traeger","Variante \".\": keine Adresse","Variante \"..\": keine Adresse"], ersetze: [[SETTINGS, "  return String(release || \"\").startsWith(BEUTE_PRAEFIX)\n", "  return String(release || \"\").startsWith(BEUTE_PRAEFIX) || release === \"shared\"\n"]] },
  { satz: "geteilt", ziel: ["Raumname plus Pruefsumme","die Adresse hat die Form der Route","genau sieben Segmente nach dem Host","ohne Traeger: leere Zeichenkette","Traeger ohne Variante: leer","Kreatur als Traeger: leer","Beute als Traeger: leer","der Raumname als Traeger: leer","ein Traeger mit Schraegstrich: leer","ohne Traeger auch keine Platzhalterform","anderer Traeger, andere Adresse","der Raum heisst geteilt","der Traeger wird mitgegeben","hin und zurueck ergibt dasselbe","eine geteilte Adresse sammelt unter ihrem Traeger","Variante \".\": keine Adresse","Variante \"..\": keine Adresse"], ersetze: [[SETTINGS, "export function istGeteilterRaum(release, variant) {\n", "export function istGeteilterRaum(release, variant) {\n  if (variant !== \"\") return false\n"]] },
  { satz: "geteilt", ziel: ["Raumname ohne Pruefsumme faellt","Raumname mit 63 Zeichen faellt","Raumname mit 65 Zeichen faellt","Grossbuchstaben fallen","ohne Pruefsumme kommt die Kartenadresse","und nicht die geteilte"], ersetze: [[SETTINGS, "export function istGeteilterRaum(release, variant) {\n", "export function istGeteilterRaum(release, variant) {\n  if (String(release || \"\") === GETEILT_RAUM) return true\n"]] },
  { satz: "geteilt", ziel: ["der Raumname in Grossbuchstaben ist ein anderer Name","Pruefsumme ohne Raumnamen faellt"], ersetze: [[SETTINGS, "export function istGeteilterRaum(release, variant) {\n", "export function istGeteilterRaum(release, variant) {\n  if (/^[a-f0-9]{64}$/.test(String(variant || \"\"))) return true\n"]] },
  { satz: "geteilt", ziel: ["leer faellt","undefined faellt"], ersetze: [[SETTINGS, "export function istGeteilterRaum(release, variant) {\n", "export function istGeteilterRaum(release, variant) {\n  if (!release) return true\n"]] },
  { satz: "geteilt", ziel: ["map_assets wird erkannt","mit Pruefsumme, Schalter AN: der geteilte Schluessel","bei AN idempotent: ein Schluessel bleibt ein Schluessel","bei AN haengt der Vergleich am Pfad, eine Abfrage stoert nicht","der Dreiklang: Raum, Raumname, Pruefsumme und der Basisname","200 Zeichen gehen noch","aus Unterordnern bleibt nur der Basisname","ein Punkt mitten im Namen ist erlaubt","Bindestrich und Unterstrich sind erlaubt"], ersetze: [[SETTINGS, "  return /\\/map_assets\\//.test(String(url || \"\"))", "  return /\\/map_assets\\//.test(String(url || \"\")) && false"]] },
  { satz: "geteilt", ziel: ["eine Kartendatei nicht","map_assets nur als ganzer Ordner, nicht im Dateinamen","eine Szenendatei mit bekannter Pruefsumme ist nicht geteilt","und behaelt bei AN ihren Kartenschluessel"], ersetze: [[SETTINGS, "  return /\\/map_assets\\//.test(String(url || \"\"))", "  return /\\/(map_assets|scenes)\\//.test(String(url || \"\"))"]] },
  { satz: "geteilt", ziel: ["leer nicht","undefined nicht"], ersetze: [[SETTINGS, "  return /\\/map_assets\\//.test(String(url || \"\"))", "  return !url || /\\/map_assets\\//.test(String(url || \"\"))"]] },
  { satz: "geteilt", ziel: ["[Struktur] die Regel ist genau einmal definiert","[Struktur] und sie steht in stream-settings.mjs","[Struktur] der Trenner laesst Code stehen"], ersetze: [[SETTINGS, "export function istGeteilteDatei(url) {", "export { istGeteilteDateiIntern as istGeteilteDatei }\nfunction istGeteilteDateiIntern(url) {"]] },
  { satz: "geteilt", ziel: ["[Struktur] und wirft Kommentare weg"], ersetze: [[SETTINGS, "UMGEZOGEN AM 2026-11-08", "umgezogen am 2026-11-08"]] },
  { satz: "geteilt", ziel: ["die Adresse hat die Form der Route","der Schluessel steht drin","Kartenadresse byte-gleich","Kreaturadresse byte-gleich","Beuteadresse byte-gleich","eine Karte kommt zurueck wie vorher (Legacy, byte-gleich)"], ersetze: [[SETTINGS, "  const schluessel = encodeURIComponent(streamKey())\n", "  const schluessel = \"-\"\n"]] },
  { satz: "geteilt", ziel: ["geteilteAdresse: erste Kartenadresse ist der Traeger","geteilteAdresse: andere erste Karte, anderer Traeger"], ersetze: [[SETTINGS, "  for (const a of kartenAdressen || []) {", "  for (const a of [...(kartenAdressen || [])].reverse()) {"]] },
  { satz: "geteilt", ziel: ["geteilteAdresse: ohne Kartenadresse leer","geteilteAdresse: ohne Verzeichnis leer","ohne Manifest bleibt der geteilte Schluessel, wie er ist"], ersetze: [[SETTINGS, "    return assetUrl(GETEILT_RAUM, sha, name, traeger)\n  }\n  return \"\"\n", "    return assetUrl(GETEILT_RAUM, sha, name, traeger)\n  }\n  return assetUrl(GETEILT_RAUM, sha, name, { release: \"beneos_bm_0001\", variant: \"4k\" })\n"]] },
  { satz: "geteilt", ziel: ["ohne Pruefsumme kommt die Kartenadresse","und nicht die geteilte"], ersetze: [[SETTINGS, "  if (istGeteilterRaum(release, variant)) {", "  if (String(release) === GETEILT_RAUM) {"]] },
  { satz: "geteilt", ziel: ["eine Karte bleibt eine Karte","Kartenadresse byte-gleich","Kartenplatzhalter byte-gleich","eine Kartenadresse bleibt eine Karte","eine geteilte Datei behaelt bei AUS den Kartenschluessel","eine Karte kommt zurueck wie vorher (Legacy, byte-gleich)"], ersetze: [[SETTINGS, "  if (istGeteilterRaum(release, variant)) {", "  if (istGeteilterRaum(release, variant) || String(release).startsWith(\"beneos_bm\")) {"]] },
  { satz: "geteilt", ziel: ["eine Kreatur bleibt eine Kreatur","Kreaturadresse byte-gleich","eine Kreaturenadresse bleibt eine Kreatur"], ersetze: [[SETTINGS, "  if (istKreatur(release)) {\n    return [\"c\"", "  if (istKreatur(release) && false) {\n    return [\"c\""]] },
  { satz: "geteilt", ziel: ["ein Gegenstand bleibt ein Gegenstand","Beuteadresse byte-gleich","eine Beuteadresse bleibt Beute"], ersetze: [[SETTINGS, "  if (istBeute(release)) {\n    return [\"l\"", "  if (istBeute(release) && false) {\n    return [\"l\""]] },
  { satz: "geteilt", ziel: ["geteilteAdresse: erste Kartenadresse ist der Traeger","geteilteAdresse: andere erste Karte, anderer Traeger","geteilteAdresse: eine Karte mit unbrauchbarer Variante wird uebersprungen","eine Kartenadresse bleibt eine Karte","eine geteilte Datei behaelt bei AUS den Kartenschluessel"], ersetze: [[SETTINGS, "    if (teile[0] === \"a\" && teile.length >= 5) {", "    if (teile[0] === \"x\" && teile.length >= 5) {"]] },
  { satz: "geteilt", ziel: ["eine Kreaturenadresse bleibt eine Kreatur"], ersetze: [[SETTINGS, "    if (teile[0] === \"c\" && teile.length >= 4) {", "    if (teile[0] === \"x\" && teile.length >= 4) {"]] },
  { satz: "geteilt", ziel: ["eine Beuteadresse bleibt Beute"], ersetze: [[SETTINGS, "    if (teile[0] === \"l\" && teile.length >= 4) {", "    if (teile[0] === \"x\" && teile.length >= 4) {"]] },
  { satz: "geteilt", ziel: ["die alte Form ohne Release wird abgewiesen","acht Segmente werden abgewiesen","sechs Segmente werden abgewiesen","eine Variante ohne Pruefsummenform wird abgewiesen","Grossbuchstaben in der Pruefsumme werden abgewiesen","eine Kreatur als Traeger wird abgewiesen","ein leerer Traeger wird abgewiesen","eine fremde Adresse bekommt null","eine fremde Adresse in der neuen Form ohne Pruefsumme bekommt null","Variante \".\": der Platzhalter wird nicht zerlegt","Variante \"..\": der Platzhalter wird nicht zerlegt"], ersetze: [[SETTINGS, "    if (teile[0] === \"s\" && teile[4] === GETEILT_RAUM && teile.length === 7) {", "    if (teile[0] === \"s\" && teile.includes(GETEILT_RAUM)) {"], [SETTINGS, "      if (!/^[a-f0-9]{64}$/.test(sha)) return null\n      const traeger", "      if (!/^.+$/.test(sha)) return null\n      const traeger"], [SETTINGS, "      if (!istTraeger(traeger)) return null\n      return {\n        raum: \"geteilt\",", "      return {\n        raum: \"geteilt\","]] },
  { satz: "geteilt", ziel: ["eine Variante ohne Pruefsummenform wird abgewiesen","Grossbuchstaben in der Pruefsumme werden abgewiesen"], ersetze: [[SETTINGS, "      if (!/^[a-f0-9]{64}$/.test(sha)) return null\n      const traeger", "      if (!/^.+$/.test(sha)) return null\n      const traeger"]] },
  { satz: "geteilt", ziel: ["keine Kundeneinstellung nennt den Vorrat"], ersetze: [[SETTINGS, "  offlineGeteilt: \"beneos-stream-offline-shared\",\n", "  offlineGeteilt: \"beneos-stream-offline-shared\",\n  geteilterVorrat: \"beneos-stream-shared-store\",\n"]] },
  { satz: "geteilt", ziel: ["[Struktur] die Abrufschicht liest keine Einstellung zum Vorrat"], ersetze: [[FETCH, "const GETEILTER_VORRAT_AN = false\n", "const GETEILTER_VORRAT_AN = false\nconst vorratLesen = () => SETTING.geteiltVorrat\n"]] },
  { satz: "geteilt", ziel: ["eine geteilte Datei behaelt bei AUS den Kartenschluessel","eine geteilte Adresse ergibt den geteilten Schluessel","ohne bekannte Pruefsumme: der Kartenschluessel, auch bei AN","mit Pruefsumme, Schalter AUS (ausgeliefert): der Kartenschluessel bleibt","mit Pruefsumme, Schalter AN: der geteilte Schluessel","bei AN idempotent: ein Schluessel bleibt ein Schluessel","bei AN haengt der Vergleich am Pfad, eine Abfrage stoert nicht","und behaelt bei AN ihren Kartenschluessel","und er nennt kein Release","eine Kartenadresse behaelt ihren Schluessel (Legacy, byte-gleich)","mit Manifest wird daraus die siebenteilige Adresse des Traegers","eine Karte kommt zurueck wie vorher (Legacy, byte-gleich)"], ersetze: [[FETCH, "  return `${VORRAT_URSPRUNG}/a/${encodeURIComponent(quelle.release)}", "  return `${VORRAT_URSPRUNG}/k/${encodeURIComponent(quelle.release)}"]] },
  { satz: "geteilt", ziel: ["ein Name mit Leerzeichen: kein Dreiklang"], ersetze: [[FETCH, "!/^[A-Za-z0-9._-]+$/.test(name)", "!/^[A-Za-z0-9._ -]+$/.test(name)"]] },
  // ---------------------------------------------------------------- bilder
  // Die Flaechenliste.
  { satz: "bilder", ziel: ["die fuenf render-Haken sind die gemessenen","der stumme Name renderItemSheetV2 ist nicht angemeldet"], ersetze: [[BILDER, "  [\"renderItemSheet5e\", \"closeItemSheet5e\"],", "  [\"renderItemSheetV2\", \"closeItemSheetV2\"],"]] },
  { satz: "bilder", ziel: ["renderImagePopout hat seinen close-Haken derselben Klasse"], ersetze: [[BILDER, "  [\"renderImagePopout\", \"closeImagePopout\"],", "  [\"renderImagePopout\", \"closeImagePopoutV2\"],"]] },
  { satz: "bilder", ziel: ["genau zehn Haken","fuenf davon render, fuenf close","die fuenf render-Haken sind die gemessenen"], ersetze: [[BILDER, "  [\"renderActorSheetV2\", \"closeActorSheetV2\"],", ""]] },
  { satz: "bilder", ziel: ["genau zehn Haken","fuenf davon render, fuenf close","die fuenf render-Haken sind die gemessenen","kein Name steht zweimal"], ersetze: [[BILDER, "  [\"renderActorSheetV2\", \"closeActorSheetV2\"],", "  [\"renderActorSheetV2\", \"closeActorSheetV2\"],\n  [\"renderActorSheetV2\", \"closeActorSheetV2\"],"]] },
  { satz: "bilder", ziel: ["genau zehn Haken","fuenf davon render, fuenf close","die fuenf render-Haken sind die gemessenen","der stumme Name renderActorSheet ist nicht angemeldet"], ersetze: [[BILDER, "  [\"renderActorSheetV2\", \"closeActorSheetV2\"],", "  [\"renderActorSheetV2\", \"closeActorSheetV2\"],\n  [\"renderActorSheet\", \"closeActorSheet\"],"]] },
  { satz: "bilder", ziel: ["genau zehn Haken","fuenf davon render, fuenf close","die fuenf render-Haken sind die gemessenen","renderDocumentSheetV2 ist nicht angemeldet, es doppelte die anderen Zeilen"], ersetze: [[BILDER, "  [\"renderActorSheetV2\", \"closeActorSheetV2\"],", "  [\"renderActorSheetV2\", \"closeActorSheetV2\"],\n  [\"renderDocumentSheetV2\", \"closeDocumentSheetV2\"],"]] },
  { satz: "bilder", ziel: ["die fuenf render-Haken sind die gemessenen","der stumme Name renderJournalSheet ist nicht angemeldet","die Toradresse wird eine Blob-Adresse","die Platzhalterform wird eine Blob-Adresse","abgerufen wird die Toradresse von heute, auch fuer die Platzhalterform","zwei Bilder gehalten"], ersetze: [[BILDER, "  [\"renderJournalEntrySheet\", \"closeJournalEntrySheet\"],", "  [\"renderJournalSheet\", \"closeJournalSheet\"],"]] },
  { satz: "bilder", ziel: ["renderJournalEntrySheet hat seinen close-Haken derselben Klasse","kein Name steht zweimal","der close-Haken gibt beide frei"], ersetze: [[BILDER, "  [\"renderJournalEntrySheet\", \"closeJournalEntrySheet\"],", "  [\"renderJournalEntrySheet\", \"closeJournalEntryPageSheet\"],"]] },
  { satz: "bilder", ziel: ["renderActorSheetV2 hat seinen close-Haken derselben Klasse","renderItemSheet5e hat seinen close-Haken derselben Klasse","renderJournalEntryPageSheet hat seinen close-Haken derselben Klasse"], ersetze: [[BILDER, "  [\"renderJournalEntryPageSheet\", \"closeJournalEntryPageSheet\"],", "  [\"renderJournalEntryPageSheet\", \"closeJournalPageSheet\"],"], [BILDER, "  [\"renderActorSheetV2\", \"closeActorSheetV2\"],", "  [\"renderActorSheetV2\", \"closeActorSheet\"],"], [BILDER, "  [\"renderItemSheet5e\", \"closeItemSheet5e\"],", "  [\"renderItemSheet5e\", \"closeItemSheet\"],"]] },
  { satz: "bilder", ziel: ["genau zehn Haken","fuenf davon render, fuenf close","die fuenf render-Haken sind die gemessenen","der stumme Name renderItemSheet ist nicht angemeldet","renderApplicationV2 ist nicht angemeldet, es doppelte die anderen Zeilen","renderHandlebarsApplication ist nicht angemeldet, es doppelte die anderen Zeilen","renderDocumentSheet5e ist nicht angemeldet, es doppelte die anderen Zeilen"], ersetze: [[BILDER, "  [\"renderImagePopout\", \"closeImagePopout\"],", "  [\"renderImagePopout\", \"closeImagePopout\"],\n  [\"renderItemSheet\", \"closeItemSheet\"],\n  [\"renderApplicationV2\", \"closeApplicationV2\"],\n  [\"renderHandlebarsApplication\", \"closeHandlebarsApplication\"],\n  [\"renderDocumentSheet5e\", \"closeDocumentSheet5e\"],"]] },
  { satz: "bilder", ziel: ["die Naht ist da"], ersetze: [[BILDER, "export const flaechenRiegelFuerPruefsatz = flaechenRiegel", "const flaechenRiegelFuerPruefsatz = flaechenRiegel"]] },
  // Der Riegel.
  { satz: "bilder", ziel: ["genau zehn Haken","fuenf davon render, fuenf close","die fuenf render-Haken sind die gemessenen","renderImagePopout hat seinen close-Haken derselben Klasse","renderImagePopout faellt nicht unter den Riegel"], ersetze: [[BILDER, "const VERBOTEN = /Directory|Sidebar|FilePicker/i", "const VERBOTEN = /Directory|Sidebar|FilePicker|Popout/i"]] },
  { satz: "bilder", ziel: ["der Riegel weist renderItemDirectory5e ab","der Riegel weist renderActorDirectory ab","der Riegel prueft auch den close-Namen","Gross und klein sind fuer den Riegel gleich"], ersetze: [[BILDER, "const VERBOTEN = /Directory|Sidebar|FilePicker/i", "const VERBOTEN = /Sidebar|FilePicker/i"]] },
  { satz: "bilder", ziel: ["Gross und klein sind fuer den Riegel gleich"], ersetze: [[BILDER, "const VERBOTEN = /Directory|Sidebar|FilePicker/i", "const VERBOTEN = /Directory|Sidebar|FilePicker/"]] },
  { satz: "bilder", ziel: ["der Riegel weist renderSidebarTab ab"], ersetze: [[BILDER, "const VERBOTEN = /Directory|Sidebar|FilePicker/i", "const VERBOTEN = /Directory|FilePicker/i"]] },
  { satz: "bilder", ziel: ["der Riegel weist renderFilePicker ab"], ersetze: [[BILDER, "const VERBOTEN = /Directory|Sidebar|FilePicker/i", "const VERBOTEN = /Directory|Sidebar/i"]] },
  { satz: "bilder", ziel: ["genau zehn Haken","fuenf davon render, fuenf close","die fuenf render-Haken sind die gemessenen","renderActorSheetV2 hat seinen close-Haken derselben Klasse","renderItemSheet5e hat seinen close-Haken derselben Klasse","renderJournalEntryPageSheet hat seinen close-Haken derselben Klasse","renderJournalEntrySheet hat seinen close-Haken derselben Klasse","renderActorSheetV2 faellt nicht unter den Riegel","renderItemSheet5e faellt nicht unter den Riegel","renderJournalEntryPageSheet faellt nicht unter den Riegel","renderJournalEntrySheet faellt nicht unter den Riegel","die Toradresse wird eine Blob-Adresse","die Platzhalterform wird eine Blob-Adresse","abgerufen wird die Toradresse von heute, auch fuer die Platzhalterform","zwei Bilder gehalten"], ersetze: [[BILDER, "const VERBOTEN = /Directory|Sidebar|FilePicker/i", "const VERBOTEN = /Directory|Sidebar|FilePicker|Sheet/i"]] },
  { satz: "bilder", ziel: ["der Riegel prueft auch den close-Namen"], ersetze: [[BILDER, "  return VERBOTEN.test(renderHaken) || VERBOTEN.test(schliessHaken)", "  return VERBOTEN.test(renderHaken)"]] },
  { satz: "bilder", ziel: ["[Struktur] der Einbau fragt den Riegel je Paar, bevor er anmeldet"], ersetze: [[BILDER, "    if (flaechenRiegel(renderHaken, schliessHaken)) {", "    if (false) {"]] },
  // Was ein gefeuerter Haken tut.
  { satz: "bilder", ziel: ["die Toradresse wird eine Blob-Adresse","die Platzhalterform wird eine Blob-Adresse","abgerufen wird die Toradresse von heute, auch fuer die Platzhalterform","zwei Bilder gehalten"], ersetze: [[BILDER, "      beneosBildAusVorrat(wurzel, app).catch(", "      Promise.resolve().catch("]] },
  { satz: "bilder", ziel: ["der close-Haken gibt beide frei"], ersetze: [[BILDER, "    Hooks.on(schliessHaken, (app) => { allesLoslassen(app) })", "    Hooks.on(schliessHaken, (app) => { })"]] },
  { satz: "bilder", ziel: ["die Platzhalterform wird eine Blob-Adresse","abgerufen wird die Toradresse von heute, auch fuer die Platzhalterform","zwei Bilder gehalten"], ersetze: [[BILDER, "  if (istPlatzhalter(adresse)) return !!zerlegeAdresse(adresse)\n", "  if (istPlatzhalter(adresse)) return false\n"]] },
  { satz: "bilder", ziel: ["eine fremde Adresse bleibt, wie sie ist","abgerufen wird die Toradresse von heute, auch fuer die Platzhalterform","zwei Bilder gehalten"], ersetze: [[BILDER, "  return ours(adresse) && !!zerlegeAdresse(adresse)", "  return !!zerlegeAdresse(adresse)"]] },
  { satz: "bilder", ziel: ["die Platzhalterform wird eine Blob-Adresse","abgerufen wird die Toradresse von heute, auch fuer die Platzhalterform","zwei Bilder gehalten"], ersetze: [[BILDER, "    const abrufen = t ? assetUrl(t.release, t.variant, t.pfad, t.traeger) : adresse", "    const abrufen = adresse"]] },
  { satz: "bilder", ziel: ["bei ausgeschaltetem Stream bleibt die Toradresse","bei ausgeschaltetem Stream bleibt auch die Platzhalterform","und es wird nichts abgerufen"], ersetze: [[BILDER, "  if (!wurzel || !streamEnabled()) return leer", "  if (!wurzel) return leer"]] },
  { satz: "bilder", ziel: ["die Toradresse wird eine Blob-Adresse","die Platzhalterform wird eine Blob-Adresse","zwei Bilder gehalten"], ersetze: [[BILDER, "const BILDARTEN = /^image\\/(webp|png|jpe?g|gif|avif)$/i", "const BILDARTEN = /^image\\/(png|jpe?g)$/i"]] },
  { satz: "bilder", ziel: ["der close-Haken gibt beide frei"], ersetze: [[BILDER, "      try { URL.revokeObjectURL(eintrag.blob) } catch (_) { /* schon weg */ }\n    }\n    bildBlobs.delete(adresse)\n", "      try { URL.revokeObjectURL(eintrag.blob) } catch (_) { /* schon weg */ }\n    }\n"]] },
  // Der Kopf (Dokumentproben).
  { satz: "bilder", ziel: ["[Dokument] der Kopf behauptet nicht mehr, Klappkarten seien aussen vor","[Dokument] der Kopf nennt stattdessen, seit wann sie mitgehen"], ersetze: [[BILDER, " * **Klappkarten gehen seit dem 08.11.2026 mit", " * **Keine Klappkarten. Sie gehen seit dem 08.11.2026 mit"]] },
  { satz: "bilder", ziel: ["[Dokument] der Kopf nennt stattdessen, seit wann sie mitgehen"], ersetze: [[BILDER, " * **Klappkarten gehen seit dem 08.11.2026 mit", " * **Klappkarten gehen seit dem 09.11.2026 mit"]] },
  { satz: "bilder", ziel: ["[Dokument] der Kopf nennt die Grenze \"Kein `<video>`\" weiter"], ersetze: [[BILDER, " * **Kein `<video>`:**", " * **Kein Video:**"]] },
  { satz: "bilder", ziel: ["[Dokument] der Kopf nennt die Grenze \"Keine Listen\" weiter"], ersetze: [[BILDER, " * **Keine Listen**", " * **Listen nicht**"]] },
  { satz: "bilder", ziel: ["[Dokument] der Kopf nennt die Grenze \"Keine Bearbeitenflaeche\" weiter"], ersetze: [[BILDER, " * **Keine Bearbeitenflaeche**", " * **Kein Editor**"]] },
  // ersatzbild: der Abrufersatz in stream-fetch.mjs, die Dateien unter ui/, der Erzeuger.
  { satz: "ersatzbild", ziel: ["denied journal: es kommen die Bytes von beneos_stream_denied_journal.webp","offline journal: es kommen die Bytes von beneos_stream_offline_journal.webp","denied/journal: die Lage passt zur Rolle","offline/journal: die Lage passt zur Rolle","[Dokument] die Formentabelle des Erzeugers nennt fuer journal die gelieferten Masse"], luecke: true, ersetze: [[FETCH, '  if (/-journal\\.(webp|png|jpe?g)$/.test(pfad)) return "journal"', '  if (/-journal\\.(webp|png|jpe?g)$/.test(pfad)) return "card"']] },
  { satz: "ersatzbild", ziel: ["denied card: es kommen die Bytes von beneos_stream_denied_card.webp","offline card: es kommen die Bytes von beneos_stream_offline_card.webp","kreatur-back.webp bekommt die Form card","kreatur_card.jpg bekommt die Form card","offline: es sind die Bytes von beneos_stream_offline_card.webp","denied/card: die Lage passt zur Rolle","offline/card: die Lage passt zur Rolle","[Dokument] die Formentabelle des Erzeugers nennt fuer card die gelieferten Masse"], ersetze: [[FETCH, '  if (/[-_](front|back|card)\\.(webp|png|jpe?g)$/.test(pfad)) return "card"', '  if (/[-_](front|back|card)\\.(webp|png|jpe?g)$/.test(pfad)) return "journal"']] },
  { satz: "ersatzbild", ziel: ["kreatur-back.webp bekommt die Form card"], luecke: true, ersetze: [[FETCH, "(front|back|card)", "(front|card)"]] },
  { satz: "ersatzbild", ziel: ["kreatur_avatar.webp bekommt die Form token"], luecke: true, ersetze: [[FETCH, "(token|top|avatar|icon)", "(token|top|icon)"]] },
  { satz: "ersatzbild", ziel: ["kreatur-icon.jpeg bekommt die Form token"], luecke: true, ersetze: [[FETCH, '  if (/[-_](token|top|avatar|icon)\\.(webp|png|jpe?g)$/.test(pfad)) return "token"', '  if (/[-_](token|top|avatar|icon)\\.(webp|png)$/.test(pfad)) return "token"']] },
  { satz: "ersatzbild", ziel: ["KREATUR-TOKEN.WEBP bekommt die Form token"], luecke: true, ersetze: [[FETCH, '  const pfad = String(url).split("?")[0].toLowerCase()', '  const pfad = String(url).split("?")[0]']] },
  { satz: "ersatzbild", ziel: ["kreatur-token.webp?v=2 bekommt die Form token"], luecke: true, ersetze: [[FETCH, '  const pfad = String(url).split("?")[0].toLowerCase()', '  const pfad = String(url).toLowerCase()']] },
  { satz: "ersatzbild", ziel: ["karte.webp bekommt die Form journal"], luecke: true, ersetze: [[FETCH, '  return "journal"\n}\n\nfunction istBild', '  return "token"\n}\n\nfunction istBild']] },
  { satz: "ersatzbild", ziel: ["kreatur_card.jpg bekommt die Form card","kreatur-icon.jpeg bekommt die Form token"], luecke: true, ersetze: [[FETCH, "  return /\\.(webp|png|jpe?g)(\\?|$)/i.test(String(url))", "  return /\\.(webp|png)(\\?|$)/i.test(String(url))"]] },
  { satz: "ersatzbild", ziel: ["liegt die Datei wieder da, kommt sie beim naechsten Abruf an","denied journal: Inhaltstyp image/webp","denied journal: es kommen die Bytes von beneos_stream_denied_journal.webp","denied card: Inhaltstyp image/webp","denied card: es kommen die Bytes von beneos_stream_denied_card.webp","denied token: Inhaltstyp image/webp","denied token: es kommen die Bytes von beneos_stream_denied_token.webp","offline journal: Inhaltstyp image/webp","offline journal: es kommen die Bytes von beneos_stream_offline_journal.webp","offline card: Inhaltstyp image/webp","offline card: es kommen die Bytes von beneos_stream_offline_card.webp","offline token: Inhaltstyp image/webp","offline token: es kommen die Bytes von beneos_stream_offline_token.webp","der Ersatz liegt im Vorrat: ein zweites Journalbild holt die Datei nicht neu","kreatur-back.webp bekommt die Form card","kreatur_card.jpg bekommt die Form card","kreatur-top.png bekommt die Form token","kreatur_avatar.webp bekommt die Form token","kreatur-icon.jpeg bekommt die Form token","KREATUR-TOKEN.WEBP bekommt die Form token","kreatur-token.webp?v=2 bekommt die Form token","karte.webp bekommt die Form journal","offline: es sind die Bytes von beneos_stream_offline_card.webp","denied/journal: WebP in der Form VP8X oder VP8L","denied/journal: traegt einen Alphakanal","denied/journal: traegt ein Bild und nicht nur einen Kopf","denied/journal: die Lage passt zur Rolle","denied/card: WebP in der Form VP8X oder VP8L","denied/card: traegt einen Alphakanal","denied/card: traegt ein Bild und nicht nur einen Kopf","denied/card: die Lage passt zur Rolle","denied/token: WebP in der Form VP8X oder VP8L","denied/token: traegt einen Alphakanal","denied/token: traegt ein Bild und nicht nur einen Kopf","offline/journal: WebP in der Form VP8X oder VP8L","offline/journal: traegt einen Alphakanal","offline/journal: traegt ein Bild und nicht nur einen Kopf","offline/journal: die Lage passt zur Rolle","offline/card: WebP in der Form VP8X oder VP8L","offline/card: traegt einen Alphakanal","offline/card: traegt ein Bild und nicht nur einen Kopf","offline/card: die Lage passt zur Rolle","offline/token: WebP in der Form VP8X oder VP8L","offline/token: traegt einen Alphakanal","offline/token: traegt ein Bild und nicht nur einen Kopf","[Dokument] die Formentabelle des Erzeugers nennt fuer journal die gelieferten Masse","[Dokument] die Formentabelle des Erzeugers nennt fuer card die gelieferten Masse","[Dokument] die Formentabelle des Erzeugers nennt fuer token die gelieferten Masse"], ersetze: [[FETCH, "const ERSATZ_PFAD = `modules/${MODULE_ID}/ui/beneos_stream_`", "const ERSATZ_PFAD = `modules/${MODULE_ID}/ui/stream_`"]] },
  { satz: "ersatzbild", ziel: ["liegt die Datei wieder da, kommt sie beim naechsten Abruf an","denied journal: Inhaltstyp image/webp","denied journal: es kommen die Bytes von beneos_stream_denied_journal.webp","denied card: Inhaltstyp image/webp","denied card: es kommen die Bytes von beneos_stream_denied_card.webp","denied token: Inhaltstyp image/webp","denied token: es kommen die Bytes von beneos_stream_denied_token.webp","offline journal: Inhaltstyp image/webp","offline journal: es kommen die Bytes von beneos_stream_offline_journal.webp","offline card: Inhaltstyp image/webp","offline card: es kommen die Bytes von beneos_stream_offline_card.webp","offline token: Inhaltstyp image/webp","offline token: es kommen die Bytes von beneos_stream_offline_token.webp","der Ersatz liegt im Vorrat: ein zweites Journalbild holt die Datei nicht neu","kreatur-back.webp bekommt die Form card","kreatur_card.jpg bekommt die Form card","kreatur-top.png bekommt die Form token","kreatur_avatar.webp bekommt die Form token","kreatur-icon.jpeg bekommt die Form token","KREATUR-TOKEN.WEBP bekommt die Form token","kreatur-token.webp?v=2 bekommt die Form token","karte.webp bekommt die Form journal","offline: es sind die Bytes von beneos_stream_offline_card.webp","denied/journal: WebP in der Form VP8X oder VP8L","denied/journal: traegt einen Alphakanal","denied/journal: traegt ein Bild und nicht nur einen Kopf","denied/journal: die Lage passt zur Rolle","denied/card: WebP in der Form VP8X oder VP8L","denied/card: traegt einen Alphakanal","denied/card: traegt ein Bild und nicht nur einen Kopf","denied/card: die Lage passt zur Rolle","denied/token: WebP in der Form VP8X oder VP8L","denied/token: traegt einen Alphakanal","denied/token: traegt ein Bild und nicht nur einen Kopf","offline/journal: WebP in der Form VP8X oder VP8L","offline/journal: traegt einen Alphakanal","offline/journal: traegt ein Bild und nicht nur einen Kopf","offline/journal: die Lage passt zur Rolle","offline/card: WebP in der Form VP8X oder VP8L","offline/card: traegt einen Alphakanal","offline/card: traegt ein Bild und nicht nur einen Kopf","offline/card: die Lage passt zur Rolle","offline/token: WebP in der Form VP8X oder VP8L","offline/token: traegt einen Alphakanal","offline/token: traegt ein Bild und nicht nur einen Kopf","[Dokument] die Formentabelle des Erzeugers nennt fuer journal die gelieferten Masse","[Dokument] die Formentabelle des Erzeugers nennt fuer card die gelieferten Masse","[Dokument] die Formentabelle des Erzeugers nennt fuer token die gelieferten Masse"], luecke: true, ersetze: [[FETCH, "${ERSATZ_PFAD}${ursache}_${form}.webp", "${ERSATZ_PFAD}${form}_${ursache}.webp"]] },
  { satz: "ersatzbild", ziel: ["fehlt die Ersatzdatei, kommt ein GIF statt WebP","der Bildpunkt ist das GIF von 42 Byte","liegt die Datei wieder da, kommt sie beim naechsten Abruf an","denied token: es kommen die Bytes von beneos_stream_denied_token.webp","kreatur-top.png bekommt die Form token","kreatur_avatar.webp bekommt die Form token","kreatur-icon.jpeg bekommt die Form token","KREATUR-TOKEN.WEBP bekommt die Form token","kreatur-token.webp?v=2 bekommt die Form token","denied/token: WebP in der Form VP8X oder VP8L","denied/token: traegt einen Alphakanal","denied/token: traegt ein Bild und nicht nur einen Kopf","denied und offline token haben dieselben Masse","[Dokument] die Formentabelle des Erzeugers nennt fuer token die gelieferten Masse"], luecke: true, ersetze: [[FETCH, "    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)\n", "\n"]] },
  { satz: "ersatzbild", ziel: ["liegt die Datei wieder da, kommt sie beim naechsten Abruf an","denied token: Inhaltstyp image/webp","denied token: es kommen die Bytes von beneos_stream_denied_token.webp","kreatur-top.png bekommt die Form token","kreatur_avatar.webp bekommt die Form token","kreatur-icon.jpeg bekommt die Form token","KREATUR-TOKEN.WEBP bekommt die Form token","kreatur-token.webp?v=2 bekommt die Form token","denied/token: WebP in der Form VP8X oder VP8L","denied/token: traegt einen Alphakanal","denied/token: traegt ein Bild und nicht nur einen Kopf","denied und offline token haben dieselben Masse","[Dokument] die Formentabelle des Erzeugers nennt fuer token die gelieferten Masse"], luecke: true, ersetze: [[FETCH, "  liegt.catch(() => { ersatzVorrat.delete(schluessel) })", "  liegt.catch(() => {})"]] },
  { satz: "ersatzbild", ziel: ["der Ersatz liegt im Vorrat: ein zweites Journalbild holt die Datei nicht neu"], luecke: true, ersetze: [[FETCH, "  if (liegt) return liegt\n", "\n"]] },
  { satz: "ersatzbild", ziel: ["auch dann traegt die Antwort die Ursache","denied journal: Kopfzeile x-beneos-ersatz","denied card: Kopfzeile x-beneos-ersatz","denied token: Kopfzeile x-beneos-ersatz","offline journal: Kopfzeile x-beneos-ersatz","offline card: Kopfzeile x-beneos-ersatz","offline token: Kopfzeile x-beneos-ersatz","offline: ein Bild bekommt das Ersatzbild offline"], luecke: true, ersetze: [[FETCH, '    "x-beneos-ersatz": ursache,', '    "x-beneos-ersatz": "1",']] },
  { satz: "ersatzbild", ziel: ["denied journal: Kopfzeile x-beneos-denied","denied journal: keine Kopfzeile x-beneos-offline","denied card: Kopfzeile x-beneos-denied","denied card: keine Kopfzeile x-beneos-offline","denied token: Kopfzeile x-beneos-denied","denied token: keine Kopfzeile x-beneos-offline"], ersetze: [[FETCH, '    [ursache === "offline" ? "x-beneos-offline" : "x-beneos-denied"]: "1",', '    "x-beneos-offline": "1",']] },
  { satz: "ersatzbild", ziel: ["denied journal: Inhaltstyp image/webp","denied card: Inhaltstyp image/webp","denied token: Inhaltstyp image/webp","offline journal: Inhaltstyp image/webp","offline card: Inhaltstyp image/webp","offline token: Inhaltstyp image/webp"], ersetze: [[FETCH, '    "Content-Type": "image/webp",\n    "x-beneos-ersatz"', '    "Content-Type": "image/png",\n    "x-beneos-ersatz"']] },
  { satz: "ersatzbild", ziel: ["fehlt die Ersatzdatei, kommt ein GIF statt WebP"], luecke: true, ersetze: [[FETCH, '      headers: { ...kopf, "Content-Type": "image/gif" },', "      headers: kopf,"]] },
  { satz: "ersatzbild", ziel: ["auch dann HTTP 200, damit PIXI kein Gefahrensymbol malt"], luecke: true, ersetze: [[FETCH, '    return new Response(PIXEL, {\n      status: 200,\n      headers: { ...kopf', '    return new Response(PIXEL, {\n      status: 404,\n      headers: { ...kopf']] },
  { satz: "ersatzbild", ziel: ["offline journal: nichts geworfen","offline journal: Inhaltstyp image/webp","offline journal: Kopfzeile x-beneos-ersatz","offline journal: Kopfzeile x-beneos-offline","offline journal: keine Kopfzeile x-beneos-denied","offline journal: es kommen die Bytes von beneos_stream_offline_journal.webp","offline card: nichts geworfen","offline card: Inhaltstyp image/webp","offline card: Kopfzeile x-beneos-ersatz","offline card: Kopfzeile x-beneos-offline","offline card: keine Kopfzeile x-beneos-denied","offline card: es kommen die Bytes von beneos_stream_offline_card.webp","offline token: nichts geworfen","offline token: Inhaltstyp image/webp","offline token: Kopfzeile x-beneos-ersatz","offline token: Kopfzeile x-beneos-offline","offline token: keine Kopfzeile x-beneos-denied","offline token: es kommen die Bytes von beneos_stream_offline_token.webp","offline/journal: WebP in der Form VP8X oder VP8L","offline/journal: traegt einen Alphakanal","offline/journal: traegt ein Bild und nicht nur einen Kopf","offline/journal: die Lage passt zur Rolle","offline/card: WebP in der Form VP8X oder VP8L","offline/card: traegt einen Alphakanal","offline/card: traegt ein Bild und nicht nur einen Kopf","offline/card: die Lage passt zur Rolle","offline/token: WebP in der Form VP8X oder VP8L","offline/token: traegt einen Alphakanal","offline/token: traegt ein Bild und nicht nur einen Kopf","denied und offline journal haben dieselben Masse","denied und offline card haben dieselben Masse","denied und offline token haben dieselben Masse"], luecke: true, ersetze: [[FETCH, '          count("ersatz-netz")\n          return await ersatzAntwort(url, "offline")', '          count("ersatz-netz")\n          throw err']] },
  { satz: "ersatzbild", ziel: ["ein Netzfehler bei einer Steuerdatei wird geworfen"], luecke: true, ersetze: [[FETCH, '        if (!measuring && istBild(url)) {\n          count("ersatz-netz")', '        if (!measuring) {\n          count("ersatz-netz")']] },
  { satz: "ersatzbild", ziel: ["ein abgewiesenes Video bekommt kein Ersatzbild","ein abgewiesenes Video behaelt die Antwort des Tores"], luecke: true, ersetze: [[FETCH, "        if (istBild(url)) {\n          beenden(0)", "        if (true) {\n          beenden(0)"]] },
  { satz: "ersatzbild", ziel: ["auch dann traegt die Antwort die Ursache","liegt die Datei wieder da, kommt sie beim naechsten Abruf an","denied journal: Kopfzeile x-beneos-ersatz","denied journal: Kopfzeile x-beneos-denied","denied journal: keine Kopfzeile x-beneos-offline","denied journal: es kommen die Bytes von beneos_stream_denied_journal.webp","denied card: Kopfzeile x-beneos-ersatz","denied card: Kopfzeile x-beneos-denied","denied card: keine Kopfzeile x-beneos-offline","denied card: es kommen die Bytes von beneos_stream_denied_card.webp","denied token: Kopfzeile x-beneos-ersatz","denied token: Kopfzeile x-beneos-denied","denied token: keine Kopfzeile x-beneos-offline","denied token: es kommen die Bytes von beneos_stream_denied_token.webp","kreatur-back.webp bekommt die Form card","kreatur_card.jpg bekommt die Form card","kreatur-top.png bekommt die Form token","kreatur_avatar.webp bekommt die Form token","kreatur-icon.jpeg bekommt die Form token","KREATUR-TOKEN.WEBP bekommt die Form token","kreatur-token.webp?v=2 bekommt die Form token","karte.webp bekommt die Form journal"], luecke: true, ersetze: [[FETCH, '          return await ersatzAntwort(url, "denied")', '          return await ersatzAntwort(url, "offline")']] },
  { satz: "ersatzbild", ziel: ["fehlt die Ersatzdatei, kommt ein GIF statt WebP","auch dann traegt die Antwort die Ursache","der Bildpunkt ist das GIF von 42 Byte","liegt die Datei wieder da, kommt sie beim naechsten Abruf an","denied journal: Kopfzeile x-beneos-ersatz","denied journal: es kommen die Bytes von beneos_stream_denied_journal.webp","denied card: Kopfzeile x-beneos-ersatz","denied card: es kommen die Bytes von beneos_stream_denied_card.webp","denied token: Kopfzeile x-beneos-ersatz","denied token: es kommen die Bytes von beneos_stream_denied_token.webp","kreatur-back.webp bekommt die Form card","kreatur_card.jpg bekommt die Form card","kreatur-top.png bekommt die Form token","kreatur_avatar.webp bekommt die Form token","kreatur-icon.jpeg bekommt die Form token","KREATUR-TOKEN.WEBP bekommt die Form token","kreatur-token.webp?v=2 bekommt die Form token","karte.webp bekommt die Form journal","denied/journal: WebP in der Form VP8X oder VP8L","denied/journal: traegt einen Alphakanal","denied/journal: traegt ein Bild und nicht nur einen Kopf","denied/journal: die Lage passt zur Rolle","denied/card: WebP in der Form VP8X oder VP8L","denied/card: traegt einen Alphakanal","denied/card: traegt ein Bild und nicht nur einen Kopf","denied/card: die Lage passt zur Rolle","denied/token: WebP in der Form VP8X oder VP8L","denied/token: traegt einen Alphakanal","denied/token: traegt ein Bild und nicht nur einen Kopf","denied und offline journal haben dieselben Masse","denied und offline card haben dieselben Masse","denied und offline token haben dieselben Masse","[Dokument] die Formentabelle des Erzeugers nennt fuer journal die gelieferten Masse","[Dokument] die Formentabelle des Erzeugers nennt fuer card die gelieferten Masse","[Dokument] die Formentabelle des Erzeugers nennt fuer token die gelieferten Masse"], luecke: true, ersetze: [[FETCH, '      } else if (response.headers.get("x-beneos-denied")) {', '      } else if (response.headers.get("x-beneos-abgewiesen")) {']] },
  { satz: "ersatzbild", ziel: ["offline: ein Bild bekommt das Ersatzbild offline","offline: es sind die Bytes von beneos_stream_offline_card.webp"], luecke: true, ersetze: [[FETCH, '  if (istBild(url)) return await ersatzAntwort(url, "offline")\n', "\n"]] },
  { satz: "ersatzbild", ziel: ["offline: ein Bild bekommt das Ersatzbild offline","offline: es sind die Bytes von beneos_stream_offline_card.webp","offline: das Tor wird fuer das Bild nicht gefragt","offline: ein Video bekommt den Bildpunkt","offline: eine Steuerdatei bekommt HTTP 503 statt eines Bildes"], luecke: true, ersetze: [[FETCH, "      if (!measuring && isOffline()) return offlineAntwort(url)\n", "\n"]] },
  { satz: "ersatzbild", ziel: ["offline: eine Steuerdatei bekommt HTTP 503 statt eines Bildes"], luecke: true, ersetze: [[FETCH, "      status: 503,", "      status: 200,"]] },
  { satz: "ersatzbild", ziel: ["[Struktur] es liegen genau die erwarteten Dateien und keine weitere"], ersetze: [["ui/beneos_stream_denied_banner.webp", null, "RIFF"]] },
  { satz: "ersatzbild", ziel: ["[Dokument] die Formentabelle des Erzeugers nennt fuer token die gelieferten Masse"], ersetze: [[GEN, '    "token": (512, 512),', '    "token": (512, 513),']] },
  { satz: "ersatzbild", ziel: ["[Dokument] die Formentabelle des Erzeugers nennt fuer card die gelieferten Masse"], ersetze: [[GEN, '    "card": (512, 768),', '    "card": (768, 512),']] },
  { satz: "ersatzbild", ziel: ["[Dokument] die Formentabelle kennt genau drei Formen"], ersetze: [[GEN, '    "journal": (960, 540),', '    "journal": (960, 540),\n    "banner": (960, 200),']] },
  { satz: "ersatzbild", ziel: ["[Dokument] SCHEIBE traegt den Wert aus der Palette"], ersetze: [[GEN, "SCHEIBE = (0x0E, 0x0D, 0x0A, 220)", "SCHEIBE = (0x0C, 0x0C, 0x0A, 220)"]] },
  { satz: "ersatzbild", ziel: ["[Dokument] RAND traegt den Wert aus der Palette"], ersetze: [[GEN, "RAND = (0x46, 0x3B, 0x2C, 255)", "RAND = (0x46, 0x3B, 0x2D, 255)"]] },
  { satz: "ersatzbild", ziel: ["[Dokument] SYMBOL traegt den Wert aus der Palette"], ersetze: [[GEN, "SYMBOL = (0xA7, 0xA5, 0x96, 255)", "SYMBOL = (0xA7, 0xA5, 0x97, 255)"]] },
  { satz: "ersatzbild", ziel: ["[Dokument] der Kopf nennt die Farben mit ihrem Token aus der Bone-Palette"], ersetze: [[GEN, "    Scheibe  --color-bg-base ", "    Scheibe  --color-bg-main "]] },
  { satz: "ersatzbild", ziel: ["[Dokument] der Kopf nennt den Rand als --color-border-strong"], ersetze: [[GEN, "    Rand     --color-border-strong", "    Rand     --color-border-heavy"]] },
  { satz: "ersatzbild", ziel: ["[Dokument] der Kopf nennt das Symbol als Nebentext und keine Zustandsfarbe"], ersetze: [[GEN, "    Symbol   --color-text-secondary", "    Symbol   --color-text-muted"]] },
  { satz: "ersatzbild", ziel: ["[Dokument] der Kopf nennt den Vertrag der Dateinamen"], ersetze: [[GEN, "    ui/beneos_stream_<ursache>_<form>.webp", "    ui/beneos_stream_<form>.webp"]] },
  { satz: "ersatzbild", ziel: ["[Dokument] der Kopf nennt dass er eine Neuschrift und kein Fund ist"], ersetze: [[GEN, "eine NEUSCHRIFT nach", "eine Neufassung nach"]] },
  { satz: "ersatzbild", ziel: ["denied journal: HTTP 200","denied card: HTTP 200","denied token: HTTP 200"], luecke: true, ersetze: [[FETCH, "    return new Response(bytes, { status: 200, headers: kopf })", "    return new Response(bytes, { status: 203, headers: kopf })"]] },
  { satz: "ersatzbild", ziel: ["ohne Abweisung und ohne Fehler: keine Kopfzeile x-beneos-ersatz","ohne Abweisung und ohne Fehler: die Bytes des Tores"], luecke: true, ersetze: [[FETCH, '      } else if (response.headers.get("x-beneos-denied")) {', "      } else if (true) {"]] },
  { satz: "ersatzbild", ziel: ["offline: ein Video bekommt kein Ersatzbild","offline: ein Video bekommt den Bildpunkt"], luecke: true, ersetze: [[FETCH, '  if (istBild(url)) return await ersatzAntwort(url, "offline")', '  if (istMedium(url)) return await ersatzAntwort(url, "offline")']] },
  { satz: "ersatzbild", ziel: ["liegt die Datei wieder da, kommt sie beim naechsten Abruf an","denied token: es kommen die Bytes von beneos_stream_denied_token.webp","offline token: es kommen die Bytes von beneos_stream_offline_token.webp","kreatur-top.png bekommt die Form token","kreatur_avatar.webp bekommt die Form token","kreatur-icon.jpeg bekommt die Form token","KREATUR-TOKEN.WEBP bekommt die Form token","kreatur-token.webp?v=2 bekommt die Form token","denied/token: die Lage passt zur Rolle","offline/token: die Lage passt zur Rolle","[Dokument] die Formentabelle des Erzeugers nennt fuer token die gelieferten Masse"], ersetze: [[FETCH, '  if (/[-_](token|top|avatar|icon)\\.(webp|png|jpe?g)$/.test(pfad)) return "token"', '  if (/[-_](token|top|avatar|icon)\\.(webp|png|jpe?g)$/.test(pfad)) return "card"']] },
  // posen: stream-posen.mjs, die Rufstellen in beneos_utility.js und beneos_cloud.js, die Sprachen.
  { satz: "posen", ziel: ["eine leere Summe ebenso","und keiner der drei Faelle hat etwas abgerufen"], ersetze: [[POSEN, "  if (!src || !soll) return null", "  if (!src) return null"]] },
  { satz: "posen", ziel: ["drei Fragen, EIN Abruf","dieselbe Adresse mit Abfrage trifft denselben Eintrag","ein Misserfolg wird genauso gemerkt"], ersetze: [[POSEN, "    geprueft.set(schluessel, wert)\n", "\n"]] },
  { satz: "posen", ziel: ["dieselbe Adresse mit Abfrage trifft denselben Eintrag"], ersetze: [[POSEN, "  return `${ohneAbfrage(src)}|${soll}`", "  return `${src}|${soll}`"]] },
  { satz: "posen", ziel: ["andere Soll-Summe ist eine neue Frage"], ersetze: [[POSEN, "  return `${ohneAbfrage(src)}|${soll}`", "  return `${ohneAbfrage(src)}`"]] },
  { satz: "posen", ziel: ["sie nennt den Grund crypto.subtle"], ersetze: [[POSEN, "      if (typeof crypto === \"undefined\" || !crypto?.subtle?.digest) {", "      if (false) {"]] },
  { satz: "posen", ziel: ["sie nennt den Grund crypto.subtle"], ersetze: [[POSEN, "        meldeNichtPruefbar(\"crypto.subtle fehlt\")", "        meldeNichtPruefbar(\"kein Kontext\")"]] },
  { satz: "posen", ziel: ["drei nicht pruefbare Ansichten melden sich EINMAL"], ersetze: [[POSEN, "  if (nichtPruefbarGemeldet) return\n", "\n"]] },
  { satz: "posen", ziel: ["ohne sicheren Kontext kommt genau eine Meldung","sie nennt den Grund crypto.subtle","sie nennt HTTPS als haeufigste Ursache","sie sagt, dass die Bilder trotzdem laden","drei nicht pruefbare Ansichten melden sich EINMAL","und die Meldung sagt, dass sie nicht wiederkommt"], ersetze: [[POSEN, "  geprueft.clear()\n  nichtPruefbarGemeldet = false", "  geprueft.clear()"]] },
  { satz: "posen", ziel: ["eine Abweisung am Tor gibt null, nicht false"], ersetze: [[POSEN, "        if (!antwort.ok || antwort.headers.get(\"x-beneos-denied\")\n", "        if (!antwort.ok\n"]] },
  { satz: "posen", ziel: ["eine Offline-Antwort gibt null, nicht false"], ersetze: [[POSEN, "            || antwort.headers.get(\"x-beneos-offline\")) {\n          // Kein Recht", ") {\n          // Kein Recht"]] },
  { satz: "posen", ziel: ["anderer Inhalt gibt false","falscher Inhalt meldet sich genau einmal","die Meldung nennt die Datei","sie nennt die Soll-Summe","sie sagt, dass nichts geschrieben wird","falscher Inhalt: KEINE Adresse","Pruefung false","und der Zustand faellt mit","falsche Summe: nichts wird geschrieben","falsche Summe: die Warnung ist der Inhaltstext und nicht der Fehlt-Text","falsche Summe: geschrieben wird 2.5D und nicht die falsche Draufsicht","falsche Summe: mit dem Inhaltstext","falsche Summe: die Figur kommt als 2.5D ohne Draufsichtadresse"], ersetze: [[POSEN, "          wert = ist === soll", "          wert = true"]] },
  { satz: "posen", ziel: ["gleicher Inhalt gibt true","anderer Inhalt gibt false","nach dem Zuruecksetzen prueft es wieder","nach der Ausnahme prueft es wieder","falscher Inhalt meldet sich genau einmal","die Meldung nennt die Datei","sie nennt die Soll-Summe","sie sagt, dass nichts geschrieben wird","ein richtiger Inhalt meldet nichts","nach pruefungenVergessen meldet es wieder","gutes Bild: Adresse kommt heraus","und die Pruefung sagt true","und der Zustand bleibt true","falscher Inhalt: KEINE Adresse","Pruefung false","und der Zustand faellt mit","gute Summe: das Token bekommt die Draufsicht","gute Summe: keine Warnung","falsche Summe: nichts wird geschrieben","falsche Summe: die Warnung ist der Inhaltstext und nicht der Fehlt-Text","gute Summe: die Draufsicht der Variante wird geschrieben","falsche Summe: geschrieben wird 2.5D und nicht die falsche Draufsicht","falsche Summe: mit dem Inhaltstext","gute Summe: die Figur kommt als Draufsicht","falsche Summe: die Figur kommt als 2.5D ohne Draufsichtadresse"], ersetze: [[POSEN, "          wert = ist === soll", "          wert = ist !== soll"]] },
  { satz: "posen", ziel: ["falscher Inhalt meldet sich genau einmal","die Meldung nennt die Datei","sie nennt die Soll-Summe","sie sagt, dass nichts geschrieben wird"], ersetze: [[POSEN, "          if (wert === false) {\n            console.warn(", "          if (false) {\n            console.warn("]] },
  { satz: "posen", ziel: ["sie sagt, dass nichts geschrieben wird"], ersetze: [[POSEN, "Sie wird NICHT geschrieben. ", "Sie wird geschrieben. "]] },
  { satz: "posen", ziel: ["sie nennt die Soll-Summe"], ersetze: [[POSEN, "${soll.slice(0, 12)}..., ", "${ist.slice(0, 12)}..., "]] },
  { satz: "posen", ziel: ["die Meldung nennt die Datei"], ersetze: [[POSEN, "${ohneAbfrage(src).split(\"/\").pop()}: Soll", "datei: Soll"]] },
  { satz: "posen", ziel: ["eine Ausnahme beim Rechnen gibt null, nicht true"], ersetze: [[POSEN, "      wert = null\n    }\n    geprueft.set", "      wert = true\n    }\n    geprueft.set"]] },
  { satz: "posen", ziel: ["sie nennt HTTPS als haeufigste Ursache"], ersetze: [[POSEN, "Haeufigste Ursache ist ein Foundry ohne HTTPS im ", "Haeufigste Ursache ist ein Foundry ohne Zertifikat im "]] },
  { satz: "posen", ziel: ["sie sagt, dass die Bilder trotzdem laden"], ersetze: [[POSEN, "Die Bilder laden wie bisher, aber ", "Die Bilder laden nicht, und "]] },
  { satz: "posen", ziel: ["und die Meldung sagt, dass sie nicht wiederkommt"], ersetze: [[POSEN, "Weitere Ansichten werden nicht mehr einzeln gemeldet.", "Weitere folgen."]] },
  { satz: "posen", ziel: ["und der Zustand faellt mit"], ersetze: [[POSEN, "  if (ok === false) return { zustand: false, src: null, pruefung: false }", "  if (ok === false) return { zustand: a.zustand, src: null, pruefung: false }"]] },
  { satz: "posen", ziel: ["falscher Inhalt: KEINE Adresse","falsche Summe: geschrieben wird 2.5D und nicht die falsche Draufsicht","falsche Summe: die Figur kommt als 2.5D ohne Draufsichtadresse"], ersetze: [[POSEN, "  if (ok === false) return { zustand: false, src: null, pruefung: false }", "  if (ok === false) return { zustand: false, src: a.src, pruefung: false }"]] },
  { satz: "posen", ziel: ["Pruefung false","falsche Summe: die Warnung ist der Inhaltstext und nicht der Fehlt-Text","falsche Summe: mit dem Inhaltstext"], ersetze: [[POSEN, "  if (ok === false) return { zustand: false, src: null, pruefung: false }", "  if (ok === false) return { zustand: false, src: null, pruefung: null }"]] },
  { satz: "posen", ziel: ["null in der Liste: gibt es nicht","Ansicht gibt es nicht: nichts wird geschrieben","Ansicht gibt es nicht: die Warnung ist der Fehlt-Text"], ersetze: [[POSEN, "    if (!eintrag || !eintrag.pfad) return { zustand: false, src: null, sha256: null }", "    if (!eintrag || !eintrag.pfad) return { zustand: null, src: null, sha256: null }"]] },
  { satz: "posen", ziel: ["eine Liste ohne tokenbilder: nicht geprueft statt gibt es nicht","ohne Liste am Tor: der Textersatz wird geschrieben","ohne Liste am Tor: keine Fehlt-Warnung"], luecke: true, ersetze: [[POSEN, "    if (!liste) return offen\n", "    if (!liste) return { zustand: false, src: null, sha256: null }\n"]] },
  { satz: "posen", ziel: ["oertlich gibt es keine Soll-Summe"], ersetze: [[POSEN, "  return { zustand: liegt, src: liegt ? kandidat : null, sha256: null }", "  return { zustand: liegt, src: liegt ? kandidat : null, sha256: \"0\".repeat(64) }"]] },
  { satz: "posen", ziel: ["Soll-Summe \"AAAAAAAAAAA (Laenge 64): es wird nichts geprueft und nichts gemeldet","Soll-Summe \"AAAAAAAAAAA (Laenge 64) faellt auf nicht pruefbar","Soll-Summe \"AAAAAAAAAAA (Laenge 64): die Adresse kommt trotzdem"], ersetze: [[POSEN, "/^[a-f0-9]{64}$/.test(eintrag.sha256)", "/^[a-fA-F0-9]{64}$/.test(eintrag.sha256)", 3, 3]] },
  { satz: "posen", ziel: ["Soll-Summe \"aaaaaaaaaaa (Laenge 63): es wird nichts geprueft und nichts gemeldet","Soll-Summe \"aaaaaaaaaaa (Laenge 63) faellt auf nicht pruefbar","Soll-Summe \"aaaaaaaaaaa (Laenge 63): die Adresse kommt trotzdem","Soll-Summe \"aaaaaaaaaaa (Laenge 65): es wird nichts geprueft und nichts gemeldet","Soll-Summe \"aaaaaaaaaaa (Laenge 65) faellt auf nicht pruefbar","Soll-Summe \"aaaaaaaaaaa (Laenge 65): die Adresse kommt trotzdem"], ersetze: [[POSEN, "/^[a-f0-9]{64}$/.test(eintrag.sha256)", "/^[a-f0-9]{63,65}$/.test(eintrag.sha256)", 3, 3]] },
  { satz: "posen", ziel: ["Soll-Summe 42 (Laenge 2): es wird nichts geprueft und nichts gemeldet"], luecke: true, ersetze: [[POSEN, "typeof eintrag.sha256 === \"string\" && /^[a-f0-9]{64}$/.test(eintrag.sha256)", "/^[a-f0-9]{64}$/.test(String(eintrag.sha256).repeat(1)) || eintrag.sha256 === 42", 3, 3]] },
  { satz: "posen", ziel: ["eine Liste ohne tokenbilder: nicht geprueft statt gibt es nicht"], luecke: true, ersetze: [[POSEN, "        if (gelesen && typeof gelesen === \"object\" && gelesen.tokenbilder) wert = gelesen", "        if (gelesen) wert = { tokenbilder: {}, ...gelesen }"]] },
  { satz: "posen", ziel: ["Journal: ein Feld, das kein Objekt ist: nicht geprueft"], ersetze: [[POSEN, "  if (!satz || typeof satz !== \"object\") return offen", "  if (!satz) return offen", 2, 1]] },
  { satz: "posen", ziel: ["Journal: eine Liste ohne das Feld: nicht geprueft, denn der Serverstand ist aelter als das Feld","Journal: ein Feld, das kein Objekt ist: nicht geprueft"], ersetze: [[POSEN, "  if (!satz || typeof satz !== \"object\") return offen", "  if (!satz || typeof satz !== \"object\") return { zustand: false, pfad: null, sha256: null }", 2, 1]] },
  { satz: "posen", ziel: ["Journal: ein Eintrag ohne Pfad gilt nicht","Journal: ein leerer Pfad gilt auch nicht"], ersetze: [[POSEN, "  if (!eintrag || typeof eintrag !== \"object\" || !eintrag.pfad) {", "  if (!eintrag || typeof eintrag !== \"object\") {", 2, 1]] },
  { satz: "posen", ziel: ["Journal: und gibt den Namen AUS DER LISTE","Journal: und der Pfad bleibt"], ersetze: [[POSEN, "    pfad: String(eintrag.pfad),", "    pfad: String(eintrag.pfad).toUpperCase(),", 2, 1]] },
  { satz: "posen", ziel: ["Journal: und ihre Pruefsumme ist null, nicht undefined","Journal: und die Pruefsumme wird null"], ersetze: [[POSEN, "/^[a-f0-9]{64}$/.test(eintrag.sha256)\n      ? eintrag.sha256 : null,", "/^[a-f0-9]{64}$/.test(eintrag.sha256)\n      ? eintrag.sha256 : undefined,", 2, 1]] },
  { satz: "posen", ziel: ["Journal: und die Pruefsumme wird null"], ersetze: [[POSEN, "/^[a-f0-9]{64}$/.test(eintrag.sha256)\n      ? eintrag.sha256 : null,", "/^[a-z0-9]+$/.test(eintrag.sha256)\n      ? eintrag.sha256 : null,", 2, 1]] },
  { satz: "posen", ziel: ["Journal: keine Liste: nicht geprueft","Journal: die drei Antworten sind drei verschiedene"], ersetze: [[POSEN, "  if (!liste || typeof liste !== \"object\") return offen", "  if (!liste) return { zustand: false, pfad: null, sha256: null }", 2, 1]] },
  { satz: "posen", ziel: ["Waise: ein Feld, das kein Objekt ist: nicht geprueft"], ersetze: [[POSEN, "  if (!satz || typeof satz !== \"object\") return offen", "  if (!satz) return offen", 2, 2]] },
  { satz: "posen", ziel: ["Waise: eine Liste ohne das Feld: nicht geprueft","Waise: ein Feld, das kein Objekt ist: nicht geprueft"], ersetze: [[POSEN, "  if (!satz || typeof satz !== \"object\") return offen", "  if (!satz || typeof satz !== \"object\") return { zustand: false, pfad: null, sha256: null }", 2, 2]] },
  { satz: "posen", ziel: ["Waise: ein Eintrag ohne Pfad gilt nicht","Waise: ein leerer Pfad im Eintrag gilt auch nicht"], ersetze: [[POSEN, "  if (!eintrag || typeof eintrag !== \"object\" || !eintrag.pfad) {", "  if (!eintrag || typeof eintrag !== \"object\") {", 2, 2]] },
  { satz: "posen", ziel: ["Waise: und gibt den Namen AUS DER LISTE","Waise: und der Aufrufer bekommt den Namen der LISTE, nicht seinen eigenen","Waise: und der Pfad bleibt"], ersetze: [[POSEN, "    pfad: String(eintrag.pfad),", "    pfad: String(eintrag.pfad).toUpperCase(),", 2, 2]] },
  { satz: "posen", ziel: ["Waise: und ihre Pruefsumme ist null, nicht undefined","Waise: und die Pruefsumme wird null","Waise: eine zu kurze Summe aus reinen Hexzeichen gilt nicht"], ersetze: [[POSEN, "/^[a-f0-9]{64}$/.test(eintrag.sha256)\n      ? eintrag.sha256 : null,", "/^[a-f0-9]{64}$/.test(eintrag.sha256)\n      ? eintrag.sha256 : undefined,", 2, 2]] },
  { satz: "posen", ziel: ["Waise: und die Pruefsumme wird null","Waise: eine zu kurze Summe aus reinen Hexzeichen gilt nicht"], ersetze: [[POSEN, "/^[a-f0-9]{64}$/.test(eintrag.sha256)\n      ? eintrag.sha256 : null,", "/^[a-z0-9]+$/.test(eintrag.sha256)\n      ? eintrag.sha256 : null,", 2, 2]] },
  { satz: "posen", ziel: ["ohne Liste am Tor: nichts wird vorgelegt","und wird nicht als fehlend vorgelegt","Waise: keine Liste: nicht geprueft","Waise: die drei Antworten sind drei verschiedene"], ersetze: [[POSEN, "  if (!liste || typeof liste !== \"object\") return offen", "  if (!liste) return { zustand: false, pfad: null, sha256: null }", 2, 2]] },
  { satz: "posen", ziel: ["Waise: dieselbe Variante als Draufsicht steht als null drin, also false"], ersetze: [[POSEN, "  const eintrag = satz[wer.variante]?.[wer.stil]", "  const eintrag = satz[wer.variante]?.tokenized"]] },
  { satz: "posen", ziel: ["Waise: ein Pfad ohne Variantennummer: nicht geprueft","Waise: ein leerer Pfad: nicht geprueft","Waise: eine KARTENadresse: nicht geprueft, denn sie ist keine Kreatur"], ersetze: [[POSEN, "  if (!wer) return offen\n  const eintrag", "  if (!wer) return { zustand: false, pfad: null, sha256: null }\n  const eintrag"]] },
  { satz: "posen", ziel: ["Waise: eine KARTENadresse: nicht geprueft, denn sie ist keine Kreatur"], ersetze: [[POSEN, "  if (tor && tor.raum !== \"kreatur\") return null\n", "\n"]] },
  { satz: "posen", ziel: ["falsche Summe: nichts wird geschrieben","falsche Summe: die Warnung ist der Inhaltstext und nicht der Fehlt-Text","falsche Summe: geschrieben wird 2.5D und nicht die falsche Draufsicht","falsche Summe: mit dem Inhaltstext"], luecke: true, ersetze: [[UTIL, "import { ansichtGeprueft, ansichtGibtEs } from \"./stream/stream-posen.mjs\";", "import { ansicht as ansichtGeprueft, ansichtGibtEs } from \"./stream/stream-posen.mjs\";"]] },
  { satz: "posen", ziel: ["falsche Summe: die Warnung ist der Inhaltstext und nicht der Fehlt-Text"], luecke: true, ersetze: [[UTIL, "        || \"Beneos: that view did not match its checksum and was not applied\")\n      return\n    }", "        || \"Beneos: that view did not match its checksum and was not applied\")\n    }"]] },
  { satz: "posen", ziel: ["falsche Summe: die Warnung ist der Inhaltstext und nicht der Fehlt-Text"], ersetze: [[UTIL, "    if (auskunft.pruefung === false) {\n      ui.notifications?.warn(game.i18n.localize(\"BENEOS.TokenMenu.ViewContentMismatch\")", "    if (false) {\n      ui.notifications?.warn(game.i18n.localize(\"BENEOS.TokenMenu.ViewContentMismatch\")"]] },
  { satz: "posen", ziel: ["Ansicht gibt es nicht: nichts wird geschrieben","Ansicht gibt es nicht: die Warnung ist der Fehlt-Text"], luecke: true, ersetze: [[UTIL, "    if (!newSrc && auskunft.zustand === false) {\n      ui.notifications?.warn(game.i18n.localize(\"BENEOS.TokenMenu.TopDownAssetMissing\")", "    if (!newSrc && auskunft.zustand === \"nie\") {\n      ui.notifications?.warn(game.i18n.localize(\"BENEOS.TokenMenu.TopDownAssetMissing\")"]] },
  { satz: "posen", ziel: ["falsche Summe: mit dem Inhaltstext"], ersetze: [[UTIL, "        if (auskunft.pruefung === false) {\n          ui.notifications?.warn(game.i18n.localize(\"BENEOS.TokenMenu.ViewContentMismatch\")", "        if (false) {\n          ui.notifications?.warn(game.i18n.localize(\"BENEOS.TokenMenu.ViewContentMismatch\")"]] },
  { satz: "posen", ziel: ["falsche Summe: geschrieben wird 2.5D und nicht die falsche Draufsicht"], luecke: true, ersetze: [[UTIL, "      newImage = ziel || tokenData.token", "      newImage = ziel || currentSrc"]] },
  { satz: "posen", ziel: ["[Struktur] beneos_utility.js ruft die ungepruefte Form nicht"], ersetze: [[UTIL, "    const auskunft = await ansichtGeprueft(currentSrc, newStyle)", "    const auskunft = await ansichtGeprueft(currentSrc, newStyle) ?? ansicht(currentSrc)"]] },
  { satz: "posen", ziel: ["falsche Summe: die Figur kommt als 2.5D ohne Draufsichtadresse"], luecke: true, ersetze: [[CLOUD, "import {\n  ansichtGeprueft,\n", "import {\n  ansicht as ansichtGeprueft,\n"]] },
  { satz: "posen", ziel: ["falsche Summe: die Figur kommt als 2.5D ohne Draufsichtadresse"], luecke: true, ersetze: [[CLOUD, "        topSrc = auskunft.src\n", "        topSrc = auskunft.src || protoSrc.replace(\"-token.webp\", \"-top.webp\")\n"]] },
  { satz: "posen", ziel: ["falsche Summe: die Figur kommt als 2.5D ohne Draufsichtadresse"], luecke: true, ersetze: [[CLOUD, "          effectiveStyle = \"tokenized\"\n        }", "        }"]] },
  { satz: "posen", ziel: ["[Struktur] beneos_cloud.js ruft die ungepruefte Form nicht"], ersetze: [[CLOUD, "          auskunft = await ansichtGeprueft(protoSrc, \"topdown\")", "          auskunft = await ansichtGeprueft(protoSrc, \"topdown\") ?? ansicht(protoSrc)"]] },
  { satz: "posen", ziel: ["ohne Liste am Tor: nichts wird vorgelegt","und wird nicht als fehlend vorgelegt"], ersetze: [[CLOUD, "        if (tokenbildImSpiegel(liste, protoSrc).zustand === false) {", "        if (tokenbildImSpiegel(liste, protoSrc).zustand !== true) {"]] },
  { satz: "posen", ziel: ["die Liste nennt die Variante nicht: als fehlend vorgelegt"], ersetze: [[CLOUD, "        if (tokenbildImSpiegel(liste, protoSrc).zustand === false) {", "        if (false) {"]] },
  { satz: "posen", ziel: ["eine Kartenadresse fragt keine Posenliste"], ersetze: [[CLOUD, "        const liste = tor?.raum === \"kreatur\" ? await posenliste(tor.release) : null", "        const liste = await posenliste(tor.release)"], [POSEN, "  if (!schluessel.startsWith(KREATUR_PRAEFIX)) return null\n  const da", "  const da"]] },
  { satz: "posen", ziel: ["[Struktur] die Pruefung haengt NICHT in der allgemeinen Abrufschicht"], ersetze: [[FETCH, "const ERSATZ_PFAD = ", "const ansichtInhaltOk = null\nconst ERSATZ_PFAD = "]] },
  { satz: "posen", ziel: ["[Struktur] der Kommentarfilter laesst Code stehen"], ersetze: [[POSEN, "export async function ansichtGeprueft(", "export async function  ansichtGeprueft("]] },
  { satz: "posen", ziel: ["[Struktur] der Kommentarfilter nimmt Kommentare weg"], ersetze: [[POSEN, "const FRIST_LISTE_MS = 5 * 60 * 1000\n", "const FRIST_LISTE_MS = 5 * 60 * 1000\nconst HINWEIS = \"zweite Wahrheit\"\n"]] },
  { satz: "posen", ziel: ["der Textbaustein steht in en.json"], ersetze: [["lang/en.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["de traegt den Textbaustein"], ersetze: [["lang/de.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["fr traegt den Textbaustein"], ersetze: [["lang/fr.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["es traegt den Textbaustein"], ersetze: [["lang/es.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["it traegt den Textbaustein"], ersetze: [["lang/it.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["pt-BR traegt den Textbaustein"], ersetze: [["lang/pt-BR.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["pt-PT traegt den Textbaustein"], ersetze: [["lang/pt-PT.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["pl traegt den Textbaustein"], ersetze: [["lang/pl.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["cs traegt den Textbaustein"], ersetze: [["lang/cs.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["ca traegt den Textbaustein"], ersetze: [["lang/ca.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["ja traegt den Textbaustein"], ersetze: [["lang/ja.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["ko traegt den Textbaustein"], ersetze: [["lang/ko.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["zh-TW traegt den Textbaustein"], ersetze: [["lang/zh-TW.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["ru traegt den Textbaustein"], ersetze: [["lang/ru.json", "\"BENEOS.TokenMenu.ViewContentMismatch\":", "\"BENEOS.TokenMenu.ViewContentMismatchAlt\":"]] },
  { satz: "posen", ziel: ["und er sagt etwas anderes als der Fehlt-Text"], ersetze: [["lang/en.json", "\"BENEOS.TokenMenu.ViewContentMismatch\": \"", "\"BENEOS.TokenMenu.ViewContentMismatch\": \"Top-Down asset missing, click or drag to refetch from cloud.\", \"BENEOS.Alt\": \""]] },
  { satz: "posen", ziel: ["ohne crypto.subtle gibt es null, nicht false","auch ein subtle ohne digest gibt null","alle drei gaben null zurueck"], ersetze: [[POSEN, "        meldeNichtPruefbar(\"crypto.subtle fehlt\")\n", "        meldeNichtPruefbar(\"crypto.subtle fehlt\")\n        wert = false\n"]] },
  { satz: "posen", ziel: ["eine Datei, die nicht kommt, gibt null","eine Abweisung am Tor gibt null, nicht false","eine Offline-Antwort gibt null, nicht false"], ersetze: [[POSEN, "          meldeNichtPruefbar(\"die Datei kam nicht\")\n", "          meldeNichtPruefbar(\"die Datei kam nicht\")\n          wert = false\n"]] },
  { satz: "posen", ziel: ["eine leere Summe ebenso","und keiner der drei Faelle hat etwas abgerufen"], ersetze: [[POSEN, "  if (!src || !soll) return null", "  if (!src && !soll) return null"]] },
  { satz: "posen", ziel: ["ohne Summe in der Liste: Adresse kommt","Pruefung null","Zustand bleibt true","Soll-Summe \"ja\" (Laenge 2) faellt auf nicht pruefbar","Soll-Summe \"ja\" (Laenge 2): die Adresse kommt trotzdem","Soll-Summe \"AAAAAAAAAAA (Laenge 64) faellt auf nicht pruefbar","Soll-Summe \"AAAAAAAAAAA (Laenge 64): die Adresse kommt trotzdem","Soll-Summe \"aaaaaaaaaaa (Laenge 63) faellt auf nicht pruefbar","Soll-Summe \"aaaaaaaaaaa (Laenge 63): die Adresse kommt trotzdem","Soll-Summe \"aaaaaaaaaaa (Laenge 65) faellt auf nicht pruefbar","Soll-Summe \"aaaaaaaaaaa (Laenge 65): die Adresse kommt trotzdem","Soll-Summe 42 (Laenge 2) faellt auf nicht pruefbar","Soll-Summe 42 (Laenge 2): die Adresse kommt trotzdem","und das ist KEIN Pruefsummenfall","eine Liste ohne tokenbilder: nicht geprueft statt gibt es nicht","Ansicht gibt es nicht: die Warnung ist der Fehlt-Text","ohne Summe in der Liste: die Draufsicht wird geschrieben","ohne Liste am Tor: der Textersatz wird geschrieben","ohne Liste am Tor: keine Fehlt-Warnung"], ersetze: [[POSEN, "  if (!a.src || !a.sha256) return { zustand: a.zustand, src: a.src, pruefung: null }", "  if (!a.src || !a.sha256) return { zustand: false, src: null, pruefung: false }"]] },
  { satz: "posen", ziel: ["und das ist KEIN Pruefsummenfall","Ansicht gibt es nicht: die Warnung ist der Fehlt-Text"], ersetze: [[POSEN, "  if (!a.src || !a.sha256) return { zustand: a.zustand, src: a.src, pruefung: null }", "  if (!a.src || !a.sha256) return { zustand: a.zustand, src: a.src, pruefung: a.zustand === false ? false : null }"]] },
  { satz: "posen", ziel: ["Soll-Summe \"ja\" (Laenge 2): es wird nichts geprueft und nichts gemeldet","Soll-Summe \"ja\" (Laenge 2) faellt auf nicht pruefbar","Soll-Summe \"ja\" (Laenge 2): die Adresse kommt trotzdem","Soll-Summe \"AAAAAAAAAAA (Laenge 64): es wird nichts geprueft und nichts gemeldet","Soll-Summe \"AAAAAAAAAAA (Laenge 64) faellt auf nicht pruefbar","Soll-Summe \"AAAAAAAAAAA (Laenge 64): die Adresse kommt trotzdem","Soll-Summe \"aaaaaaaaaaa (Laenge 63): es wird nichts geprueft und nichts gemeldet","Soll-Summe \"aaaaaaaaaaa (Laenge 63) faellt auf nicht pruefbar","Soll-Summe \"aaaaaaaaaaa (Laenge 63): die Adresse kommt trotzdem","Soll-Summe \"aaaaaaaaaaa (Laenge 65): es wird nichts geprueft und nichts gemeldet","Soll-Summe \"aaaaaaaaaaa (Laenge 65) faellt auf nicht pruefbar","Soll-Summe \"aaaaaaaaaaa (Laenge 65): die Adresse kommt trotzdem","Soll-Summe 42 (Laenge 2): es wird nichts geprueft und nichts gemeldet"], ersetze: [[POSEN, "        ? eintrag.sha256 : null,", "        ? eintrag.sha256 : (eintrag.sha256 ?? null),"]] },
  { satz: "posen", ziel: ["und die Pruefung sagt true","falscher Inhalt: KEINE Adresse","Pruefung false","und der Zustand faellt mit","sha256 steht im Ergebnis","falsche Summe: nichts wird geschrieben","falsche Summe: die Warnung ist der Inhaltstext und nicht der Fehlt-Text","falsche Summe: geschrieben wird 2.5D und nicht die falsche Draufsicht","falsche Summe: mit dem Inhaltstext","falsche Summe: die Figur kommt als 2.5D ohne Draufsichtadresse"], ersetze: [[POSEN, "        ? eintrag.sha256 : null,", "        ? null : null,"]] },
  { satz: "posen", ziel: ["keine Adresse","Ansicht gibt es nicht: nichts wird geschrieben","Ansicht gibt es nicht: die Warnung ist der Fehlt-Text"], ersetze: [[POSEN, "    if (!eintrag || !eintrag.pfad) return { zustand: false, src: null, sha256: null }", "    if (!eintrag || !eintrag.pfad) return { zustand: false, src: assetUrl(wer.release, \"\", \"x.webp\"), sha256: null }"]] },
  { satz: "posen", ziel: ["die Liste nennt die Variante: nichts wird vorgelegt"], ersetze: [[CLOUD, "        if (tokenbildImSpiegel(liste, protoSrc).zustand === false) {", "        if (tokenbildImSpiegel(liste, protoSrc).zustand !== null) {"]] },
  { satz: "posen", ziel: ["Journal: die Liste nennt Variante 1","Journal: Variante 2 ohne Pruefsumme ist trotzdem da","Journal: die Nummer wird als Text gesucht, 1 und \"1\" sind dasselbe","Journal: eine kaputte Pruefsumme laesst den Eintrag gueltig","Journal: die drei Antworten sind drei verschiedene"], ersetze: [[POSEN, "    zustand: true,", "    zustand: \"ja\",", 3, 1]] },
  { satz: "posen", ziel: ["Journal: Variante 3 steht nicht drin, also false","Journal: ein leeres Feld ist eine Aussage, naemlich false","Journal: ein Eintrag ohne Pfad gilt nicht","Journal: ein leerer Pfad gilt auch nicht","Journal: die drei Antworten sind drei verschiedene"], ersetze: [[POSEN, "    return { zustand: false, pfad: null, sha256: null }", "    return { zustand: null, pfad: null, sha256: null }", 2, 1]] },
  { satz: "posen", ziel: ["Journal: und die Pruefsumme"], ersetze: [[POSEN, "      ? eintrag.sha256 : null,", "      ? null : null,", 3, 1]] },
  { satz: "posen", ziel: ["Journal: Variante 2 ohne Pruefsumme ist trotzdem da"], ersetze: [[POSEN, "  if (!eintrag || typeof eintrag !== \"object\" || !eintrag.pfad) {", "  if (!eintrag || typeof eintrag !== \"object\" || !eintrag.pfad || !eintrag.sha256) {", 2, 1]] },
  { satz: "posen", ziel: ["Journal: eine kaputte Pruefsumme laesst den Eintrag gueltig","Journal: und der Pfad bleibt"], ersetze: [[POSEN, "  if (!eintrag || typeof eintrag !== \"object\" || !eintrag.pfad) {", "  if (!eintrag || typeof eintrag !== \"object\" || !eintrag.pfad || (eintrag.sha256 && !/^[a-f0-9]{64}$/.test(eintrag.sha256))) {", 2, 1]] },
  { satz: "posen", ziel: ["Journal: ein leeres Feld ist eine Aussage, naemlich false"], ersetze: [[POSEN, "  if (!satz || typeof satz !== \"object\") return offen\n", "  if (!satz || typeof satz !== \"object\") return offen\n  if (!Object.keys(satz).length) return offen\n", 2, 1]] },
  { satz: "posen", ziel: ["Waise: die Liste nennt Variante 1 in 2.5D","Waise: Variante 2 ohne Pruefsumme ist trotzdem da","Waise: ein anderer Dateiname derselben Variante gilt trotzdem","Waise: eine kaputte Pruefsumme laesst den Eintrag gueltig","Waise: ein oertlicher Pfad wird nach derselben Namensregel gelesen","Waise: die drei Antworten sind drei verschiedene"], ersetze: [[POSEN, "    zustand: true,", "    zustand: \"ja\",", 3, 2]] },
  { satz: "posen", ziel: ["die Liste nennt die Variante nicht: als fehlend vorgelegt","Waise: dieselbe Variante als Draufsicht steht als null drin, also false","Waise: eine Variante, die es gar nicht gibt, ist false","Waise: ein leeres Feld ist eine Aussage, naemlich false","Waise: ein Eintrag ohne Pfad gilt nicht","Waise: ein leerer Pfad im Eintrag gilt auch nicht","Waise: die drei Antworten sind drei verschiedene"], ersetze: [[POSEN, "    return { zustand: false, pfad: null, sha256: null }", "    return { zustand: null, pfad: null, sha256: null }", 2, 2]] },
  { satz: "posen", ziel: ["Waise: und die Pruefsumme"], ersetze: [[POSEN, "      ? eintrag.sha256 : null,", "      ? null : null,", 3, 2]] },
  { satz: "posen", ziel: ["Waise: Variante 2 ohne Pruefsumme ist trotzdem da"], ersetze: [[POSEN, "  if (!eintrag || typeof eintrag !== \"object\" || !eintrag.pfad) {", "  if (!eintrag || typeof eintrag !== \"object\" || !eintrag.pfad || !eintrag.sha256) {", 2, 2]] },
  { satz: "posen", ziel: ["Waise: eine kaputte Pruefsumme laesst den Eintrag gueltig","Waise: und der Pfad bleibt"], ersetze: [[POSEN, "  if (!eintrag || typeof eintrag !== \"object\" || !eintrag.pfad) {", "  if (!eintrag || typeof eintrag !== \"object\" || !eintrag.pfad || (eintrag.sha256 && !/^[a-f0-9]{64}$/.test(eintrag.sha256))) {", 2, 2]] },
  { satz: "posen", ziel: ["die Liste nennt die Variante nicht: als fehlend vorgelegt","Waise: ein leeres Feld ist eine Aussage, naemlich false"], ersetze: [[POSEN, "  if (!satz || typeof satz !== \"object\") return offen\n", "  if (!satz || typeof satz !== \"object\") return offen\n  if (!Object.keys(satz).length) return offen\n", 2, 2]] },
  { satz: "posen", ziel: ["Journal: die Nummer wird als Text gesucht, 1 und \"1\" sind dasselbe"], ersetze: [[POSEN, "  const eintrag = satz[String(variante)]", "  const eintrag = satz[typeof variante === \"string\" ? `v${variante}` : variante]"]] },
  { satz: "posen", ziel: ["Waise: ein anderer Dateiname derselben Variante gilt trotzdem","Waise: und der Aufrufer bekommt den Namen der LISTE, nicht seinen eigenen","Waise: eine kaputte Pruefsumme laesst den Eintrag gueltig","Waise: und der Pfad bleibt"], ersetze: [[POSEN, "  const eintrag = satz[wer.variante]?.[wer.stil]", "  const eintrag = [satz[wer.variante]?.[wer.stil]].find((e) => !e || !e.pfad || ohneAbfrage(pfad).endsWith(e.pfad))"]] },
  { satz: "posen", ziel: ["Waise: ein oertlicher Pfad wird nach derselben Namensregel gelesen"], ersetze: [[POSEN, "  if (tor && tor.raum !== \"kreatur\") return null", "  if (!tor || tor.raum !== \"kreatur\") return null"]] },
  { satz: "posen", ziel: ["ohne Soll-Summe gibt es null","eine leere Summe ebenso","ohne Adresse ebenso"], ersetze: [[POSEN, "  if (!src || !soll) return null", "  if (!src || !soll) return false"]] },
  // beute: stream-karten.mjs, der Merker, die zwei Blattflaechen, der Item-Installer.
  { satz: "beute", ziel: ["die Liste sagt nein, also kommt null","der oertliche Pfad springt NICHT ein","item-sheet-extender: hinten die Toradresse aus der Liste","item-sheet-extender: die Liste kennt hinten nichts, also keine Rueckseite","item-companion: hinten die Toradresse aus der Liste","item-companion: die Liste kennt hinten nichts, also keine Rueckseite","Streamen an: hinten steht der Platzhalter","hochgeladen wird nur das Symbol","ohne Vorderseite am Tor: hinten der Platzhalter","ohne Vorderseite am Tor: die Vorderseite wird hochgeladen","ein Name mit Leerzeichen: hinten weiter der Platzhalter","ein Name mit Leerzeichen: er wird hochgeladen"], ersetze: [[KARTEN, "/^(.+)-(front|back|icon)\\.webp$/i", "/^(.+)-(front|icon)\\.webp$/i"]] },
  { satz: "beute", ziel: ["ein PNG ist keine gelistete Seite"], ersetze: [[KARTEN, "/^(.+)-(front|back|icon)\\.webp$/i", "/^(.+)-(front|back|icon)\\.(webp|png)$/i"]] },
  { satz: "beute", ziel: ["eine Kreaturenadresse wird abgewiesen","eine Kartenadresse wird abgewiesen"], ersetze: [[KARTEN, "  if (tor && tor.raum !== \"beute\") return null\n", "\n"]] },
  { satz: "beute", ziel: ["eine grossgeschriebene Rolle wird klein gelesen"], luecke: true, ersetze: [[KARTEN, "    rolle: treffer[2].toLowerCase(),", "    rolle: treffer[2],"]] },
  { satz: "beute", ziel: ["Tor: ein abweichender Releasename wird GELESEN, nicht gebildet"], ersetze: [[KARTEN, "    release: tor ? tor.release : `${BEUTE_PRAEFIX}${treffer[1]}`,", "    release: `${BEUTE_PRAEFIX}${treffer[1]}`,"]] },
  { satz: "beute", ziel: ["oertlich: nicht ueber das Tor","oertlich: nicht geprueft","oertlich: keine Adresse","oertlich: kein Abruf","die Oberflaeche bietet sie damit nicht an","ein oertlicher gespeicherter Pfad laesst den Vorrang wie er war","und die Masse bleiben offen, denn ueber eine Platte weiss diese Datei nichts","ohne oertlichen Pfad bleibt der gespeicherte"], ersetze: [[KARTEN, "    ueberTor: !!tor,", "    ueberTor: true,"]] },
  { satz: "beute", ziel: ["ein Cache-Brecher stoert nicht"], ersetze: [[KARTEN, "  const rein = ohneAbfrage(pfad)", "  const rein = String(pfad)"]] },
  { satz: "beute", ziel: ["eine Kreatur hat hier keine Liste","und erzeugt keinen Abruf"], ersetze: [[KARTEN, "  if (!istBeute(schluessel)) return null\n", "\n"]] },
  { satz: "beute", ziel: ["drei Aufrufe, weiter ein Abruf","zehn gleichzeitige Aufrufe, ein zusaetzlicher Abruf"], ersetze: [[KARTEN, "const FRIST_LISTE_MS = 5 * 60 * 1000", "const FRIST_LISTE_MS = 0"]] },
  { satz: "beute", ziel: ["ohne Schluessel keine Liste","ohne Schluessel auch kein Abruf"], ersetze: [[KARTEN, "  if (!streamKey()) return merken(listen, schluessel, null, FRIST_LISTE_MS)\n", "\n"]] },
  { satz: "beute", ziel: ["zehn gleichzeitige Aufrufe, ein zusaetzlicher Abruf","alle zehn bekommen dieselbe Liste"], ersetze: [[KARTEN, "  return await einmal(`karten:${schluessel}`, async () => {", "  return await einmal(`karten:${Math.random()}`, async () => {"]] },
  { satz: "beute", ziel: ["die Liste kommt an","und zwar auf `_karten.json` im eigenen Raum","Vorderseite: vorhanden","Vorderseite: Adresse","Vorderseite: Breite","Vorderseite: Hoehe","Symbol: quadratisch gelistet","Rueckseite aus dem Vorderseitenpfad gefragt"], ersetze: [[KARTEN, "assetUrl(schluessel, \"\", \"_karten.json\")", "assetUrl(schluessel, \"\", \"_posen.json\")"]] },
  { satz: "beute", ziel: ["eine Abweisung am Tor","ohne Liste: nicht geprueft statt gibt es nicht"], ersetze: [[KARTEN, "      if (antwort.ok && !antwort.headers.get(\"x-beneos-denied\")\n", "      if (antwort.ok\n"]] },
  { satz: "beute", ziel: ["eine Antwort ohne Verbindung"], ersetze: [[KARTEN, "          && !antwort.headers.get(\"x-beneos-offline\")) {", "          ) {"]] },
  { satz: "beute", ziel: ["eine Fehlseite als JSON","karten ist kein Objekt"], ersetze: [[KARTEN, "            && gelesen.karten && typeof gelesen.karten === \"object\") {", "            ) {"]] },
  { satz: "beute", ziel: ["ein Netzfehler ist keine Liste","Tor wirft: vorne der oertliche Pfad","Tor wirft: hinten der oertliche Pfad"], luecke: true, ersetze: [[KARTEN, "      // keine Liste. Der Aufrufer bekommt dann \"nicht geprueft\".\n      wert = null\n", "      // keine Liste. Der Aufrufer bekommt dann \"nicht geprueft\".\n      wert = { karten: { front: { pfad: \"x-front.webp\" }, back: { pfad: \"x-back.webp\" } } }\n"]] },
  { satz: "beute", ziel: ["eine Rolle, die es nicht gibt, bleibt offen","eine unbekannte Rolle faellt in den dritten Ausgang","und loest keinen Abruf aus"], ersetze: [[KARTEN, "  const ziel = ROLLEN[String(rolle || \"\").toLowerCase()]", "  const ziel = ROLLEN[String(rolle || \"\").toLowerCase()] || \"front\""]] },
  { satz: "beute", ziel: ["eine grossgeschriebene Rolle ist dieselbe Rolle"], luecke: true, ersetze: [[KARTEN, "  const ziel = ROLLEN[String(rolle || \"\").toLowerCase()]", "  const ziel = ROLLEN[String(rolle || \"\")]"]] },
  { satz: "beute", ziel: ["oertlich: nicht geprueft","oertlich: keine Adresse","oertlich: kein Abruf","die Oberflaeche bietet sie damit nicht an","ein oertlicher gespeicherter Pfad laesst den Vorrang wie er war","und die Masse bleiben offen, denn ueber eine Platte weiss diese Datei nichts","ohne oertlichen Pfad bleibt der gespeicherte"], ersetze: [[KARTEN, "  if (!wer.ueberTor) return offen\n", "\n"]] },
  { satz: "beute", ziel: ["ohne Liste: nicht geprueft statt gibt es nicht"], luecke: true, ersetze: [[KARTEN, "  if (!liste) return offen\n", "  if (!liste) return { zustand: false, src: null, breite: null, hoehe: null }\n"]] },
  { satz: "beute", ziel: ["Rueckseite: gibt es nicht","die Liste sagt nein, also kommt null","der oertliche Pfad springt NICHT ein","item-sheet-extender: die Liste kennt hinten nichts, also keine Rueckseite","item-companion: die Liste kennt hinten nichts, also keine Rueckseite"], ersetze: [[KARTEN, "  if (eintrag === null) return { zustand: false, src: null, breite: null, hoehe: null }", "  if (eintrag === null) return offen"]] },
  { satz: "beute", ziel: ["ein Eintrag ohne Pfad: nicht geprueft","ein Eintrag als blosse Zeichenkette: nicht geprueft"], luecke: true, ersetze: [[KARTEN, "  if (!eintrag || typeof eintrag !== \"object\" || typeof eintrag.pfad !== \"string\"\n      || !eintrag.pfad) {", "  if (!eintrag) {"]] },
  { satz: "beute", ziel: ["[Struktur] die Adresse entsteht aus `eintrag.pfad`","[Struktur] kein Dateiname wird im Code zusammengesetzt"], ersetze: [[KARTEN, "    src: assetUrl(wer.release, \"\", eintrag.pfad),", "    src: assetUrl(wer.release, \"\", `${wer.kennung}-${ziel}.webp`),"]] },
  { satz: "beute", ziel: ["Vorderseite: Breite","und die Masse kommen aus der Liste"], ersetze: [[KARTEN, "    breite: Number.isFinite(eintrag.breite) ? eintrag.breite : null,", "    breite: Number.isFinite(eintrag.breite) ? eintrag.hoehe : null,"]] },
  { satz: "beute", ziel: ["Vorderseite: Hoehe","Symbol: quadratisch gelistet","und die Masse kommen aus der Liste"], ersetze: [[KARTEN, "    hoehe: Number.isFinite(eintrag.hoehe) ? eintrag.hoehe : null,", "    hoehe: null,"]] },
  { satz: "beute", ziel: ["ein oertlicher gespeicherter Pfad laesst den Vorrang wie er war","eine unbekannte Rolle faellt in den dritten Ausgang"], ersetze: [[KARTEN, "    src: oertlich || gespeichert || null,", "    src: gespeichert || oertlich || null,"]] },
  { satz: "beute", ziel: ["ohne oertlichen Pfad bleibt der gespeicherte"], luecke: true, ersetze: [[KARTEN, "    src: oertlich || gespeichert || null,", "    src: oertlich || null,"]] },
  { satz: "beute", ziel: ["die Liste sagt nein, also kommt null","der oertliche Pfad springt NICHT ein","item-sheet-extender: die Liste kennt hinten nichts, also keine Rueckseite","item-companion: die Liste kennt hinten nichts, also keine Rueckseite"], ersetze: [[KARTEN, "    return { src: null, breite: null, hoehe: null }\n  }\n\n  // NICHT GEPRUEFT", "    return { src: oertlich, breite: null, hoehe: null }\n  }\n\n  // NICHT GEPRUEFT"]] },
  { satz: "beute", ziel: ["und die Masse kommen aus der Liste"], ersetze: [[KARTEN, "    return { src: befund.src, breite: befund.breite, hoehe: befund.hoehe }", "    return { src: befund.src, breite: null, hoehe: null }"]] },
  { satz: "beute", ziel: ["die Oberflaeche bietet sie damit nicht an","Tor wirft: vorne der oertliche Pfad","Tor wirft: hinten der oertliche Pfad"], ersetze: [[KARTEN, "  return befund.zustand === true\n", "  return befund.zustand !== false\n"]] },
  { satz: "beute", ziel: ["vergessen heisst vergessen","und danach wird neu geholt","danach ist der Kartenmerker geleert"], ersetze: [[KARTEN, "  listen.delete(String(release))", "  listen.has(String(release))"]] },
  { satz: "beute", ziel: ["zehn gleichzeitige Aufrufe, ein zusaetzlicher Abruf","eine Abweisung am Tor","eine Antwort ohne Verbindung","eine Fehlseite als JSON","karten ist kein Objekt","gar kein JSON","ein Netzfehler ist keine Liste","ohne Schluessel keine Liste","Rueckseite: gibt es nicht","Rueckseite: keine Adresse","die Oberflaeche darf sie nicht anbieten","ohne Liste: nicht geprueft statt gibt es nicht","ein Eintrag ohne Pfad: nicht geprueft","ein Eintrag als blosse Zeichenkette: nicht geprueft","und welche Rollen liegen","und danach wird neu geholt","dafuer wurde die Liste geholt","und es wurde NICHTS geholt","item-sheet-extender: hinten die Toradresse aus der Liste","item-companion: hinten die Toradresse aus der Liste","danach ist der Kartenmerker geleert"], ersetze: [[KARTEN, "  if (release === undefined || release === null) { listen.clear(); return }", "  if (release === undefined || release === null) { return }"]] },
  { satz: "beute", ziel: ["und welche Rollen liegen"], ersetze: [[KARTEN, "      for (const r of Object.keys(ROLLEN)) rollen[r] = !!e.wert.karten[r]", "      for (const r of Object.keys(ROLLEN)) rollen[r] = true"]] },
  { satz: "beute", ziel: ["der Bericht nennt das Release"], ersetze: [[KARTEN, "    je.push({ release, liste: !!e.wert, rollen, alter_ms: Date.now() - e.stand })", "    je.push({ release: \"?\", liste: !!e.wert, rollen, alter_ms: Date.now() - e.stand })"]] },
  { satz: "beute", ziel: ["[Struktur] die Adresse entsteht aus `eintrag.pfad`"], ersetze: [[KARTEN, "    src: assetUrl(wer.release, \"\", eintrag.pfad),", "    src: assetUrl(wer.release, \"\", eintrag[\"pfad\"]),"]] },
  { satz: "beute", ziel: ["[Struktur] kein Dateiname wird im Code zusammengesetzt"], ersetze: [[KARTEN, "export const ROLLEN = { front: \"front\", back: \"back\", icon: \"icon\" }", "export const ROLLEN = { front: \"front\", back: \"back\", icon: \"icon\" }\nexport const muster = (k, rolle) => `${k}-${rolle}.webp`"]] },
  { satz: "beute", ziel: ["[Struktur] stream-karten holt den Merker"], ersetze: [[KARTEN, "import { einmal, frisch, merken, ohneAbfrage } from \"./stream-merker.mjs\"", "import { einmal, frisch, merken, ohneAbfrage } from \"./stream-merker.mjs?eigen\""]] },
  { satz: "beute", ziel: ["[Struktur] stream-posen holt denselben Merker"], ersetze: [[POSEN, "import { einmal, frisch, merken, ohneAbfrage } from \"./stream-merker.mjs\"", "import { einmal, frisch, merken, ohneAbfrage } from \"./stream-merker.mjs?eigen\""]] },
  { satz: "beute", ziel: ["[Struktur] keine der beiden Dateien hat einen eigenen Merker"], ersetze: [[KARTEN, "import { einmal, frisch, merken, ohneAbfrage } from \"./stream-merker.mjs\"", "import { einmal, frisch, merken as merkenGeteilt, ohneAbfrage } from \"./stream-merker.mjs\"\nfunction merken(...a) { return merkenGeteilt(...a) }"]] },
  { satz: "beute", ziel: ["viele Releases: gemerkt bleiben hoechstens KARTE_MAX"], ersetze: [[MERKER, "  while (karte.size >= KARTE_MAX) {", "  while (karte.size >= KARTE_MAX * 2) {"]] },
  { satz: "beute", ziel: ["Beutepraefix"], ersetze: [[SETTINGS, "export const BEUTE_PRAEFIX = \"beneos_lt_\"", "export const BEUTE_PRAEFIX = \"beneos_lo_\""]] },
  { satz: "beute", ziel: ["Praefix in der Mitte ist keine Beute"], ersetze: [[SETTINGS, "  return String(release || \"\").startsWith(BEUTE_PRAEFIX)", "  return String(release || \"\").includes(BEUTE_PRAEFIX)"]] },
  { satz: "beute", ziel: ["ein Beutename ist keine Kreatur","die Beuteadresse","eine Battlemap behaelt ihre Variante","Tor: Rolle","Tor: ueber das Tor","Tor: Release aus dem Pfad","und zwar auf `_karten.json` im eigenen Raum","Vorderseite: vorhanden","Vorderseite: Adresse","Vorderseite: Breite","Vorderseite: Hoehe","Symbol: quadratisch gelistet","Rueckseite aus dem Vorderseitenpfad gefragt"], ersetze: [[SETTINGS, "  return String(release || \"\").startsWith(KREATUR_PRAEFIX)", "  return String(release || \"\").includes(\"beneos_\")"]] },
  { satz: "beute", ziel: ["item-sheet-extender: vorne die Toradresse aus der Liste","item-sheet-extender: die Vorderseite kommt weiter","item-sheet-extender: ohne gespeicherte Adresse kommt vorne der oertliche Pfad"], ersetze: [[SHEET, "    const vorne = await karteFuerBlatt(\n      loot.render?.frontCardWebp || null, cloudCards.front, \"front\");", "    const vorne = karteFuerBlatt(\n      loot.render?.frontCardWebp || null, cloudCards.front, \"front\");"]] },
  { satz: "beute", ziel: ["item-sheet-extender: ohne gespeicherte Adresse kommt vorne der oertliche Pfad"], ersetze: [[SHEET, "    const vorne = await karteFuerBlatt(\n      loot.render?.frontCardWebp || null, cloudCards.front, \"front\");", "    const vorne = await karteFuerBlatt(\n      loot.render?.frontCardWebp || null, null, \"front\");"]] },
  { satz: "beute", ziel: ["item-companion: vorne die Toradresse aus der Liste","item-companion: die Vorderseite kommt weiter","item-companion: ohne gespeicherte Adresse kommt vorne der oertliche Pfad"], ersetze: [[COMP, "    const vorne = await karteFuerBlatt(\n      render.frontCardWebp || null, cloudCards.front, \"front\");", "    const vorne = karteFuerBlatt(\n      render.frontCardWebp || null, cloudCards.front, \"front\");"]] },
  { satz: "beute", ziel: ["item-companion: ohne gespeicherte Adresse kommt vorne der oertliche Pfad"], ersetze: [[COMP, "    const vorne = await karteFuerBlatt(\n      render.frontCardWebp || null, cloudCards.front, \"front\");", "    const vorne = await karteFuerBlatt(\n      render.frontCardWebp || null, null, \"front\");"]] },
  { satz: "beute", ziel: ["item-sheet-extender: hinten die Toradresse aus der Liste","item-sheet-extender: die Liste kennt hinten nichts, also keine Rueckseite","item-sheet-extender: und hinten ebenso"], ersetze: [[SHEET, "    const hinten = await karteFuerBlatt(\n      loot.render?.backCardWebp || null, cloudCards.back, \"back\");", "    const hinten = karteFuerBlatt(\n      loot.render?.backCardWebp || null, cloudCards.back, \"back\");"]] },
  { satz: "beute", ziel: ["item-sheet-extender: und hinten ebenso"], ersetze: [[SHEET, "    const hinten = await karteFuerBlatt(\n      loot.render?.backCardWebp || null, cloudCards.back, \"back\");", "    const hinten = await karteFuerBlatt(\n      loot.render?.backCardWebp || null, null, \"back\");"]] },
  { satz: "beute", ziel: ["item-sheet-extender: hinten die Toradresse aus der Liste","item-sheet-extender: die Liste kennt hinten nichts, also keine Rueckseite"], luecke: true, ersetze: [[SHEET, "    const hinten = await karteFuerBlatt(\n      loot.render?.backCardWebp || null, cloudCards.back, \"back\");", "    const hinten = await karteFuerBlatt(\n      loot.render?.backCardWebp || null, cloudCards.back, \"front\");"]] },
  { satz: "beute", ziel: ["item-companion: hinten die Toradresse aus der Liste","item-companion: die Liste kennt hinten nichts, also keine Rueckseite","item-companion: und hinten ebenso"], ersetze: [[COMP, "    const hinten = await karteFuerBlatt(\n      render.backCardWebp || null, cloudCards.back, \"back\");", "    const hinten = karteFuerBlatt(\n      render.backCardWebp || null, cloudCards.back, \"back\");"]] },
  { satz: "beute", ziel: ["item-companion: und hinten ebenso"], ersetze: [[COMP, "    const hinten = await karteFuerBlatt(\n      render.backCardWebp || null, cloudCards.back, \"back\");", "    const hinten = await karteFuerBlatt(\n      render.backCardWebp || null, null, \"back\");"]] },
  { satz: "beute", ziel: ["item-companion: hinten die Toradresse aus der Liste","item-companion: die Liste kennt hinten nichts, also keine Rueckseite"], luecke: true, ersetze: [[COMP, "    const hinten = await karteFuerBlatt(\n      render.backCardWebp || null, cloudCards.back, \"back\");", "    const hinten = await karteFuerBlatt(\n      render.backCardWebp || null, cloudCards.back, \"front\");"]] },
  { satz: "beute", ziel: ["item-sheet-extender: hinten die Toradresse aus der Liste","item-sheet-extender: die Liste kennt hinten nichts, also keine Rueckseite"], ersetze: [[SHEET, "    const backCard  = hinten.src;", "    const backCard  = cloudCards.back || hinten.src;"]] },
  { satz: "beute", ziel: ["item-companion: hinten die Toradresse aus der Liste","item-companion: die Liste kennt hinten nichts, also keine Rueckseite"], ersetze: [[COMP, "    const backCard  = hinten.src;", "    const backCard  = cloudCards.back || hinten.src;"]] },
  { satz: "beute", ziel: ["Streamen an: vorne steht der Platzhalter","kein Kartenfeld traegt den Schluessel","ohne Rueckseite am Tor: vorne der Platzhalter"], ersetze: [[CLOUD, "          lootRender.frontCardWebp = _beneosBeutePlatzhalter(itemKey, frontRoh)", "          lootRender.frontCardWebp = assetUrl(`${BEUTE_PRAEFIX}${itemKey}`, \"\", frontRoh)"]] },
  { satz: "beute", ziel: ["Streamen an: hinten steht der Platzhalter","kein Kartenfeld traegt den Schluessel","ohne Vorderseite am Tor: hinten der Platzhalter","ein Name mit Leerzeichen: hinten weiter der Platzhalter"], ersetze: [[CLOUD, "          lootRender.backCardWebp = _beneosBeutePlatzhalter(itemKey, backRoh)", "          lootRender.backCardWebp = assetUrl(`${BEUTE_PRAEFIX}${itemKey}`, \"\", backRoh)"]] },
  { satz: "beute", ziel: ["ohne Rueckseite am Tor: hinten der oertliche Pfad","ohne Rueckseite am Tor: die Rueckseite wird hochgeladen","ohne Vorderseite am Tor: hinten der Platzhalter","ohne Vorderseite am Tor: die Vorderseite wird hochgeladen"], ersetze: [[CLOUD, "        && await _beneosBeuteKarteAmTor(itemKey, backRoh, \"back\")", "        && await _beneosBeuteKarteAmTor(itemKey, backRoh, \"front\")"]] },
  { satz: "beute", ziel: ["ohne Rueckseite am Tor: vorne der Platzhalter","ohne Rueckseite am Tor: die Rueckseite wird hochgeladen","ohne Vorderseite am Tor: vorne der oertliche Pfad","ohne Vorderseite am Tor: die Vorderseite wird hochgeladen"], ersetze: [[CLOUD, "        && await _beneosBeuteKarteAmTor(itemKey, frontRoh, \"front\")", "        && await _beneosBeuteKarteAmTor(itemKey, backRoh, \"back\")"]] },
  { satz: "beute", ziel: ["hochgeladen wird nur das Symbol","ohne Rueckseite am Tor: die Rueckseite wird hochgeladen"], ersetze: [[CLOUD, "      if (!frontStreamt) {\n", "      if (true) {\n"]] },
  { satz: "beute", ziel: ["hochgeladen wird nur das Symbol","ohne Vorderseite am Tor: die Vorderseite wird hochgeladen","ein Name mit Leerzeichen: er wird hochgeladen"], ersetze: [[CLOUD, "      if (!backStreamt) {\n", "      if (true) {\n"]] },
  { satz: "beute", ziel: ["ohne Kartenfelder: alle drei Bilder werden hochgeladen","ohne Kartenfelder: es wird gewarnt"], ersetze: [[CLOUD, "      const hatKartenfelder = !!kartenfelder && typeof kartenfelder === \"object\"", "      const hatKartenfelder = true"]] },
  { satz: "beute", ziel: ["Streamen aus: vorne der oertliche Pfad","Streamen aus: hinten der oertliche Pfad","Streamen aus: alle drei Bilder werden hochgeladen","Streamen aus: das Tor wird nicht gefragt"], luecke: true, ersetze: [[CLOUD, "function _beneosBeuteStreamt() {\n  return lieferungStreamt()", "function _beneosBeuteStreamt() {\n  return true"]] },
  { satz: "beute", ziel: ["ein Zeichen ausserhalb der Liste: vorne der oertliche Pfad"], ersetze: [[CLOUD, "  return /^[A-Za-z0-9._-]+\\.webp$/.test(String(filename || \"\"))", "  return /^.+\\.webp$/.test(String(filename || \"\"))", 2, 2]] },
  { satz: "beute", ziel: ["danach ist der Kartenmerker geleert"], ersetze: [[CLOUD, "      if (frontStreamt || backStreamt) kartenVergessen(`${BEUTE_PRAEFIX}${itemKey}`)\n", "\n"]] },
  { satz: "beute", ziel: ["das Symbolfeld bekommt keine Adresse, nur den neuen Ordner","ohne Rueckseite am Tor: hinten der oertliche Pfad","ohne Vorderseite am Tor: vorne der oertliche Pfad","Streamen aus: vorne der oertliche Pfad","Streamen aus: hinten der oertliche Pfad","ein Name mit Leerzeichen: vorne der oertliche Pfad","ein Zeichen ausserhalb der Liste: vorne der oertliche Pfad","Tor wirft: vorne der oertliche Pfad","Tor wirft: hinten der oertliche Pfad"], luecke: true, ersetze: [[CLOUD, "            lootRender[k] = lootRender[k].replaceAll(\"beneos_assets/beneos_items/\", \"beneos_assets/cloud/items/\")", "            lootRender[k] = lootRender[k]"]] },
  { satz: "beute", ziel: ["das Bild des Gegenstands bleibt der oertliche Pfad"], ersetze: [[CLOUD, "      itemObjectData.img = `${finalFolder}/${itemData.itemImage.icon.filename}`", "      itemObjectData.img = _beneosBeutePlatzhalter(itemKey, itemData.itemImage.icon.filename)"]] },
  { satz: "beute", ziel: ["das Symbolfeld bekommt keine Adresse, nur den neuen Ordner"], ersetze: [[CLOUD, "          lootRender.backCardWebp = _beneosBeutePlatzhalter(itemKey, backRoh)\n        }\n", "          lootRender.backCardWebp = _beneosBeutePlatzhalter(itemKey, backRoh)\n        }\n        lootRender.iconWebp = _beneosBeutePlatzhalter(itemKey, \"x-icon.webp\")\n"]] },
  { satz: "beute", ziel: ["ohne Kartenfelder: es wird gewarnt"], luecke: true, ersetze: [[CLOUD, "      if (beuteStreamt && !hatKartenfelder) {\n        console.warn(", "      if (false) {\n        console.warn("]] },
  { satz: "beute", ziel: ["Kreaturenpraefix unveraendert","eine Kreatur bleibt auf /c/"], ersetze: [[SETTINGS, "export const KREATUR_PRAEFIX = \"beneos_ct_\"", "export const KREATUR_PRAEFIX = \"beneos_kt_\""]] },
  { satz: "beute", ziel: ["ein Kreaturenname ist keine Beute","ein Kartenname ist keine Beute","eine Battlemap behaelt ihre Variante","eine Kreatur hat hier keine Liste","und erzeugt keinen Abruf"], ersetze: [[SETTINGS, "  return String(release || \"\").startsWith(BEUTE_PRAEFIX)", "  return String(release || \"\").startsWith(\"beneos_\")"]] },
  { satz: "beute", ziel: ["leer ist keine Beute","undefined ist keine Beute"], ersetze: [[SETTINGS, "  return String(release || \"\").startsWith(BEUTE_PRAEFIX)", "  return !release || String(release).startsWith(BEUTE_PRAEFIX)"]] },
  { satz: "beute", ziel: ["eine mitgegebene Variante faellt weg"], ersetze: [[SETTINGS, "    return [\"l\", encodeURIComponent(release), clean]", "    return variant ? [\"l\", encodeURIComponent(release), encodeURIComponent(variant), clean] : [\"l\", encodeURIComponent(release), clean]"]] },
  { satz: "beute", ziel: ["eine Kreatur bleibt auf /c/"], ersetze: [[SETTINGS, "    return [\"c\", encodeURIComponent(release), clean]", "    return [\"l\", encodeURIComponent(release), clean]"]] },
  { satz: "beute", ziel: ["Raum","Tor: Rolle","Tor: ueber das Tor","Tor: Release aus dem Pfad","Tor: ein abweichender Releasename wird GELESEN, nicht gebildet","Vorderseite: vorhanden","Vorderseite: Adresse","Vorderseite: Breite","Vorderseite: Hoehe","Symbol: quadratisch gelistet","Rueckseite aus dem Vorderseitenpfad gefragt"], ersetze: [[SETTINGS, "        raum: \"beute\",\n", "        raum: \"kreatur\",\n"]] },
  { satz: "beute", ziel: ["Release","der Schluessel steht in keinem Feld","hin und zurueck, Release","Tor: Release aus dem Pfad","Tor: ein abweichender Releasename wird GELESEN, nicht gebildet","Vorderseite: vorhanden","Vorderseite: Adresse","Vorderseite: Breite","Vorderseite: Hoehe","Symbol: quadratisch gelistet","Rueckseite aus dem Vorderseitenpfad gefragt"], ersetze: [[SETTINGS, "        raum: \"beute\",\n        release: decodeURIComponent(teile[2]),", "        raum: \"beute\",\n        release: decodeURIComponent(teile[1]),"]] },
  { satz: "beute", ziel: ["Variante ist die leere Aussage"], ersetze: [[SETTINGS, "        raum: \"beute\",\n        release: decodeURIComponent(teile[2]),\n        variant: \"\",", "        raum: \"beute\",\n        release: decodeURIComponent(teile[2]),\n        variant: undefined,"]] },
  { satz: "beute", ziel: ["Pfad","hin und zurueck, Pfad"], ersetze: [[SETTINGS, "        variant: \"\",\n        pfad: teile.slice(3).map(decodeURIComponent).join(\"/\"),\n      }\n    }\n    /*", "        variant: \"\",\n        pfad: teile.slice(2).map(decodeURIComponent).join(\"/\"),\n      }\n    }\n    /*"]] },
  { satz: "beute", ziel: ["der Schluessel steht in keinem Feld"], ersetze: [[SETTINGS, "        raum: \"beute\",\n", "        raum: \"beute\", schluessel: teile[1],\n"]] },
  { satz: "beute", ziel: ["drei Segmente ergeben nichts"], ersetze: [[SETTINGS, "    if (teile[0] === \"l\" && teile.length >= 4) {", "    if (teile[0] === \"l\" && teile.length >= 3) {"]] },
  { satz: "beute", ziel: ["ein vierter Buchstabe ergibt nichts"], ersetze: [[SETTINGS, "    if (teile[0] === \"l\" && teile.length >= 4) {", "    if ((teile[0] === \"l\" || teile[0] === \"x\") && teile.length >= 4) {"]] },
  { satz: "beute", ziel: ["oertlich: Kennung"], ersetze: [[KARTEN, "    kennung: treffer[1],", "    kennung: treffer[2],"]] },
  { satz: "beute", ziel: ["oertlich: Rolle","Tor: Rolle","ein Cache-Brecher stoert nicht","eine grossgeschriebene Rolle wird klein gelesen"], ersetze: [[KARTEN, "    rolle: treffer[2].toLowerCase(),", "    rolle: treffer[1].toLowerCase(),"]] },
  { satz: "beute", ziel: ["oertlich: Release wird gebildet"], ersetze: [[KARTEN, "release: tor ? tor.release : `${BEUTE_PRAEFIX}${treffer[1]}`,", "release: tor ? tor.release : `${treffer[1]}`,"]] },
  { satz: "beute", ziel: ["eine fremde Rolle ist keine Seite"], ersetze: [[KARTEN, "/^(.+)-(front|back|icon)\\.webp$/i", "/^(.+)-([a-z]+)\\.webp$/i"]] },
  { satz: "beute", ziel: ["eine fremde Rolle ist keine Seite","ein nackter Name ohne Rolle ist nichts"], ersetze: [[KARTEN, "/^(.+)-(front|back|icon)\\.webp$/i", "/^(.+?)(?:-(front|back|icon))?\\.webp$/i"], [KARTEN, "    rolle: treffer[2].toLowerCase(),", "    rolle: (treffer[2] || \"front\").toLowerCase(),"]] },
  { satz: "beute", ziel: ["ein Abruf","drei Aufrufe, weiter ein Abruf","zehn gleichzeitige Aufrufe, ein zusaetzlicher Abruf","und danach wird neu geholt","dafuer wurde die Liste geholt","und es wurde NICHTS geholt"], ersetze: [[KARTEN, "      const antwort = await fetch(assetUrl(schluessel, \"\", \"_karten.json\"))", "      await fetch(assetUrl(schluessel, \"\", \"_karten.json\"))\n      const antwort = await fetch(assetUrl(schluessel, \"\", \"_karten.json\"))"]] },
  { satz: "beute", ziel: ["und ihre Adresse traegt die Rueckseite","item-sheet-extender: hinten die Toradresse aus der Liste","item-companion: hinten die Toradresse aus der Liste","[Struktur] die Adresse entsteht aus `eintrag.pfad`","ohne Vorderseite am Tor: hinten der Platzhalter","ohne Vorderseite am Tor: die Vorderseite wird hochgeladen"], ersetze: [[KARTEN, "    src: assetUrl(wer.release, \"\", eintrag.pfad),", "    src: assetUrl(wer.release, \"\", liste.karten.front.pfad),"]] },
  { satz: "beute", ziel: ["die Vorderseite gibt es weiter","die Vorderseite derselben Liste kommt weiter","item-sheet-extender: die Vorderseite kommt weiter","item-companion: die Vorderseite kommt weiter","ohne Rueckseite am Tor: vorne der Platzhalter","ohne Rueckseite am Tor: die Rueckseite wird hochgeladen"], ersetze: [[KARTEN, "  if (eintrag === null) return", "  if (eintrag === null || liste.karten.back === null) return"]] },
  { satz: "beute", ziel: ["eine Liste gemerkt","viele Releases: gemerkt bleiben hoechstens KARTE_MAX"], ersetze: [[KARTEN, "  return { listen: listen.size, je }", "  return { listen: listen.size * 2, je }"]] },
  { satz: "beute", ziel: ["eine Toradresse schlaegt den oertlichen Pfad","und die Masse kommen aus der Liste","item-sheet-extender: vorne die Toradresse aus der Liste","item-sheet-extender: hinten die Toradresse aus der Liste","item-sheet-extender: die Vorderseite kommt weiter","item-companion: vorne die Toradresse aus der Liste","item-companion: hinten die Toradresse aus der Liste","item-companion: die Vorderseite kommt weiter"], ersetze: [[KARTEN, "  if (befund.zustand === true) {\n    return { src: befund.src,", "  if (befund.zustand === true && !oertlich) {\n    return { src: befund.src,"]] },
  { satz: "beute", ziel: ["ein oertlicher gespeicherter Pfad laesst den Vorrang wie er war","ohne gespeicherten Wert bleibt der oertliche Pfad","eine unbekannte Rolle faellt in den dritten Ausgang","item-sheet-extender: ohne gespeicherte Adresse kommt vorne der oertliche Pfad","item-sheet-extender: und hinten ebenso","item-companion: ohne gespeicherte Adresse kommt vorne der oertliche Pfad","item-companion: und hinten ebenso"], ersetze: [[KARTEN, "    src: oertlich || gespeichert || null,", "    src: gespeichert || null,"]] },
  { satz: "beute", ziel: ["ohne beides kommt null und keine gebildete Adresse"], ersetze: [[KARTEN, "    src: oertlich || gespeichert || null,", "    src: oertlich || gespeichert || \"\","]] },
  { satz: "beute", ziel: ["oertlich: nicht geprueft","oertlich: keine Adresse","oertlich: kein Abruf","die Oberflaeche bietet sie damit nicht an","ein oertlicher gespeicherter Pfad laesst den Vorrang wie er war","und die Masse bleiben offen, denn ueber eine Platte weiss diese Datei nichts","ohne gespeicherten Wert bleibt der oertliche Pfad","ohne oertlichen Pfad bleibt der gespeicherte","item-sheet-extender: ohne gespeicherte Adresse kommt vorne der oertliche Pfad","item-sheet-extender: und hinten ebenso","item-sheet-extender: dafuer wird nichts geholt","item-companion: ohne gespeicherte Adresse kommt vorne der oertliche Pfad","item-companion: und hinten ebenso","item-companion: dafuer wird nichts geholt"], ersetze: [[KARTEN, "  if (!wer.ueberTor) return offen\n", "\n"], [KARTEN, "  const befund = await karte(gespeichert, rolle)", "  const befund = await karte(gespeichert || oertlich, rolle)"]] },
  { satz: "beute", ziel: ["der Lauf erreicht die Dokumentklasse","Streamen an: vorne steht der Platzhalter","Streamen an: hinten steht der Platzhalter","das Symbolfeld bekommt keine Adresse, nur den neuen Ordner","das Bild des Gegenstands bleibt der oertliche Pfad","hochgeladen wird nur das Symbol","danach ist der Kartenmerker geleert","ohne Rueckseite am Tor: vorne der Platzhalter","ohne Rueckseite am Tor: hinten der oertliche Pfad","ohne Rueckseite am Tor: die Rueckseite wird hochgeladen","ohne Vorderseite am Tor: vorne der oertliche Pfad","ohne Vorderseite am Tor: hinten der Platzhalter","ohne Vorderseite am Tor: die Vorderseite wird hochgeladen","Streamen aus: vorne der oertliche Pfad","Streamen aus: hinten der oertliche Pfad","Streamen aus: alle drei Bilder werden hochgeladen","ohne Kartenfelder: alle drei Bilder werden hochgeladen","ein Name mit Leerzeichen: vorne der oertliche Pfad","ein Name mit Leerzeichen: hinten weiter der Platzhalter","ein Name mit Leerzeichen: er wird hochgeladen","ein Zeichen ausserhalb der Liste: vorne der oertliche Pfad","Tor wirft: vorne der oertliche Pfad","Tor wirft: hinten der oertliche Pfad"], luecke: true, ersetze: [[CLOUD, "      itemObjectData.system.description.value = itemObjectData.system.description.value.replaceAll", "      itemObjectData.system.beschreibung.value = itemObjectData.system.description.value.replaceAll"]] },
  { satz: "beute", ziel: ["die Liste wurde am Tor gefragt","ohne Rueckseite am Tor: hinten der oertliche Pfad","ohne Rueckseite am Tor: die Rueckseite wird hochgeladen","ohne Vorderseite am Tor: vorne der oertliche Pfad","ohne Vorderseite am Tor: die Vorderseite wird hochgeladen","Tor wirft: vorne der oertliche Pfad","Tor wirft: hinten der oertliche Pfad"], ersetze: [[CLOUD, "        && await _beneosBeuteKarteAmTor(itemKey, frontRoh, \"front\")", "        && true"], [CLOUD, "        && await _beneosBeuteKarteAmTor(itemKey, backRoh, \"back\")", "        && true"]] },
  { satz: "geteilt", ziel: ["[Struktur] keine Moduldatei ruft eine Pruefsatznaht"], ersetze: [["scripts/stream/zz-naht-rufer.mjs", null, "import { vorratsSchluesselMitVorratFuerPruefsatz } from \"./stream-fetch.mjs\"\nexport const schluessel = (u) => vorratsSchluesselMitVorratFuerPruefsatz(u)\n"]] },
  { satz: "beute", ziel: ["item-sheet-extender: die Vorlage bekommt den fertigen Kontext mit der Toradresse"], ersetze: [[SHEET, "    const ctx = await ItemSheetExtender._buildContext(loot, item);", "    const ctx = ItemSheetExtender._buildContext(loot, item);"]] },
  { satz: "beute", ziel: ["item-companion: die Vorlage bekommt den fertigen Kontext mit der Toradresse"], ersetze: [[COMP, "    const ctx = await this._context();", "    const ctx = this._context();"]] },
  { satz: "bilder", ziel: ["das erste Fenster zu: die Adresse des zweiten bleibt gehalten"], ersetze: [[BILDER, "    if (eintrag.halter.size) continue\n", "\n"]] },
  { satz: "beute", ziel: ["item-sheet-extender: der Rufer erreicht die Vorlage","item-sheet-extender: die Vorlage bekommt den fertigen Kontext mit der Toradresse"], ersetze: [[SHEET, "    if (!(root instanceof HTMLElement) && !(root instanceof DocumentFragment)) return;", "    if (!(root instanceof DocumentFragment)) return;"]] },
  { satz: "beute", ziel: ["item-companion: der Rufer erreicht die Vorlage","item-companion: die Vorlage bekommt den fertigen Kontext mit der Toradresse"], ersetze: [[COMP, "    const renderFn = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;", "    const renderFn = globalThis.renderTemplate;"]] },
  { satz: "bilder", ziel: ["und holt die Adresse kein zweites Mal"], ersetze: [[BILDER, "  if (vorhanden) return vorhanden.versprechen\n", "\n"]] },
  { satz: "bilder", ziel: ["ein zweites Fenster mit derselben Adresse bekommt ein Blob"], ersetze: [[BILDER, "  if (vorhanden) return vorhanden.versprechen\n", "  if (vorhanden) return null\n"]] },
];

/*
 * PROBEN, DIE KEINE SABOTAGE AM CODE ROT MACHEN KANN, je eine Zeile Grund.
 */
const EIGENPROBEN = {
  maske: {
    "[Struktur] der Kommentarfilter nimmt wirklich etwas weg":
      "Selbstprobe des Filters: rot nur, wenn stream-report.mjs keine einzige Kommentar- oder Leerzeile mehr hat. Eine Sabotage muesste die Datei leerraeumen.",
  },
  posen: {
    "Journal: keine Liste, sondern eine Zeichenkette: nicht geprueft":
      "Die Typabfrage auf die Liste ist wirkungsgleich mit der Feldabfrage darunter: eine Zeichenkette traegt kein Feld journalbilder. Eine Sabotage an ihr bleibt unsichtbar.",
    "Waise: keine Liste, sondern eine Zeichenkette: nicht geprueft":
      "Wie oben fuer tokenbilder: die Feldabfrage faengt die Zeichenkette auch ohne Typabfrage.",
  },
  geteilt: {
    "derselbe Traeger, dieselbe Adresse":
      "Determinismus von assetUrl. Bewacht ist der Gegenwert \"anderer Traeger, andere Adresse\"; eine Sabotage, die bei gleicher Eingabe anders baut, braeuchte Zustand oder Zufall im Bauer, den es nicht gibt.",
  },
};

// ------------------------------------------------------------- Werkzeug

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const mitAlt = process.argv.includes("--alt");
// --zeig: je Sabotage alle roten Proben ausgeben. Fuer den Bau neuer Sabotagen.
const zeig = process.argv.includes("--zeig");
const nurSatz = arg("--satz");

function zeilenende(text) {
  return text.includes(CR + LF) ? CR + LF : LF;
}

function ersetze(lies, liste) {
  const neu = new Map();
  for (const [datei, rohAnker, rohErsatz, anzahl = 1, nr = 1] of liste) {
    if (rohAnker === null) {
      if (existsSync(join(WURZEL, datei))) return { fehler: `${datei}: soll neu entstehen, liegt aber schon` };
      neu.set(datei, rohErsatz);
      continue;
    }
    const text = neu.has(datei) ? neu.get(datei) : lies(datei);
    const eol = zeilenende(text);
    const anker = rohAnker.split(LF).join(eol);
    const ersatz = rohErsatz.split(LF).join(eol);
    const stellen = [];
    let i = text.indexOf(anker);
    while (i >= 0) { stellen.push(i); i = text.indexOf(anker, i + anker.length); }
    if (stellen.length !== anzahl) {
      return { fehler: `${datei}: Anker ${stellen.length}x statt ${anzahl}x: ${rohAnker.slice(0, 70).replace(/\n/g, "\\n")}` };
    }
    const at = stellen[nr - 1];
    neu.set(datei, text.slice(0, at) + ersatz + text.slice(at + anker.length));
  }
  return { neu };
}

// Die laufenden Satzprozesse. Der Signalweg beendet sie vor dem Abraeumen,
// sonst haelt unter Windows ihr Arbeitsordner die Kopie fest (EBUSY).
const kinder = new Set();

function fahre(verzeichnis, datei) {
  return new Promise((ok) => {
    const kind = execFile(process.execPath, ["--no-warnings", datei],
      { cwd: verzeichnis, timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
      (fehler, stdout) => {
        kinder.delete(kind);
        const rot = new Set();
        const gruen = new Set();
        const doppelt = new Set();
        for (const z of String(stdout).split("\n")) {
          if (z.startsWith("  ROT  ")) rot.add(z.slice(7).trim());
          if (z.startsWith("  ok   ")) {
            const n = z.slice(7).trim();
            if (gruen.has(n)) doppelt.add(n);
            gruen.add(n);
          }
        }
        ok({ rc: fehler ? (fehler.code ?? 1) : 0, rot, gruen, doppelt });
      });
    kinder.add(kind);
  });
}

function kopiere(ziel) {
  for (const teil of ["scripts", "lang", "ui", "tools"]) {
    cpSync(join(WURZEL, teil), join(ziel, teil), { recursive: true });
  }
  for (const datei of ["module.json", "package.json"]) {
    if (existsSync(join(WURZEL, datei))) cpSync(join(WURZEL, datei), join(ziel, datei));
  }
}

// ------------------------------------------------------------- --alle-saetze

if (process.argv.includes("--alle-saetze")) {
  const saetze = [];
  for (const ordner of ["scripts/stream", "scripts/loot"]) {
    for (const n of readdirSync(join(WURZEL, ordner)).sort()) {
      if (n.endsWith(".test.mjs")) saetze.push(`${ordner}/${n}`);
    }
  }
  let schlecht = 0;
  for (const s of saetze) {
    const r = await fahre(WURZEL, s);
    if (r.rc !== 0) schlecht += 1;
    console.log(`${s} rc=${r.rc} ok=${r.gruen.size} rot=${r.rot.size}`);
  }
  console.log(`saetze=${saetze.length}, davon rc ungleich 0: ${schlecht}`);
  // Eine Untergrenze wie im Haken: ein neuer Satz bricht die Zahl nicht.
  process.exit(saetze.length >= 12 && schlecht === 0 ? 0 : 1);
}

// ------------------------------------------------------------- Lauf

const SAETZE = ["maske", "geteilt", "bilder", "ersatzbild", "posen", "beute"]
  .filter((s) => !nurSatz || s === nurSatz);
if (SAETZE.length === 0) {
  console.log(`unbekannter Satz: ${nurSatz}`);
  process.exit(2);
}

const PARALLEL = 4;
const kopienNeu = [];
const kopienAlt = [];
let befund = 0;
let nichtPruefbar = 0;
const t0 = Date.now();

// Jede Kopie einzeln: ein EBUSY unter Windows darf die anderen nicht liegen
// lassen. Was bleibt, wird genannt. Zweimal gerufen schadet nicht.
function raeumeAb() {
  for (const d of [...kopienNeu, ...kopienAlt]) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (e) {
      // Windows meldet EBUSY auch dann, wenn das Verzeichnis nur noch zum
      // Loeschen vorgemerkt ist und gleich verschwindet; genannt wird nur,
      // was danach wirklich noch liegt.
      if (existsSync(d)) console.log(`REST nicht abgeraeumt: ${d} (${e && e.code})`);
    }
  }
}
// Ein Abbruch per Strg+C oder SIGTERM ueberspringt `finally`; ohne diese zwei
// Zeilen blieben bis zu acht Kopien von je rund 13 MB im Temp-Verzeichnis
// (Kaltdurchsicht 15.11.2026).
async function abbrechen(rc) {
  const enden = [...kinder].map((k) => new Promise((fertig) => {
    k.once("exit", fertig);
    k.kill();
  }));
  // Ein Kind, das nicht endet, haelt den Abbruch nicht auf.
  await Promise.race([Promise.all(enden), new Promise((r) => setTimeout(r, 3000))]);
  raeumeAb();
  process.exit(rc);
}
process.once("SIGINT", () => { abbrechen(130); });
process.once("SIGTERM", () => { abbrechen(143); });

// Ein rotes Ergebnis verlaesst den Lauf mit `break lauf`, nie mit
// process.exit: das wuerde `finally` ueberspringen und Kopien liegen lassen.
lauf: try {
  // 0. Die Kopien. Jede steht in ihrer Liste, sobald sie angelegt ist, damit
  // `finally` sie auch dann abraeumt, wenn das Kopieren selbst wirft.
  for (let i = 0; i < PARALLEL; i += 1) {
    const d = mkdtempSync(join(tmpdir(), "stream-sabotage-"));
    kopienNeu.push(d);
    kopiere(d);
  }
  if (mitAlt) {
    /*
     * DER ALTE SATZ GEHOERT ZUM ALTEN CODE. Die zwei Naehte aendern Text, den
     * die alten Saetze als Text lesen (gemessen 15.11.2026: der alte
     * stream-geteilt schneidet `vorratsSchluessel` aus dem Quelltext und wird
     * am Nahtstand ohne Sabotage rot). Also liegen die Nahtdateien in der
     * Altkopie im Stand der Basis.
     */
    for (const datei of NAEHTE) {
      basisText[datei] = execFileSync("git", ["-C", WURZEL, "show", `${BASIS}:${datei}`], { encoding: "utf8" });
    }
    for (let i = 0; i < PARALLEL; i += 1) {
      const d = mkdtempSync(join(tmpdir(), "stream-sabotage-alt-"));
      kopienAlt.push(d);
      kopiere(d);
      for (const satz of SAETZE) {
        const alt = execFileSync("git", ["-C", WURZEL, "show", `${BASIS}:${SATZDATEI(satz)}`]);
        writeFileSync(join(d, SATZDATEI(satz)), alt);
      }
      for (const datei of NAEHTE) writeFileSync(join(d, datei), basisText[datei]);
    }
  }

  // 1. Ohne Sabotage gruen, und die Probenliste je Satz.
  const proben = {};
  for (const satz of SAETZE) {
    const r = await fahre(kopienNeu[0], SATZDATEI(satz));
    proben[satz] = r.gruen;
    // Zwei Proben mit einem Namen sind fuer die Deckung eine: wird nur eine rot,
    // gaelten beide als bewacht (Kaltdurchsicht 15.11.2026, maske).
    if (r.doppelt.size > 0) {
      console.log(`NICHT PRUEFBAR: ${satz} traegt doppelte Probennamen: ${[...r.doppelt].join(" | ")}`);
      nichtPruefbar += 1;
    }
    if (r.rc !== 0 || r.rot.size > 0) {
      console.log(`NICHT PRUEFBAR: ${satz} ist schon ohne Sabotage rot (${r.rot.size}).`);
      nichtPruefbar += 1;
    }
    if (mitAlt) {
      const a = await fahre(kopienAlt[0], SATZDATEI(satz));
      if (a.rc !== 0) {
        console.log(`NICHT PRUEFBAR: der alte Satz ${satz} ist schon ohne Sabotage rot.`);
        nichtPruefbar += 1;
      }
    }
  }
  if (nichtPruefbar > 0) break lauf;

  // 2. Die Sabotagen, verteilt auf die Kopien.
  const auftraege = SABOTAGEN.map((s, nr) => ({ ...s, nr: nr + 1 })).filter((s) => SAETZE.includes(s.satz));
  const ergebnisse = [];
  let naechster = 0;
  const lies = (datei) => readFileSync(join(WURZEL, datei), "utf8");
  const liesAlt = (datei) => (datei in basisText ? basisText[datei] : lies(datei));
  async function arbeiter(i) {
    while (naechster < auftraege.length) {
      const s = auftraege[naechster];
      naechster += 1;
      const e = ersetze(lies, s.ersetze);
      if (e.fehler) { ergebnisse.push({ s, fehler: e.fehler }); continue; }
      for (const [datei, text] of e.neu) writeFileSync(join(kopienNeu[i], datei), text);
      const r = await fahre(kopienNeu[i], SATZDATEI(s.satz));
      for (const datei of e.neu.keys()) {
        if (existsSync(join(WURZEL, datei))) writeFileSync(join(kopienNeu[i], datei), lies(datei));
        else rmSync(join(kopienNeu[i], datei), { force: true });
      }
      // Der alte Satz bekommt dieselbe Sabotage, angewandt auf SEINEN Stand der
      // Nahtdateien. Fehlt der Anker dort, ist die Luecke nicht belegbar.
      let a = null;
      if (mitAlt && s.luecke) {
        const ea = ersetze(liesAlt, s.ersetze);
        if (ea.fehler) a = { fehlerAlt: ea.fehler };
        else {
          for (const [datei, text] of ea.neu) writeFileSync(join(kopienAlt[i], datei), text);
          a = await fahre(kopienAlt[i], SATZDATEI(s.satz));
          for (const datei of ea.neu.keys()) {
            if (existsSync(join(WURZEL, datei))) writeFileSync(join(kopienAlt[i], datei), liesAlt(datei));
            else rmSync(join(kopienAlt[i], datei), { force: true });
          }
        }
      }
      ergebnisse.push({ s, r, a });
    }
  }
  await Promise.all(kopienNeu.map((_, i) => arbeiter(i)));
  ergebnisse.sort((x, y) => x.s.nr - y.s.nr);

  const bewacht = Object.fromEntries(SAETZE.map((s) => [s, new Set()]));
  const altGruen = Object.fromEntries(SAETZE.map((s) => [s, 0]));
  const luecken = Object.fromEntries(SAETZE.map((s) => [s, 0]));
  for (const { s, fehler, r, a } of ergebnisse) {
    const kopf = `S${String(s.nr).padStart(3, "0")} ${s.satz}`;
    if (fehler) {
      console.log(`  NICHT PRUEFBAR ${kopf}: ${fehler}`);
      nichtPruefbar += 1;
      continue;
    }
    if (zeig) console.log(`  ${kopf} rc ${r.rc} rot: ${[...r.rot].join(" | ")}`);
    // Ein Ziel muss eine Probe des ungestoerten Satzes sein. Traegt ein
    // Probenname einen Wert, den die Sabotage aendert, heisst die rote Probe
    // anders als die gruene, und das Ziel bewachte nichts.
    const fremdeZiele = s.ziel.filter((n) => !proben[s.satz].has(n));
    if (fremdeZiele.length > 0) {
      befund += 1;
      console.log(`  BEFUND ${kopf}: Ziel ist keine Probe des Satzes: ${fremdeZiele.join(" | ")}`);
    }
    // Ein Satz, der abbricht, ohne eine Probe rot zu melden, zeigt keine
    // Wirkung, sondern einen Absturz (gemessen an stream-geteilt, 14.11.2026:
    // `.match(...).length` auf null).
    if (r.rc !== 0 && r.rot.size === 0) {
      befund += 1;
      console.log(`  BEFUND ${kopf}: rc ${r.rc} ohne rote Probe, der Satz bricht ab`);
    }
    for (const n of s.ziel) if (r.rot.has(n) && proben[s.satz].has(n)) bewacht[s.satz].add(n);
    const verfehlt = s.ziel.filter((z) => !r.rot.has(z));
    if (r.rc === 0 || verfehlt.length > 0) {
      befund += 1;
      console.log(`  BEFUND ${kopf}: rc ${r.rc}, Ziel nicht rot: ${verfehlt.join(" | ") || "(rc 0)"}`);
    }
    if (a && a.fehlerAlt) {
      luecken[s.satz] += 1;
      nichtPruefbar += 1;
      console.log(`  NICHT PRUEFBAR ${kopf}: im alten Stand ${a.fehlerAlt}`);
    } else if (a) {
      luecken[s.satz] += 1;
      if (a.rc === 0) altGruen[s.satz] += 1;
      else {
        befund += 1;
        console.log(`  BEFUND ${kopf}: als Luecke markiert, aber der alte Satz wird rot (${[...a.rot].slice(0, 2).join(" | ")})`);
      }
    }
  }

  // 3. Jede Probe als Ziel einer Sabotage rot.
  console.log("");
  for (const satz of SAETZE) {
    const eigen = EIGENPROBEN[satz] || {};
    const alle = [...proben[satz]];
    const unbewacht = alle.filter((n) => !bewacht[satz].has(n) && !(n in eigen));
    const art = (p) => alle.filter((n) => n.startsWith(p)).length;
    const zahlSab = auftraege.filter((s) => s.satz === satz).length;
    const alt = mitAlt ? `, alt gruen ${altGruen[satz]} von ${luecken[satz]} Luecken` : "";
    console.log(`${satz}: ${alle.length} Proben (Struktur ${art("[Struktur] ")}, Dokument ${art("[Dokument] ")}), `
      + `${bewacht[satz].size} per Sabotage rot belegt, ${Object.keys(eigen).length} Eigenprobe(n), `
      + `${unbewacht.length} unbewacht, ${zahlSab} Sabotagen${alt}`);
    for (const n of unbewacht) {
      befund += 1;
      console.log(`  UNBEWACHT ${n}`);
    }
  }
} finally {
  raeumeAb();
}

console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s, Befunde ${befund}, nicht pruefbar ${nichtPruefbar}`);
process.exit(nichtPruefbar > 0 ? 2 : (befund > 0 ? 1 : 0));
