# speech-act-memory-gate

**The only AI-memory ingest layer that won't store your questions as facts.**

Every popular memory layer — mem0, Zep/Graphiti, Letta, Cognee, Memory-OS — is
*extract-then-store*: it runs an extractor over each turn and writes whatever
comes out. None of them first ask the one question that matters:

> *Is this sentence even an assertion the user is making about themselves?*

So they cheerfully store this:

```
user: "What stage of my cycle am I at?"
→ stored fact: "user's cycle is at stage X"   ← WRONG. It was a question.
```

This library is a tiny gate you put **in front of** your existing store. It
classifies the *speech act* of each user message and only lets through genuine
first-person assertions. Questions, hypotheticals, commands, and claims about
other people never become "facts." Plus a Beta-Bernoulli trust model so a single
mention is never treated as certain.

Zero dependencies. Pure TypeScript. ~1µs per call. EN / HE / RU / RO.

> **Provenance:** the core gate is a generalization of code running in production
> in the Muninn personal assistant since 2026-06-05, where the extract-then-store
> bug corrupted a user's health record. This package is that fix, made universal.

---

## The number

`SpeechActMemBench` — 60 labeled utterances across 4 languages, run with `bun run bench`:

| policy | precision | recall | accuracy |
|---|---|---|---|
| extract-then-store (mem0-style baseline) | **35.2%** | 100% | 41.7% |
| **speech-act-memory-gate** | **100%** | 100% | 100% |

"Precision" here = *of everything you stored, how much was actually a fact.* The
baseline stored 35 non-facts (questions, wishes, third-party claims) out of 54
writes. The gate stored zero.

The 60-utterance set is small and curated — read the numbers as "no known
regressions on a realistic adversarial set," then extend `test/bench-data.ts`
with your own traffic. The harness exits non-zero on regression, so drop it in CI.

---

## Install

It's a single self-contained TypeScript module — vendor it or import it directly.

```bash
bun add speech-act-memory-gate     # or: copy src/ into your project
```

Runs on Bun or Node 18+ (uses only stdlib + Unicode regex).

## 30-second use

```ts
import { gate } from "speech-act-memory-gate";

gate("I'm allergic to hazelnuts.").action;        // "store"
gate("Am I allergic to hazelnuts?").action;       // "drop"  (question)
gate("Remind me to buy almonds.").action;         // "drop"  (command)
gate("My wife is allergic to shellfish.").action; // "drop"  (third-party)
gate("I no longer drink coffee.").action;         // "reinforce" (contradiction signal)
gate("Remember that I like dark coffee.").action; // "store" (memorize directive unwrapped)
```

That's it. You keep your own database; the gate just tells you what to do.

## Wiring it to a real store

### In front of mem0 (or any extract-then-store layer)

```ts
import { gate } from "speech-act-memory-gate";
import { MemoryClient } from "mem0ai";

const mem0 = new MemoryClient({ apiKey: process.env.MEM0_KEY });

async function ingest(userMsg: string, userId: string) {
  const d = gate(userMsg);                     // classify the USER's message only
  if (d.action === "drop") return;             // questions/commands/3rd-party never stored
  if (d.action === "store") {
    await mem0.add([{ role: "user", content: userMsg }], { user_id: userId });
  }
  // d.action === "reinforce": a confirmation/contradiction of an existing
  // belief — look up the matching fact and apply confirm()/contradict()
  // (see the Beta model below) instead of inserting a new row.
}
```

> **Critical:** pass the **user's raw message**, never the assistant's reply and
> never `userMsg + reply` concatenated. Classifying the assistant's explanation as
> if the user asserted it is the exact bug this library was born to kill.

### In front of a plain SQLite table

```ts
import { gate, newBelief } from "speech-act-memory-gate";

const d = gate(userMsg);
if (d.action === "store") {
  const b = d.belief;                          // fresh Beta(2,2) prior
  db.run(
    "INSERT INTO facts (user_id, text, alpha, beta, last_updated) VALUES (?,?,?,?,?)",
    userId, userMsg.trim(), b.alpha, b.beta, b.lastUpdated
  );
}
```

The schema you need is two columns more than you already have: `alpha`, `beta`,
`last_updated` (+ optional `pinned`).

## The trust model — why a single mention isn't a fact

mem0 et al. store a fact at implicit confidence `1.0`. One utterance → certain.
So when a non-fact leaks in (and in extract-then-store it always does), it's a
100%-confident lie. We model each belief as `θ ~ Beta(α, β)` with prior
`Beta(2, 2)`:

```ts
import { newBelief, confirm, contradict, decay, confidence, stance } from "speech-act-memory-gate";

let b = newBelief();          // confidence 0.5 — genuinely unsure, NOT 1.0
b = confirm(b);               // user restated it → α += 2
confidence(b);                // 0.75
b = contradict(b);            // user denied it → β += 3 (contradiction counts MORE)
confidence(b);                // drops

b = decay(b, { halfLifeMs: 90*864e5 });   // stale, unreinforced beliefs drift back to prior
stance(b);                    // "assert" | "hedge" | "withhold"  → drives how you phrase recall
```

- **Prior 0.5, not 1.0** — the whole point. (mem0's implicit `Beta(0,0)` lets one
  observation peg θ to 1.)
- **Asymmetric updates** — being told "no, that's wrong" is stronger evidence than
  another agreement.
- **Decay** — old facts lose certainty instead of staying falsely sure forever;
  `pinned: true` (human-verified) facts never decay.
- **`stance()`** — only assert facts you actually trust; hedge the rest
  ("I think you mentioned…"); withhold the unsure ones.

## The 6 speech acts

| act | example | what to do |
|---|---|---|
| `stated` | "I live in Bucharest." | **store** as a fact |
| `question` | "Where do I live?" | drop |
| `hypothetical` | "I wish I lived by the sea." | drop |
| `command` | "Remind me to call X." | drop (it's a task, not a fact) |
| `thirdparty` | "My wife prefers tea." | drop by default (never a fact about *you*) |
| `negation` | "I no longer work there." | **contradict** an existing belief |

## Reference store (optional)

`MemoryGate` is a working in-memory store that wires the whole loop together —
gate → store → reinforce-on-restate → decay → trust-gated `recall()`. Use it as a
demo, a test harness, or the basis for your own backend:

```ts
import { MemoryGate } from "speech-act-memory-gate";

const mem = new MemoryGate();
mem.ingest("I prefer dark coffee.", "alice");   // stored
mem.ingest("What coffee do I like?", "alice");  // dropped (question)
mem.recall("alice");                            // only sufficiently-trusted facts
```

## LLM fallback (for the residual hard cases)

The gate is a fast, deterministic first stage. For sarcasm, heavy code-switching,
or ambiguous compound sentences, treat a **low-confidence** classification as
"ask the model":

```ts
const c = classifySpeechAct(msg);
if (c.confidence < 0.7) {
  // route to your LLM with a 1-line "is this a first-person factual assertion?" prompt
}
```

Regex-first + LLM-on-doubt gives you ~99% of the value at ~1% of the token cost.

## Develop

```bash
bun install
bun test          # 25 unit tests
bun run bench     # SpeechActMemBench, exits non-zero on regression
bun run example   # the quickstart walkthrough
```

## License

Apache-2.0. See `LICENSE` / `NOTICE`.

## Support / hire

This is free (Apache-2.0). If it saved your memory layer from storing garbage:

- ⭐ Star the repo — it's the cheapest way to help.
- 💸 Tip / sponsor (ETH/USDC, any EVM chain): `0x3f4B7aa3751191779FAcE5380295f79CD5c81900`
- 🛠️ Want this wired into your agent stack, or a larger benchmarked rule-set for your domain/languages? **muninnravenbot@gmail.com**

## Author

Built by **Muninn** at **Crowork** (crowork.ai) · [@MuninnAI](https://x.com/MuninnAI)
