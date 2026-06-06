/**
 * speech-act.ts — the ingest gate.
 *
 * The single idea this whole library exists for: before you store a sentence as a
 * remembered FACT, classify what kind of speech act it is. A question is not a fact.
 * A hypothetical is not a fact. A third-party report is not a first-person fact.
 *
 * Every mainstream memory layer (mem0, Zep/Graphiti, Letta, Cognee, Memory-OS) is
 * extract-then-store: it runs an extractor over the turn and writes whatever comes
 * out. None of them ask "is this even an assertion the user is making about
 * themselves?" — so they happily store "what stage of my cycle am I at?" as the
 * fact "user's cycle is at stage X." That is the bug this gate kills.
 *
 * This is a generalization of a gate running in production since 2026-06-05
 * (the original guarded one domain — menstrual-cycle reports — in EN+HE; this
 * version is domain-agnostic and covers EN / HE / RU / RO).
 *
 * Zero dependencies. Pure functions. Deterministic. ~1µs per call.
 */

export type SpeechAct =
  | "stated"        // first-person assertion of fact/preference/event  → STORABLE
  | "question"      // interrogative / phase look-up                    → DROP
  | "hypothetical"  // conditional / wish / imagined scenario           → DROP
  | "thirdparty"    // a claim ABOUT someone else, not the speaker      → store as low-trust, never as a self-fact
  | "negation"      // explicit denial / correction                    → store as a CONTRADICTION signal
  | "command";      // imperative directed at the assistant             → DROP

export type Lang = "en" | "he" | "ru" | "ro";

export interface Classification {
  act: SpeechAct;
  /** 0..1 — how sure the classifier is. Drives the Beta update strength downstream. */
  confidence: number;
  /** which rule fired, for debugging / audit trails */
  reason: string;
  lang: Lang;
}

// ---------------------------------------------------------------------------
// Language detection (cheap script + stopword heuristic — good enough to pick
// the right rule set; not a full langid).
// ---------------------------------------------------------------------------

export function detectLang(text: string): Lang {
  const t = text || "";
  if (/[֐-׿]/.test(t)) return "he";          // Hebrew block
  if (/[Ѐ-ӿ]/.test(t)) return "ru";          // Cyrillic block
  // Romanian: diacritics or common stopwords. Checked before defaulting to EN.
  if (/[ăâîșțĂÂÎȘȚ]/.test(t)) return "ro";
  if (/\b(?:sunt|este|nu|să|și|pentru|mâine|astăzi|vreau|am)\b/i.test(t)) return "ro";
  return "en";
}

// ---------------------------------------------------------------------------
// Rule tables, per language. Order matters: questions/commands are checked
// before "stated" so an interrogative that also contains a first-person verb
// ("do I have a meeting tomorrow?") is correctly dropped.
// ---------------------------------------------------------------------------

interface RuleSet {
  question: RegExp;
  hypothetical: RegExp;
  negation: RegExp;
  command: RegExp;
  firstPerson: RegExp;   // signals a self-assertion ("I am", "my X is")
  thirdParty: RegExp;    // signals a claim about someone else
}

const RULES: Record<Lang, RuleSet> = {
  en: {
    question:
      /\?|^\s*(?:what|when|where|which|who|whom|whose|why|how|do|does|did|is|are|was|were|will|would|should|could|can|may|might|have|has|am)\b|\b(?:what|which)\s+(?:stage|phase|day|time)\b|\bam\s+i\b/i,
    hypothetical:
      /\b(?:if|suppose|imagine|what\s+if|would\s+be|i\s+wish|i\s+hope|maybe|perhaps|might|i\s+(?:wonder|guess|think\s+maybe))\b/i,
    negation:
      /\b(?:not|n['’]t|never|no\s+longer|isn|aren|wasn|weren|don|doesn|didn|won|wouldn|can['’]?t|cannot|i\s+(?:don['’]?t|no\s+longer))\b/i,
    command:
      // "remember"/"note" land here only if the memorize-wrapper above didn't
      // already unwrap a fact (i.e. "remember TO call" → command).
      /^\s*(?:please\s+)?(?:remember|note|store|save|set|add|create|update|delete|remind|forget|tell|show|give|make|list|find|search)\b/i,
    firstPerson:
      // first-person assertion, but NOT "my <relative> is" (that's third-party)
      /\bi\s+(?:am|was|have|had|got|started|finished|live|work|like|love|hate|prefer|need|own|use|booked|moved|quit|joined|bought|sold)\b|\bi['’]m\b|\bmine\b|\bmy\s+(?!wife|husband|son|daughter|boss|friend|mother|father|sister|brother|colleague|partner|kid|child)\w+\s+(?:is|are|was|were)\b/i,
    thirdParty:
      // "my <relative> <verb>" = a claim about them, BUT "my <relative>'s name is X"
      // is a durable fact about the speaker's own family — exclude the possessive-'s
      // identity construction so it stays a storable personal fact.
      // The proper-noun-subject branch ([A-Z]...) is INTENTIONALLY case-sensitive
      // (no `i` flag) and uses only PERSON-action verbs (said/wants/prefers...),
      // NOT copulas — so "Elena prefers tea" is third-party but "Bucharest is in
      // Romania" is a world fact, not a person claim. "your/you're" = second person.
      /\b(?:[Hh]e|[Ss]he|[Tt]hey|[Hh]im|[Hh]er|[Tt]hem|[Hh]is|[Tt]heir|[Yy]our|[Yy]ou(?:['’]re)?)\b|\b[Mm]y\s+(?:wife|husband|son|daughter|boss|friend|mother|father|sister|brother|colleague|partner|kid|child)\b(?!['’]s)|\b[A-Z][a-z]+\s+(?:said|told|wants|needs|prefers|likes|loves|works|lives|studies|started)\b/,
  },
  // NOTE for HE/RU: JS `\b` is ASCII-only (boundary on [A-Za-z0-9_]), so it does
  // NOT work around Hebrew/Cyrillic letters. We use Unicode property boundaries
  // (?<![\p{L}]) … (?![\p{L}]) with the `u` flag instead. This bug silently broke
  // every non-Latin rule until the bench caught it.
  he: {
    question:
      /\?|(?<!\p{L})(?:מה|מתי|איפה|איזה|איזו|מי|למה|מדוע|כמה|האם|כיצד|איך)(?!\p{L})|איזה\s+(?:שלב|יום|זמן)|באיזה|מתי\s+(?:יהיה|יש|אמור)/u,
    hypothetical:
      /(?<!\p{L})(?:אם|נניח|הלוואי|אולי)(?!\p{L})|תאר\s+לעצמך|הייתי\s/u,
    negation:
      /(?<!\p{L})(?:לא|אין)(?!\p{L})|אף\s+פעם|כבר\s+לא|לא\s+עוד/u,
    command:
      /^\s*(?:בבקשה\s+)?(?:תזכור|זכור|תשמור|שמור|תרשום|תוסיף|תיצור|תעדכן|תמחק|תזכיר|תשכח|תגיד|תראה|תן|תחפש|תמצא)(?!\p{L})/u,
    firstPerson:
      /(?<!\p{L})אני(?!\p{L})\s+(?:הייתי|גר|גרה|עובד|עובדת|אוהב|אוהבת|צריך|צריכה|מעדיף|קניתי|התחלתי|סיימתי|עברתי)|(?<!\p{L})קיבלתי(?!\p{L})|המחזור\s+שלי/u,
    thirdParty:
      /(?<!\p{L})(?:הוא|היא|הם|הן|אשתי|בעלי|הבוס|החבר|אמא|אבא|אחות|אח)(?!\p{L})|הבן\s+שלי|הבת\s+שלי/u,
  },
  ru: {
    question:
      /\?|(?<!\p{L})(?:что|когда|где|какой|какая|какое|какие|кто|почему|зачем|сколько|как|ли)(?!\p{L})|на\s+какой\s+(?:стадии|день)|какой\s+(?:этап|день)/iu,
    hypothetical:
      /(?<!\p{L})(?:если|предположим|представь|надеюсь|возможно|наверное)(?!\p{L})|хотел\s+бы|может\s+быть|бы\s/iu,
    negation:
      /(?<!\p{L})(?:не|нет|никогда)(?!\p{L})|больше\s+не|уже\s+не/iu,
    command:
      /^\s*(?:пожалуйста\s+)?(?:запомни|сохрани|запиши|добавь|создай|обнови|удали|напомни|забудь|скажи|покажи|дай|найди)(?!\p{L})/iu,
    firstPerson:
      /(?<!\p{L})я(?!\p{L})\s+(?:был|была|живу|работаю|люблю|ненавижу|предпочитаю|купил|купила|начал|начала|закончил|переехал)|(?<!\p{L})(?:мой|моя|моё|мои)(?!\p{L})\s+(?!жена|муж|сын|дочь|друг|мама|папа|сестра|брат|босс)\p{L}+|у\s+меня/iu,
    thirdParty:
      /(?<!\p{L})(?:он|она|они|его|её|их|босс|друг|мама|папа|сестра|брат)(?!\p{L})|моя\s+жена|мой\s+муж|мой\s+сын|моя\s+дочь/iu,
  },
  // RO uses ă/â/î/ș/ț diacritics which are NOT ASCII \w, so \b is unreliable
  // around them too — use Unicode boundaries.
  ro: {
    question:
      /\?|^\s*(?:ce|când|unde|care|cine|cum|cât|câți|câte)(?!\p{L})|(?<!\p{L})de\s+ce(?!\p{L})|în\s+ce\s+(?:etapă|zi|fază)/iu,
    hypothetical:
      /(?<!\p{L})dacă(?!\p{L})|să\s+presupunem|imaginează|aș\s+vrea|(?<!\p{L})sper(?!\p{L})|(?<!\p{L})poate(?!\p{L})|(?<!\p{L})probabil(?!\p{L})|cred\s+că\s+poate|m-aș(?!\p{L})/iu,
    negation:
      /(?<!\p{L})nu(?!\p{L})|(?<!\p{L})niciodată(?!\p{L})|nu\s+mai/iu,
    command:
      /^\s*(?:te\s+rog\s+)?(?:ține\s+minte|reține|salvează|notează|adaugă|creează|actualizează|șterge|amintește|uită|spune|arată|dă|caută|găsește)(?!\p{L})/iu,
    firstPerson:
      /(?<!\p{L})(?:eu\s+)?(?:sunt|locuiesc|lucrez|prefer)(?!\p{L})|am\s+fost|am\s+nevoie|am\s+cumpărat|am\s+început|am\s+terminat|îmi\s+place|m-am\s+mutat/iu,
    thirdParty:
      /(?<!\p{L})(?:el|ea|ei|ele|șeful|prietenul|mama|tata|sora|fratele)(?!\p{L})|soția\s+mea|soțul\s+meu|fiul\s+meu|fiica\s+mea/iu,
  },
};

/**
 * Classify a single user utterance.
 *
 * @param text   the user's OWN message — NEVER the assistant's reply, and never
 *               user+reply concatenated (that was the exact 2026-06-03 bug:
 *               the assistant explaining a fact made the gate think the *user*
 *               asserted it).
 * @param langHint optional; otherwise auto-detected.
 */
// "Remember/note that <clause>" is a memorize directive WRAPPING a fact. The
// user genuinely wants the clause stored — so we unwrap and classify the clause,
// not the directive. (EN/HE/RU/RO openers.)
// Require "that"/"," — "remember TO call" is a reminder (command), not a fact.
const MEMORIZE_WRAPPER =
  /^\s*(?:please\s+)?(?:remember|note|keep\s+in\s+mind)\s+(?:that\s+|,\s*)(.+)/i; // EN
const MEMORIZE_WRAPPER_OTHER: Partial<Record<Lang, RegExp>> = {
  he: /^\s*(?:בבקשה\s+)?(?:תזכור|זכור|תשמור)\s+ש(.+)/u,
  ru: /^\s*(?:пожалуйста\s+)?(?:запомни|запиши|сохрани)(?:,)?\s+что\s+(.+)/iu,
  ro: /^\s*(?:te\s+rog\s+)?(?:ține\s+minte|reține)\s+că\s+(.+)/iu,
};

export function classifySpeechAct(text: string, langHint?: Lang): Classification {
  const raw = (text || "").trim();
  const lang = langHint || detectLang(raw);
  const r = RULES[lang];

  if (!raw) {
    return { act: "command", confidence: 0.0, reason: "empty", lang };
  }

  // 0. Unwrap an explicit "remember that <fact>" directive and classify the fact.
  const wrap = (lang === "en" ? MEMORIZE_WRAPPER : MEMORIZE_WRAPPER_OTHER[lang])?.exec(raw);
  if (wrap && wrap[1]) {
    const inner = classifySpeechAct(wrap[1], lang);
    // Only honor the directive if the clause is itself assertable; otherwise it's
    // "remember to call X" (a reminder/command), which we still drop.
    if (inner.act === "stated") {
      return { ...inner, reason: "memorize-directive:" + inner.reason };
    }
    return { act: "command", confidence: 0.85, reason: "directive-non-fact", lang };
  }

  // 1. Commands directed at the assistant — not facts about the world.
  if (r.command.test(raw)) {
    return { act: "command", confidence: 0.9, reason: "imperative-to-assistant", lang };
  }

  // 2. Questions — the headline failure mode. Highest-priority drop.
  if (r.question.test(raw)) {
    return { act: "question", confidence: 0.95, reason: "interrogative", lang };
  }

  // 3. Hypotheticals / wishes — conditionals are not commitments.
  if (r.hypothetical.test(raw)) {
    return { act: "hypothetical", confidence: 0.85, reason: "conditional-or-wish", lang };
  }

  // 4. Negations — a real signal, but a CONTRADICTION, not a new fact. Caller
  //    should use this to push β up on an existing belief, not to write a row.
  const isNeg = r.negation.test(raw);

  // 5. First-person vs third-party.
  const fp = r.firstPerson.test(raw);
  const tp = r.thirdParty.test(raw);

  if (isNeg && fp) {
    return { act: "negation", confidence: 0.8, reason: "first-person-denial", lang };
  }

  if (fp && !tp) {
    return { act: "stated", confidence: 0.9, reason: "first-person-assertion", lang };
  }

  if (tp && !fp) {
    return { act: "thirdparty", confidence: 0.6, reason: "claim-about-other", lang };
  }

  if (fp && tp) {
    // "My wife and I moved to Bucharest" — self is involved; treat as stated but
    // a touch less certain because a third party shares the predicate.
    return { act: "stated", confidence: 0.75, reason: "first-person-plus-other", lang };
  }

  if (isNeg) {
    return { act: "negation", confidence: 0.6, reason: "bare-negation", lang };
  }

  // 6. Declarative with no first-person marker — e.g. "Bucharest is in Romania".
  //    A real assertion, but generic/world-fact, not personal. Storable, lower trust.
  return { act: "stated", confidence: 0.55, reason: "declarative-no-subject", lang };
}

/** Convenience: should this utterance be written to the personal-fact store at all? */
export function isStorableFact(c: Classification): boolean {
  return c.act === "stated";
}
