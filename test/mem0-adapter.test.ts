/**
 * Proves the mem0 adapter does the one thing that matters: nothing but a genuine
 * assertion ever reaches the backend. Uses a fake mem0 client (no API key), so
 * this runs in CI offline.
 *
 *   bun test
 */
import { test, expect } from "bun:test";
import { GatedMem0, type Mem0Like } from "../examples/mem0-adapter.ts";

class FakeMem0 implements Mem0Like {
  public calls: Array<{ messages: unknown; options?: unknown }> = [];
  async add(messages: unknown, options?: Record<string, unknown>) {
    this.calls.push({ messages, options });
    return { id: this.calls.length };
  }
}

test("questions, commands, hypotheticals and third-party never reach mem0", async () => {
  const fake = new FakeMem0();
  const mem = new GatedMem0(fake);

  for (const t of [
    "Am I allergic to hazelnuts?", // question
    "Remind me to buy almonds.", // command
    "If I were vegan, what would I eat?", // hypothetical / question
    "My wife is allergic to shellfish.", // third-party — not a fact about YOU
  ]) {
    const r = await mem.add(t, { user_id: "k" });
    expect(r.stored).toBe(false);
  }
  expect(fake.calls.length).toBe(0); // the whole point: backend stayed clean
});

test("genuine first-person assertions ARE forwarded to mem0 with options intact", async () => {
  const fake = new FakeMem0();
  const mem = new GatedMem0(fake);

  const r = await mem.add("I'm allergic to hazelnuts.", { user_id: "k" });
  expect(r.stored).toBe(true);
  expect(fake.calls.length).toBe(1);
  expect(fake.calls[0]!.options).toEqual({ user_id: "k" });
  expect(fake.calls[0]!.messages).toEqual([{ role: "user", content: "I'm allergic to hazelnuts." }]);
});
