# Changelog

## 0.1.0 — 2026-06-06

First public release.

- `classifySpeechAct(text, lang?)` — 6-way speech-act classifier
  (`stated` / `question` / `hypothetical` / `thirdparty` / `negation` / `command`)
  across EN / HE / RU / RO.
- `gate(text, opts)` — pure store / drop / reinforce decision, storage-agnostic.
- Beta(2,2) trust model: `newBelief`, `confirm`, `contradict`, `decay`, `stance`.
- `MemoryGate` — a reference in-memory store wiring the full loop
  (gate → store → reinforce-on-restate → decay → trust-gated recall).
- `SpeechActMemBench` — 60 labeled utterances + harness comparing the gate to an
  extract-then-store baseline. Current results: gate 100% precision / 100% recall
  on the set vs baseline 35% precision. (The set is intentionally small; treat the
  100% as "no known regressions," not a universal claim — extend `test/bench-data.ts`.)
- 25 unit tests, zero runtime dependencies.

### Known limitations
- Rule-based, not ML. Sarcasm, heavy code-switching, and very long compound
  sentences can fool it. The gate is designed to be the cheap first stage; pair it
  with an LLM fallback for the residual hard cases (see README "LLM fallback").
- Language detection is a cheap script/stopword heuristic, not full langid.
