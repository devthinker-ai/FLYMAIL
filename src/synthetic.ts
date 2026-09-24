/**
 * Deterministic synthetic labeled email variants for readout training.
 * Template bodies with swapped amounts/names/subjects; category fixed.
 */
import type { Category } from "./constants";
import { mulberry32 } from "./driver";
import inbox from "./inbox.json";

export interface TrainEmail {
  id: string;
  from: string;
  address: string;
  subject: string;
  body: string;
  lang: string;
  category: Category;
  synthetic: boolean;
}

const NAMES_EN = ["Alex", "Sam", "Jordan", "Priya", "Chris", "Morgan", "Leila", "Maya"];
const NAMES_DE = ["Nina", "Tobias", "Jonas", "Anna", "Lukas", "Sara"];
const AMOUNTS = ["$12.40", "$29.10", "$89.00", "$240.00", "€18,50", "€420,00", "$3,102.44"];
const ORDERS = ["INV-1001", "INV-44821", "RE-9021", "CS-77821", "BL-1902", "HWC-4410", "#88412"];

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]!;
}

export function buildTrainingCorpus(nSynthetic = 96): TrainEmail[] {
  const base: TrainEmail[] = (inbox as TrainEmail[]).map((e) => ({
    ...e,
    category: e.category as Category,
    synthetic: false,
  }));

  const rng = mulberry32(0xc0ffee42);
  const out: TrainEmail[] = [...base];
  const cats = ["payment", "receipt", "digest", "meeting", "complaint", "personal"] as Category[];

  for (let i = 0; i < nSynthetic; i++) {
    const cat = cats[i % cats.length]!;
    const lang = i % 7 === 0 ? "de" : "en";
    const name = pick(rng, lang === "de" ? NAMES_DE : NAMES_EN);
    const amount = pick(rng, AMOUNTS);
    const order = pick(rng, ORDERS);
    const id = `syn-${String(i).padStart(3, "0")}-${cat}`;

    let subject = "";
    let body = "";
    let from = name;

    switch (cat) {
      case "payment":
        subject =
          lang === "de"
            ? `Zahlungsbestätigung — ${order}`
            : `Payment confirmation — ${order}`;
        body =
          lang === "de"
            ? `Guten Tag,\n\nwir haben Ihre Zahlung über ${amount} für ${order} erhalten.\n\nBuchhaltung`
            : `We've received your payment of ${amount} for ${order}. Cleared today.`;
        from = lang === "de" ? "Buchhaltung" : "Billing Desk";
        break;
      case "receipt":
        subject =
          lang === "de"
            ? `Kaufbeleg — ${order}`
            : `Receipt for your purchase — ${amount}`;
        body =
          lang === "de"
            ? `Danke für Ihren Einkauf.\n\nBetrag: ${amount}\nBestellung ${order}`
            : `Thanks for your purchase.\n\nAmount: ${amount}\nOrder ${order}`;
        from = "Store Receipts";
        break;
      case "digest":
        subject =
          lang === "de" ? `Wöchentlicher Newsletter #${100 + i}` : `Weekly digest #${100 + i}`;
        body =
          lang === "de"
            ? `Ausgabe diese Woche: drei Links und eine kurze Notiz. Abmelden jederzeit.`
            : `This week: three links and a short note. Unsubscribe anytime.`;
        from = "Weekly Digest";
        break;
      case "meeting":
        subject =
          lang === "de" ? `Terminfindung mit ${name}` : `Can we meet, ${name}?`;
        body =
          lang === "de"
            ? `Hallo,\n\nhättest du am Dienstag oder Donnerstag 30 Minuten Zeit?\n\n${name}`
            : `Hi — free Tuesday or Thursday for 30 minutes?\n\n— ${name}`;
        from = name;
        break;
      case "complaint":
        subject =
          lang === "de"
            ? `Immer noch keine Antwort — ${order}`
            : `Still waiting — ticket ${order}`;
        body =
          lang === "de"
            ? `Seit Tagen keine Rückmeldung zu ${order}. Das ist inakzeptabel. Bitte heute noch Bescheid.`
            : `No reply on ${order} for days. This is unacceptable. I need an answer today.`;
        from = name;
        break;
      case "personal":
        subject = lang === "de" ? `Kaffee bald?` : `Coffee this weekend?`;
        body =
          lang === "de"
            ? `Hey,\n\nhast du Sonntag Zeit? Kein Arbeitsthema.\n\n${name}`
            : `Hey — free Sunday? No work agenda.\n\n— ${name}`;
        from = name;
        break;
    }

    out.push({
      id,
      from,
      address: `${name.toLowerCase()}@synth.example`,
      subject,
      body,
      lang,
      category: cat,
      synthetic: true,
    });
  }

  return out;
}
