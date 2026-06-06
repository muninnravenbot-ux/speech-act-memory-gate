/**
 * quickstart.ts — the whole point in 30 lines.
 *
 *   bun examples/quickstart.ts
 *
 * Shows: the gate dropping a question, storing a fact, and trust rising on
 * restate / falling on contradiction.
 */

import { MemoryGate, gate, confidence } from "../src/index.ts";

console.log("1) The gate, as a pure decision (no storage):\n");
for (const msg of [
  "I'm allergic to hazelnuts.",          // store
  "Am I allergic to hazelnuts?",         // drop (question)
  "Remind me to buy almonds.",           // drop (command)
  "My wife is allergic to shellfish.",   // drop (third-party — not a fact about YOU)
  "Remember that I like dark coffee.",   // store (memorize directive)
]) {
  const d = gate(msg);
  console.log(`   ${d.action.toUpperCase().padEnd(10)} ${d.classification.act.padEnd(12)} :: ${msg}`);
}

console.log("\n2) Full loop with the reference store:\n");
const mem = new MemoryGate();
mem.ingest("I live in Bucharest.", "kirill");
mem.ingest("What's the weather in Bucharest?", "kirill"); // dropped — a question
console.log(`   stored facts: ${mem.all("kirill").length}  (the question was NOT stored)`);

// Restating the same fact raises confidence; one statement is never "certain".
const conf = () => confidence(mem.all("kirill")[0]!.belief).toFixed(2);
console.log(`   after 1 mention: conf=${conf()}`);
mem.ingest("I live in Bucharest.", "kirill");
mem.ingest("I live in Bucharest.", "kirill");
console.log(`   after 3 mentions: conf=${conf()}`);

// A contradiction pushes it back down — harder than a confirmation pushed it up.
mem.ingest("I don't live in Bucharest anymore.", "kirill");
console.log(`   after contradiction: conf=${conf()}`);

console.log("\n3) Only sufficiently-trusted facts surface:\n");
const surfaced = mem.recall("kirill");
console.log(`   recall() returned ${surfaced.length} fact(s) above the assert threshold.`);
