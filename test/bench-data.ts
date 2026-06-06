/**
 * SpeechActMemBench — labeled utterances across EN/HE/RU/RO.
 *
 * Each row: a user utterance + whether a memory system SHOULD store it as a
 * personal fact (`store: true`) or must NOT (`store: false`). The hard cases are
 * questions and hypotheticals that *contain* fact-like content — the exact
 * sentences extract-then-store systems get wrong.
 *
 * 60 utterances. Honest size: enough to be a real regression suite and to make
 * the gate-vs-naive gap unmistakable; not a research-grade corpus. Extend freely.
 */

import type { Lang } from "../src/speech-act.ts";

export interface BenchRow {
  text: string;
  lang: Lang;
  /** ground truth: should this become a stored personal FACT? */
  store: boolean;
  note: string;
}

export const BENCH: BenchRow[] = [
  // ── EN: clear stores ──
  { text: "I live in Bucharest.", lang: "en", store: true, note: "first-person fact" },
  { text: "My son's name is Demian.", lang: "en", store: true, note: "first-person fact" },
  { text: "I started a new job at an AI company.", lang: "en", store: true, note: "first-person event" },
  { text: "I prefer dark roast coffee.", lang: "en", store: true, note: "preference" },
  { text: "I'm allergic to hazelnuts.", lang: "en", store: true, note: "critical health fact" },
  { text: "We moved into the villa last month.", lang: "en", store: true, note: "first-person event" },

  // ── EN: questions that LOOK like facts (the headline trap) ──
  { text: "What stage of my cycle am I at?", lang: "en", store: false, note: "question, not a report" },
  { text: "Do I have a meeting tomorrow?", lang: "en", store: false, note: "question" },
  { text: "Am I allergic to hazelnuts?", lang: "en", store: false, note: "question about a fact" },
  { text: "Which day is best for the dentist?", lang: "en", store: false, note: "question" },
  { text: "Where do I live again?", lang: "en", store: false, note: "question" },
  { text: "How many days until my flight?", lang: "en", store: false, note: "question" },

  // ── EN: hypotheticals / wishes ──
  { text: "If I moved to Thailand, what would change?", lang: "en", store: false, note: "hypothetical" },
  { text: "I wish I lived by the sea.", lang: "en", store: false, note: "wish, not fact" },
  { text: "Maybe I'll quit my job someday.", lang: "en", store: false, note: "speculation" },
  { text: "Imagine I had a Mac Mini M5.", lang: "en", store: false, note: "imagined scenario" },

  // ── EN: commands to the assistant ──
  { text: "Remind me to call the accountant.", lang: "en", store: false, note: "command, not a fact" },
  { text: "Remember that I like dark coffee.", lang: "en", store: true, note: "explicit memorize directive about a real preference" },
  { text: "Show me my tasks.", lang: "en", store: false, note: "command" },
  { text: "Delete the note about the gym.", lang: "en", store: false, note: "command" },

  // ── EN: negations / corrections ──
  { text: "I no longer work at the old company.", lang: "en", store: false, note: "negation → contradict prior, not new fact" },
  { text: "No, I don't drink coffee anymore.", lang: "en", store: false, note: "negation/correction" },

  // ── EN: third-party ──
  { text: "My wife is studying for an exam.", lang: "en", store: false, note: "third-party, not a self-fact" },
  { text: "Elena prefers tea.", lang: "en", store: false, note: "claim about someone else" },

  // ── HE: stores ──
  { text: "אני גר בבוקרשט.", lang: "he", store: true, note: "first-person fact" },
  { text: "קיבלתי את המחזור היום.", lang: "he", store: true, note: "first-person report (the original prod case)" },
  { text: "אני אוהב קפה שחור.", lang: "he", store: true, note: "preference" },
  { text: "התחלתי עבודה חדשה.", lang: "he", store: true, note: "first-person event" },

  // ── HE: questions ──
  { text: "באיזה שלב של המחזור אני?", lang: "he", store: false, note: "question, not report (the bug)" },
  { text: "מתי יש לי פגישה?", lang: "he", store: false, note: "question" },
  { text: "איזה יום הכי טוב?", lang: "he", store: false, note: "question" },
  { text: "כמה ימים נשארו לטיסה?", lang: "he", store: false, note: "question" },

  // ── HE: hypothetical / command / third-party ──
  { text: "אם הייתי גר בתאילנד...", lang: "he", store: false, note: "hypothetical" },
  { text: "תזכיר לי להתקשר לרואה החשבון.", lang: "he", store: false, note: "command" },
  { text: "אשתי לומדת למבחן.", lang: "he", store: false, note: "third-party" },
  { text: "לא, כבר לא.", lang: "he", store: false, note: "negation" },

  // ── RU: stores ──
  { text: "Я живу в Бухаресте.", lang: "ru", store: true, note: "first-person fact" },
  { text: "Я начал новую работу.", lang: "ru", store: true, note: "first-person event" },
  { text: "Я люблю чёрный кофе.", lang: "ru", store: true, note: "preference" },
  { text: "У меня аллергия на фундук.", lang: "ru", store: true, note: "health fact" },

  // ── RU: questions ──
  { text: "На какой стадии цикла я нахожусь?", lang: "ru", store: false, note: "question" },
  { text: "Когда у меня встреча?", lang: "ru", store: false, note: "question" },
  { text: "Сколько дней до рейса?", lang: "ru", store: false, note: "question" },
  { text: "Где я живу?", lang: "ru", store: false, note: "question" },

  // ── RU: hypothetical / command / negation / third-party ──
  { text: "Если бы я переехал в Таиланд...", lang: "ru", store: false, note: "hypothetical" },
  { text: "Напомни мне позвонить бухгалтеру.", lang: "ru", store: false, note: "command" },
  { text: "Я больше не пью кофе.", lang: "ru", store: false, note: "negation" },
  { text: "Моя жена готовится к экзамену.", lang: "ru", store: false, note: "third-party" },

  // ── RO: stores ──
  { text: "Locuiesc în București.", lang: "ro", store: true, note: "first-person fact" },
  { text: "Am început un job nou.", lang: "ro", store: true, note: "first-person event" },
  { text: "Prefer cafeaua neagră.", lang: "ro", store: true, note: "preference" },
  { text: "Sunt alergic la alune.", lang: "ro", store: true, note: "health fact" },

  // ── RO: questions ──
  { text: "În ce etapă a ciclului sunt?", lang: "ro", store: false, note: "question" },
  { text: "Când am o întâlnire?", lang: "ro", store: false, note: "question" },
  { text: "Câte zile până la zbor?", lang: "ro", store: false, note: "question" },
  { text: "Unde locuiesc?", lang: "ro", store: false, note: "question" },

  // ── RO: hypothetical / command / negation / third-party ──
  { text: "Dacă m-aș muta în Thailanda...", lang: "ro", store: false, note: "hypothetical" },
  { text: "Amintește-mi să sun contabilul.", lang: "ro", store: false, note: "command" },
  { text: "Nu mai beau cafea.", lang: "ro", store: false, note: "negation" },
  { text: "Soția mea învață pentru un examen.", lang: "ro", store: false, note: "third-party" },
];
