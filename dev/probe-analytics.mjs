// Probe der reinen Funktionen aus beneos_analytics.js, ohne Foundry.
//
// Aufruf: node dev/probe-analytics.mjs
//
// Der Quelltext wird gelesen und die geprueften Methoden werden daraus
// herausgeschnitten. Absicht: die Probe prueft genau das, was im Modul steht,
// und keine Kopie davon, die auseinanderlaufen kann.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Relativ zur eigenen Lage, damit die Probe in jedem Arbeitsbaum laeuft.
const hier = dirname(fileURLToPath(import.meta.url));

// Zeilenenden werden vereinheitlicht. Das Repo fuehrt CRLF, und das
// Herausschneiden unten sucht nach einer schliessenden Klammer am Zeilenanfang;
// ohne diese Vereinheitlichung findet es nichts, und die Probe scheitert an
// sich selbst statt am Modul.
const quelle = readFileSync(
  join(hier, "..", "scripts", "beneos_analytics.js"), "utf8")
  .replace(/\r\n/g, "\n");

function methode(name) {
  const i = quelle.indexOf(`  static ${name}(`);
  if (i < 0) throw new Error(`${name} nicht gefunden`);
  const ende = quelle.indexOf("\n  }\n", i);
  if (ende < 0) throw new Error(`Ende von ${name} nicht gefunden`);
  return quelle.slice(i, ende + 5).replace(/^\s*static /, "");
}

const K = new Function(`
  return class T {
    static PAYLOAD_MAX = 1000
    static sanitize(s, max = 200) { return String(s ?? "").slice(0, max) }
    static ${methode("_shrink")}
    static ${methode("_splitStackPackages")}
  }
`)();

let fehler = 0;
const pruefe = (was, ist, soll) => {
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b) { console.log(`FEHLER  ${was}\n  ist:  ${a}\n  soll: ${b}`); fehler++; }
  else console.log(`ok      ${was}`);
};

// ---------------------------------------------------------------------------
// _splitStackPackages
//
// Foundry haengt die Paketzuordnung aus dem Stapel an die Fehlermeldung. Sie
// muss abgetrennt werden, weil die Kappung bei 200 Zeichen sonst genau sie
// frisst: gemessen bei 297 von 2.158 Fehlern im Data Lake.
// ---------------------------------------------------------------------------
pruefe("geschlossene Liste wird abgetrennt",
  K._splitStackPackages("Cannot read x [Detected 2 packages: a(1), b(2)]"),
  { message: "Cannot read x", packages: "[Detected 2 packages: a(1), b(2)]" });

pruefe("abgeschnittene Liste wird abgetrennt",
  K._splitStackPackages("Cannot read x [Detected 2 packages: beneos-mod"),
  { message: "Cannot read x", packages: "[Detected 2 packages: beneos-mod" });

pruefe("Meldung ohne Liste bleibt unberuehrt",
  K._splitStackPackages("hasProperty is not defined"),
  { message: "hasProperty is not defined", packages: null });

pruefe("leere Eingabe",
  K._splitStackPackages(null), { message: "", packages: null });

// ---------------------------------------------------------------------------
// _shrink
//
// Die Kappung verwarf bisher die GANZE Nutzlast und ersetzte sie durch eine
// Fahne. Gemessen: 229 von 13.561 Gruppenabbildern und 476 von 751
// Inventarbloecken kamen inhaltsleer an.
// ---------------------------------------------------------------------------
const gross = {
  system_id: "dnd5e", party_size: 6, party_avg_level: 5.5,
  pc_actor_type: "character", pc_sheet: "ActorSheet5eCharacter2",
  party_classes: Array.from({ length: 60 },
    (_, i) => ({ class_id: "Cleric" + i, level: 5 })),
  owned_actor_types: [{ type: "character", n: 6 }]
};
const klein = K._shrink(gross);

pruefe("Skalare bleiben vollstaendig erhalten",
  [klein.system_id, klein.party_size, klein.party_avg_level, klein.pc_sheet],
  ["dnd5e", 6, 5.5, "ActorSheet5eCharacter2"]);
pruefe("als geschrumpft gekennzeichnet", klein._shrunk, true);
pruefe("passt unter die Grenze", JSON.stringify(klein).length <= 1000, true);
pruefe("die verworfenen Klassen sind gezaehlt",
  typeof klein.party_classes_dropped === "number"
  && klein.party_classes_dropped > 0, true);
pruefe("die Zahl geht auf",
  (klein.party_classes?.length || 0) + klein.party_classes_dropped, 60);
pruefe("die kleine Liste bleibt ganz",
  klein.owned_actor_types, [{ type: "character", n: 6 }]);

// Nutzlast, die schon ohne Listen zu gross ist: dann die ehrliche Fahne.
pruefe("aussichtsloser Fall bleibt gekennzeichnet",
  K._shrink({ text: "x".repeat(2000) }), { _truncated: true });

pruefe("kleine Nutzlast bleibt inhaltlich gleich",
  K._shrink({ a: 1, b: [1, 2, 3] }).b, [1, 2, 3]);

// ---------------------------------------------------------------------------
// Die Zahl verbundener Spieler
// ---------------------------------------------------------------------------
//
// Sie entscheidet, ob eine Szenenzeit eine Spielrunde war oder eine
// Vorbereitung. Zwei Dinge muessen stimmen: der Spielleiter zaehlt NICHT mit,
// sonst ergibt jede Vorbereitung eine Eins und ist von einer Runde mit einem
// Spieler nicht zu unterscheiden. Und ohne `game` kommt null zurueck und nicht
// null die Zahl: das eine heisst nicht ermittelbar, das andere niemand da.
const S = new Function(`
  return class T {
    static ${methode("_connectedPlayers")}
  }
`)();

const mitUsern = (liste) => { globalThis.game = { users: liste }; return S._connectedPlayers(); };

pruefe("der Spielleiter zaehlt nicht mit",
  mitUsern([{ active: true, isGM: true }, { active: true, isGM: false }]), 1);
pruefe("allein am Tisch ist eine Null und keine Luecke",
  mitUsern([{ active: true, isGM: true }]), 0);
pruefe("abgemeldete Spieler zaehlen nicht",
  mitUsern([{ active: false, isGM: false }, { active: true, isGM: false }]), 1);
pruefe("eine echte Runde",
  mitUsern([{ active: true, isGM: true }, { active: true, isGM: false },
            { active: true, isGM: false }, { active: true, isGM: false }]), 3);

globalThis.game = undefined;
pruefe("ohne Foundry kommt null und nicht die Zahl null",
  S._connectedPlayers(), null);

// ---------------------------------------------------------------------------
// Szene zu Asset
// ---------------------------------------------------------------------------
//
// Aus derselben Datei geschnitten wie oben, damit die Probe nicht eine Kopie
// prueft. Eine unbekannte Szene muss "" liefern und nicht undefined: der
// Sender laesst das Feld dann weg, und genau das soll geschehen. Eine leere
// Kennung im Ereignis wuerde behaupten, die Szene habe kein Asset, obwohl die
// Wahrheit lautet, dass diese Welt vor dem Setting installiert hat.
const zustand = readFileSync(
  join(hier, "..", "scripts", "cloud-v2", "beneos-install-state.mjs"), "utf8")
  .replace(/\r\n/g, "\n");

const zustandsMethode = (name) => {
  const i = zustand.indexOf(`  static ${name}(`);
  if (i < 0) throw new Error(`${name} nicht gefunden`);
  const ende = zustand.indexOf("\n  }\n", i);
  return zustand.slice(i, ende + 5).replace(/^\s*static /, "");
};

const Z = new Function(`
  return class T {
    static _daten = {}
    static getAll() { return this._daten }
    static ${zustandsMethode("findAssetIdByScene")}
  }
`)();

Z._daten = {
  "bm_0005_cos_the_death_house": {
    releaseDir: "bm_0005_cos_the_death_house", assetId: "6a3a4c16ea600",
    sceneIds: ["abc123", "def456"]
  },
  "bm_0011_cos_barovia_4k": {
    releaseDir: "bm_0011_cos_barovia", variant: "4k", assetId: "6a3a5000aaaa",
    sceneIds: ["ghi789"]
  }
};

pruefe("bekannte Szene findet ihr Asset", Z.findAssetIdByScene("def456"), "6a3a4c16ea600");
pruefe("zweite Ablage wird auch durchsucht", Z.findAssetIdByScene("ghi789"), "6a3a5000aaaa");
pruefe("unbekannte Szene liefert leer und nicht undefined",
  Z.findAssetIdByScene("gibtesnicht"), "");
pruefe("ohne Szenenkennung leer", Z.findAssetIdByScene(null), "");

Z._daten = { kaputt: null, auchKaputt: { assetId: "x" } };
pruefe("beschaedigte Eintraege werfen nicht",
  Z.findAssetIdByScene("abc123"), "");

console.log(fehler ? `\n${fehler} Proben gescheitert` : "\nAlle Proben bestanden");
process.exit(fehler ? 1 : 0);
