/**
 * speech-act-memory-gate — the only memory ingest layer that won't store your
 * questions as facts.
 *
 * Public surface: a tiny, storage-agnostic gate you put in FRONT of whatever
 * memory backend you already use (mem0, Zep, a plain SQLite table, a JSON file).
 * You feed it the user's raw message; it tells you whether to write, and with
 * what trust. You keep your own store.
 *
 * Validated lineage: generalized from a single-domain gate running in production
 * in the Muninn assistant since 2026-06-05.
 */

// Explicit .ts extensions so this runs under Node --experimental-strip-types
// (Node ESM needs the extension) as well as Bun/tsx.
export * from "./speech-act.ts";
export * from "./trust.ts";

import {
  classifySpeechAct,
  isStorableFact,
  type Classification,
  type Lang,
} from "./speech-act.ts";
import {
  newBelief,
  confirm,
  contradict,
  decay,
  confidence,
  stance,
  type Belief,
} from "./trust.ts";

export type GateDecision =
  | { action: "store"; classification: Classification; belief: Belief }
  | { action: "reinforce"; classification: Classification; signal: "confirm" | "contradict" }
  | { action: "drop"; classification: Classification };

export interface GateOptions {
  langHint?: Lang;
  /** Treat declarative world-facts (no first-person subject) as storable? Default true. */
  storeWorldFacts?: boolean;
  /**
   * Store claims about OTHER people as low-trust notes? Default false — a claim
   * about your wife is never a fact about YOU, and conflating the two is a classic
   * memory-corruption bug. Turn on only if you keep per-subject provenance.
   */
  storeThirdParty?: boolean;
  /** ms epoch override, for deterministic tests. */
  now?: number;
}

/**
 * Decide what to do with a single user utterance — WITHOUT touching any store.
 * This is the pure core; wire it to your DB however you like.
 *
 *   - "store"     → it's a fresh first-person (or world) assertion. Write a row,
 *                   attach the returned Belief (a fresh Beta(2,2) prior).
 *   - "reinforce" → it confirms or contradicts something you may already hold.
 *                   Look up the matching belief and apply confirm()/contradict().
 *   - "drop"      → question / hypothetical / command / pure third-party. Do NOT
 *                   write it as a fact. (You may still log the raw turn for recall;
 *                   just don't promote it to a remembered fact.)
 */
export function gate(text: string, opts: GateOptions = {}): GateDecision {
  const c = classifySpeechAct(text, opts.langHint);

  switch (c.act) {
    case "stated":
      if (c.reason === "declarative-no-subject" && opts.storeWorldFacts === false) {
        return { action: "drop", classification: c };
      }
      return { action: "store", classification: c, belief: newBelief(opts.now) };

    case "negation":
      return { action: "reinforce", classification: c, signal: "contradict" };

    case "thirdparty":
      // A claim about someone else is NEVER a fact about the speaker. Drop by
      // default; only store (as a weak-prior note) if the caller opts in and
      // keeps per-subject provenance.
      if (opts.storeThirdParty) {
        return { action: "store", classification: c, belief: newBelief(opts.now) };
      }
      return { action: "drop", classification: c };

    case "question":
    case "hypothetical":
    case "command":
    default:
      return { action: "drop", classification: c };
  }
}

/**
 * Optional convenience wrapper: an in-memory store that demonstrates the full
 * loop (gate → store → reinforce → decay → surface). Production users will
 * usually replace this with their own backend, but it's a real, working
 * reference and the basis for the benchmark.
 */
export interface StoredFact {
  id: number;
  text: string;
  userId: string;
  belief: Belief;
  classification: Classification;
}

export class MemoryGate {
  private facts: StoredFact[] = [];
  private nextId = 1;
  private opts: GateOptions;

  // Plain field assignment (not a `private` parameter property) so the class runs
  // under Node's --experimental-strip-types as well as Bun/tsx.
  constructor(opts: GateOptions = {}) {
    this.opts = opts;
  }

  /** Returns the decision plus, if a fact was written, its id. */
  ingest(text: string, userId: string): { decision: GateDecision; storedId?: number } {
    const decision = gate(text, this.opts);

    if (decision.action === "store") {
      // Re-asserting an existing fact CONFIRMS it (raises trust) rather than
      // creating a duplicate. Requires a strong content match.
      const dup = this.matchExisting(text, userId, /* strong */ true);
      if (dup) {
        dup.belief = confirm(dup.belief, this.opts.now);
        return { decision, storedId: dup.id };
      }
      const fact: StoredFact = {
        id: this.nextId++,
        text: text.trim(),
        userId,
        belief: decision.belief,
        classification: decision.classification,
      };
      this.facts.push(fact);
      return { decision, storedId: fact.id };
    }

    if (decision.action === "reinforce") {
      // Naive match: most-recent fact for this user that shares a content word.
      const target = this.matchExisting(text, userId);
      if (target) {
        target.belief =
          decision.signal === "confirm"
            ? confirm(target.belief, this.opts.now)
            : contradict(target.belief, this.opts.now);
        return { decision, storedId: target.id };
      }
    }

    return { decision };
  }

  /** Facts worth surfacing right now (trust-gated + decayed). */
  recall(userId: string, opts: { assertAt?: number; now?: number } = {}): StoredFact[] {
    const now = opts.now ?? this.opts.now;
    return this.facts
      .filter((f) => f.userId === userId)
      .filter((f) => stance(f.belief, { assertAt: opts.assertAt, now }) !== "withhold")
      .map((f) => ({ ...f, belief: decay(f.belief, { now }) }))
      .sort((a, b) => confidence(b.belief) - confidence(a.belief));
  }

  all(userId?: string): StoredFact[] {
    return userId ? this.facts.filter((f) => f.userId === userId) : this.facts;
  }

  /**
   * Find the most-recent fact for this user that overlaps in content.
   * @param strong when true, require a high Jaccard overlap (used for de-dup on
   *   restate); when false, a single shared content word suffices (used to find
   *   the target of a contradiction).
   */
  private matchExisting(text: string, userId: string, strong = false): StoredFact | undefined {
    const words = new Set(text.toLowerCase().match(/\p{L}{4,}/gu) || []);
    if (words.size === 0) return undefined;
    const candidates = this.facts.filter((f) => f.userId === userId);
    for (let i = candidates.length - 1; i >= 0; i--) {
      const cand = candidates[i]!;
      const fw = new Set(cand.text.toLowerCase().match(/\p{L}{4,}/gu) || []);
      const shared = [...fw].filter((w) => words.has(w)).length;
      if (!strong) {
        if (shared > 0) return cand;
      } else {
        const union = new Set([...fw, ...words]).size;
        if (union > 0 && shared / union >= 0.6) return cand;
      }
    }
    return undefined;
  }
}
