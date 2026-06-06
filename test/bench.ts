/**
 * bench.ts — SpeechActMemBench harness.
 *
 * Compares two ingest policies on the labeled set:
 *   1. NAIVE (extract-then-store baseline, what mem0/Zep/Letta do): store
 *      anything that looks like a declarative-ish utterance — i.e. store unless
 *      it's a bare imperative. This is a charitable stand-in for "extract facts
 *      from the turn and write them," which by construction stores questions.
 *   2. GATE  (this library): classify the speech act, store only "stated".
 *
 * Metrics: precision (of what we stored, how much SHOULD have been stored —
 * i.e. how few questions/hypotheticals leaked in), recall (of what should have
 * been stored, how much we caught), and accuracy.
 *
 * Run:  bun test/bench.ts
 */

import { gate } from "../src/index.ts";
import { BENCH, type BenchRow } from "./bench-data.ts";

type Policy = (row: BenchRow) => boolean; // returns: did we store it as a fact?

// Naive baseline: store unless it's an obvious command. Mirrors extract-then-store,
// which has no notion of "is this a question?" — declaratives AND questions both
// produce "extracted facts." Questions end with "?" but the extractor still pulls
// a proposition out of them, so we model that as "stored".
const naive: Policy = (row) => {
  const t = row.text.trim();
  // even a charitable naive system skips pure imperatives to the assistant
  if (/^\s*(remind|show|delete|напомни|תזכיר|amintește)/i.test(t)) return false;
  return true; // everything else gets "extracted and stored" — including questions
};

const gated: Policy = (row) => gate(row.text, { langHint: row.lang }).action === "store";

interface Scores {
  tp: number; fp: number; tn: number; fn: number;
  precision: number; recall: number; accuracy: number; f1: number;
}

function score(policy: Policy): { scores: Scores; misses: BenchRow[] } {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const misses: BenchRow[] = [];
  for (const row of BENCH) {
    const stored = policy(row);
    const shouldStore = row.store;
    if (stored && shouldStore) tp++;
    else if (stored && !shouldStore) { fp++; misses.push(row); }      // leaked a non-fact
    else if (!stored && !shouldStore) tn++;
    else { fn++; misses.push(row); }                                   // dropped a real fact
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const accuracy = (tp + tn) / BENCH.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { scores: { tp, fp, tn, fn, precision, recall, accuracy, f1 }, misses };
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

function report(name: string, s: Scores): void {
  console.log(`\n${name}`);
  console.log(`  precision ${pct(s.precision)}  (of stored, how many were real facts)`);
  console.log(`  recall    ${pct(s.recall)}  (of real facts, how many we kept)`);
  console.log(`  accuracy  ${pct(s.accuracy)}`);
  console.log(`  F1        ${pct(s.f1)}`);
  console.log(`  tp=${s.tp} fp=${s.fp} tn=${s.tn} fn=${s.fn}`);
}

console.log(`SpeechActMemBench — ${BENCH.length} utterances across EN/HE/RU/RO`);

const naiveRes = score(naive);
const gatedRes = score(gated);

report("NAIVE extract-then-store (mem0-style baseline)", naiveRes.scores);
report("GATE  speech-act-memory-gate (this library)", gatedRes.scores);

console.log(`\nHeadline: the gate cut false stores from ${naiveRes.scores.fp} to ${gatedRes.scores.fp} ` +
  `(${pct(naiveRes.scores.precision)} → ${pct(gatedRes.scores.precision)} precision).`);

if (gatedRes.misses.length) {
  console.log(`\nGate misclassifications (${gatedRes.misses.length}):`);
  for (const m of gatedRes.misses) {
    const stored = gated(m);
    console.log(`  [${m.lang}] want=${m.store ? "store" : "drop"} got=${stored ? "store" : "drop"} :: ${m.text}  (${m.note})`);
  }
}

// Exit non-zero if the gate regresses below target, so this doubles as CI.
const TARGET_PRECISION = 0.9;
const TARGET_RECALL = 0.85;
if (gatedRes.scores.precision < TARGET_PRECISION || gatedRes.scores.recall < TARGET_RECALL) {
  console.error(`\nFAIL: gate below target (precision≥${TARGET_PRECISION}, recall≥${TARGET_RECALL}).`);
  process.exit(1);
} else {
  console.log(`\nPASS: gate meets target (precision≥${pct(TARGET_PRECISION)}, recall≥${pct(TARGET_RECALL)}).`);
}
