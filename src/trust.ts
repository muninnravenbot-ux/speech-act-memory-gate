/**
 * trust.ts — Beta-Bernoulli belief tracking for stored facts.
 *
 * Why this exists: mem0 and friends store a fact with implicit confidence 1.0.
 * A single utterance pegs the belief to certain. So if a *question* slips through
 * (and in extract-then-store systems it always does), it's now a 100%-confident
 * "fact." That's mem0's implicit Beta(0,0): one observation → θ = 1.
 *
 * We model each belief as θ ~ Beta(α, β), prior Beta(2,2):
 *   - starts at confidence 0.5 (genuinely unsure), NOT 1.0
 *   - confirmations push α up; contradictions push β up
 *   - contradiction counts MORE than confirmation (asymmetric — being told
 *     "no, that's wrong" is stronger evidence than yet another agreement)
 *   - confidence = α / (α + β), with a credible-interval width you can read
 *     to decide whether to surface a fact at all
 *
 * Plus temporal decay: old, unreinforced beliefs drift back toward the prior
 * instead of staying falsely certain forever. Half-life is configurable
 * (important facts decay slower). Human-confirmed facts are exempt.
 *
 * Zero dependencies. Pure functions.
 */

export interface Belief {
  alpha: number;
  beta: number;
  /** ms epoch of the last reinforcement (confirm/contradict). Drives decay. */
  lastUpdated: number;
  /** if true, never decays (a human explicitly verified it) */
  pinned?: boolean;
}

export const PRIOR_ALPHA = 2;
export const PRIOR_BETA = 2;
const CONFIRM_STRENGTH = 2;
const CONTRADICT_STRENGTH = 3; // asymmetric: contradiction is stronger evidence

export function newBelief(now: number = Date.now(), pinned = false): Belief {
  return { alpha: PRIOR_ALPHA, beta: PRIOR_BETA, lastUpdated: now, pinned };
}

/** Point-estimate confidence = mean of Beta(α,β). */
export function confidence(b: Belief): number {
  return b.alpha / (b.alpha + b.beta);
}

/** Variance of Beta(α,β) — high variance = "I have an opinion but little data." */
export function variance(b: Belief): number {
  const s = b.alpha + b.beta;
  return (b.alpha * b.beta) / (s * s * (s + 1));
}

/**
 * Width of the (approximate) 95% credible interval. A wide interval means you
 * should hedge ("I think you mentioned...") rather than assert.
 */
export function uncertainty(b: Belief): number {
  return 2 * 1.96 * Math.sqrt(variance(b));
}

export function confirm(b: Belief, now: number = Date.now(), strength = CONFIRM_STRENGTH): Belief {
  return { ...b, alpha: b.alpha + strength, lastUpdated: now };
}

export function contradict(b: Belief, now: number = Date.now(), strength = CONTRADICT_STRENGTH): Belief {
  return { ...b, beta: b.beta + strength, lastUpdated: now };
}

export interface DecayOptions {
  /** ms; default 90 days. Important facts: pass a longer half-life. */
  halfLifeMs?: number;
  now?: number;
}

const DEFAULT_HALF_LIFE = 90 * 24 * 60 * 60 * 1000;

/**
 * Pull a stale belief back toward the prior. We don't delete — we let evidence
 * "evaporate" geometrically, so an old fact loses certainty but never flips sign
 * on its own. Pinned (human-confirmed) beliefs are untouched.
 */
export function decay(b: Belief, opts: DecayOptions = {}): Belief {
  if (b.pinned) return b;
  const halfLife = opts.halfLifeMs ?? DEFAULT_HALF_LIFE;
  const now = opts.now ?? Date.now();
  const age = Math.max(0, now - b.lastUpdated);
  const factor = Math.pow(0.5, age / halfLife); // 1 → 0 as age grows

  // Evaporate the evidence ABOVE the prior. The prior is the floor.
  const excessA = Math.max(0, b.alpha - PRIOR_ALPHA) * factor;
  const excessB = Math.max(0, b.beta - PRIOR_BETA) * factor;
  return {
    ...b,
    alpha: PRIOR_ALPHA + excessA,
    beta: PRIOR_BETA + excessB,
  };
}

/**
 * Decide whether to surface a belief in a prompt/answer, and how to phrase it.
 * Pairs with the speech-act gate: only "stated" facts ever become beliefs,
 * and only sufficiently-trusted beliefs get asserted.
 */
export type Stance = "assert" | "hedge" | "withhold";

export function stance(
  b: Belief,
  opts: { assertAt?: number; hedgeAt?: number; now?: number } = {}
): Stance {
  const assertAt = opts.assertAt ?? 0.8;
  const hedgeAt = opts.hedgeAt ?? 0.6;
  const c = confidence(decay(b, { now: opts.now }));
  if (c >= assertAt) return "assert";
  if (c >= hedgeAt) return "hedge";
  return "withhold";
}
