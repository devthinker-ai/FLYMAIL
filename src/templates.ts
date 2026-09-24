import { CATEGORIES, type Category } from "./constants";

export interface TemplateSlots {
  name: string;
  subjectRef: string;
  detail: string;
  question: string;
  signoff: string;
}

interface Template {
  lang: "en" | "de";
  body: string;
}

const TEMPLATES: Record<Category, Template[]> = {
  payment: [
    {
      lang: "en",
      body: "Hi [name],\n\nGot it — payment noted regarding \"[subject-ref]\". I've filed [detail] on our side. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hello [name],\n\nThanks for the confirmation regarding your note about \"[subject-ref]\". [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hi [name],\n\nAcknowledging receipt of payment re: \"[subject-ref]\". [detail]. No chase needed unless something else pops up. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "[name] — payment for \"[subject-ref]\" is on the record. [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Hallo [name],\n\nvielen Dank für die Zahlungsbestätigung zu Ihrer Nachricht „[subject-ref]“. [detail] ist bei uns vermerkt. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Guten Tag [name],\n\nwir haben die Zahlung zu Ihrer Nachricht „[subject-ref]“ erhalten. [detail]. [question]\n\n[signoff]",
    },
  ],
  receipt: [
    {
      lang: "en",
      body: "Hi [name],\n\nThanks — receipt regarding \"[subject-ref]\" filed. [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hello [name],\n\nGot the purchase note about \"[subject-ref]\". [detail]. Keeping it with the books. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hi [name],\n\nReceipt logged for \"[subject-ref]\". [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "[name] — thanks for sending \"[subject-ref]\". [detail]. All set on my end. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Hallo [name],\n\ndanke für den Beleg zu Ihrer Nachricht „[subject-ref]“. [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Guten Tag [name],\n\nden Kaufbeleg für „[subject-ref]“ habe ich abgelegt. [detail]. [question]\n\n[signoff]",
    },
  ],
  digest: [
    {
      lang: "en",
      body: "Hi [name],\n\nThanks for \"[subject-ref]\" — skimmed it. [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hello [name],\n\nAppreciate the digest (\"[subject-ref]\"). [detail]. Quietly useful. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hi [name],\n\nOne-line thanks for \"[subject-ref]\". [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "[name] — noted \"[subject-ref]\". [detail]. Back to work. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Hallo [name],\n\ndanke für „[subject-ref]“. [detail]. Kurz gelesen, gut so. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Guten Tag [name],\n\nvielen Dank für den Newsletter („[subject-ref]“). [detail]. [question]\n\n[signoff]",
    },
  ],
  meeting: [
    {
      lang: "en",
      body: "Hi [name],\n\nHappy to meet about \"[subject-ref]\". [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hello [name],\n\nThanks for reaching out regarding \"[subject-ref]\". [detail]. Please send a calendar hold for a slot that works. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hi [name],\n\nI can do a short sync on \"[subject-ref]\". [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "[name] — yes on \"[subject-ref]\". [detail]. Reply with two times and I'll lock one. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Hallo [name],\n\ngerne sprechen wir über „[subject-ref]“. [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Guten Tag [name],\n\nvielen Dank für die Anfrage zu „[subject-ref]“. [detail]. Bitte sende zwei Terminvorschläge. [question]\n\n[signoff]",
    },
  ],
  complaint: [
    {
      lang: "en",
      body: "Hi [name],\n\nI'm sorry about \"[subject-ref]\". That's on us. [detail]. I'm prioritizing a fix and will update you today. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hello [name],\n\nThank you for flagging \"[subject-ref]\". [detail]. I understand the frustration — we'll make this right. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hi [name],\n\nApologies for the delay around \"[subject-ref]\". [detail]. Escalating now and owning the follow-up. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "[name] — sorry you had to chase on \"[subject-ref]\". [detail]. You'll hear from me with a concrete next step shortly. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Hallo [name],\n\nes tut mir leid zu Ihrer Nachricht „[subject-ref]“. [detail]. Ich kümmere mich persönlich darum und melde mich noch heute. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Guten Tag [name],\n\nvielen Dank für Ihre Nachricht „[subject-ref]“. [detail]. Entschuldigung für die Verzögerung — wir korrigieren das. [question]\n\n[signoff]",
    },
  ],
  personal: [
    {
      lang: "en",
      body: "Hi [name],\n\nNice to hear from you about \"[subject-ref]\". [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hey [name],\n\nThanks for \"[subject-ref]\". [detail]. Would love to catch up properly soon. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "Hi [name],\n\n\"[subject-ref]\" made me smile. [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "en",
      body: "[name] — got your note on \"[subject-ref]\". [detail]. Talk soon. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Hallo [name],\n\nschön von dir zu lesen („[subject-ref]“). [detail]. [question]\n\n[signoff]",
    },
    {
      lang: "de",
      body: "Hey [name],\n\ndanke für „[subject-ref]“. [detail]. Melde mich bald. [question]\n\n[signoff]",
    },
  ],
};

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function firstName(from: string): string {
  const part = from.split(/[\s,<]/)[0] ?? from;
  return part || "there";
}

function fillSlots(tpl: string, slots: TemplateSlots): string {
  return tpl
    .replaceAll("[name]", slots.name)
    .replaceAll("[subject-ref]", slots.subjectRef)
    .replaceAll("[detail]", slots.detail)
    .replaceAll("[question]", slots.question)
    .replaceAll("[signoff]", slots.signoff);
}

const DETAIL_BY_CAT: Record<Category, { en: string; de: string }> = {
  payment: {
    en: "The ledger entry matches what you sent",
    de: "Der Buchungseintrag stimmt mit Ihrer Angabe überein",
  },
  receipt: {
    en: "Amount and order id are on file",
    de: "Betrag und Bestellnummer sind notiert",
  },
  digest: {
    en: "Parked in the reading pile",
    de: "Liegt auf dem Lesestapel",
  },
  meeting: {
    en: "I'm holding a flexible 30-minute window mid-week",
    de: "Ich halte Mitte der Woche 30 Minuten flexibel frei",
  },
  complaint: {
    en: "I've opened an internal follow-up so this doesn't stall again",
    de: "Ich habe intern nachgefasst, damit das nicht wieder liegen bleibt",
  },
  personal: {
    en: "No work agenda on this one",
    de: "Kein Arbeitsthema diesmal",
  },
};

const QUESTION_BY_CAT: Record<Category, { en: string; de: string }> = {
  payment: {
    en: "Anything else to attach to this invoice?",
    de: "Soll noch etwas zu dieser Rechnung?",
  },
  receipt: {
    en: "Need a PDF copy resent?",
    de: "Brauchen Sie den Beleg noch einmal als PDF?",
  },
  digest: {
    en: "Want me to pull out one item next week?",
    de: "Soll ich nächste Woche einen Punkt herausziehen?",
  },
  meeting: {
    en: "Which of your slots is firmest?",
    de: "Welcher Ihrer Termine steht fest?",
  },
  complaint: {
    en: "Is there a hard deadline I should treat as binding?",
    de: "Gibt es eine harte Frist, die ich einhalten muss?",
  },
  personal: {
    en: "When works for a quick reply call?",
    de: "Wann passt ein kurzer Rückruf?",
  },
};

/**
 * Pick a prewritten template by deterministic hash of (email.id + category).
 * The brain decides WHICH category; templates supply the words.
 */
export function renderReply(
  email: {
    id: string;
    from: string;
    subject: string;
    lang?: string;
  },
  category: Category,
): { text: string; templateIndex: number } {
  const lang = email.lang === "de" ? "de" : "en";
  const pool = TEMPLATES[category].filter((t) => t.lang === lang);
  const use = pool.length > 0 ? pool : TEMPLATES[category];
  const idx = fnv1a(`${email.id}|${category}`) % use.length;
  const tpl = use[idx]!;

  const slots: TemplateSlots = {
    name: firstName(email.from),
    subjectRef: email.subject.length > 60 ? email.subject.slice(0, 57) + "…" : email.subject,
    detail: DETAIL_BY_CAT[category][lang],
    question: QUESTION_BY_CAT[category][lang],
    signoff: lang === "de" ? "Viele Grüße\nFLYMAIL" : "Best,\nFLYMAIL",
  };

  return { text: fillSlots(tpl.body, slots), templateIndex: idx };
}

export function categoryFromIndex(i: number): Category {
  return CATEGORIES[((i % CATEGORIES.length) + CATEGORIES.length) % CATEGORIES.length]!;
}
