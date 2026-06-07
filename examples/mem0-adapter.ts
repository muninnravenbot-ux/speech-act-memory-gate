/**
 * mem0-adapter.ts — put the speech-act gate IN FRONT of mem0 so that questions,
 * commands, hypotheticals and third-party claims never get written as facts.
 *
 * mem0 is extract-then-store: `add()` happily turns "Am I allergic to nuts?" into
 * a stored "fact". This wrapper runs the gate first and only forwards genuine
 * first-person (or world) assertions to your real mem0 client.
 *
 * No hard dependency: we type against the tiny slice of the client we use, so it
 * works with the hosted `mem0ai` SDK or a self-hosted server unchanged.
 *
 *   import MemoryClient from "mem0ai";              // your real client
 *   import { GatedMem0 } from "./mem0-adapter.ts";
 *   const mem = new GatedMem0(new MemoryClient({ apiKey: process.env.MEM0_API_KEY! }));
 *
 *   await mem.add("Am I allergic to hazelnuts?", { user_id: "kirill" }); // dropped
 *   await mem.add("I'm allergic to hazelnuts.",  { user_id: "kirill" }); // stored
 */

import { gate, type GateDecision, type GateOptions } from "../src/index.ts";

/**
 * The slice of the mem0 client we actually call. Both the hosted `mem0ai` client
 * and a self-hosted mem0 server expose `add(messages, options)`.
 */
export interface Mem0Like {
  add(
    messages: string | Array<{ role: string; content: string }>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface GatedAddResult {
  /** Why we did what we did — log this to see what the gate dropped. */
  decision: GateDecision;
  /** True only when the utterance was forwarded to mem0. */
  stored: boolean;
  /** Whatever mem0's add() returned, when we called it. */
  backend?: unknown;
}

export class GatedMem0 {
  constructor(
    private readonly client: Mem0Like,
    private readonly opts: GateOptions = {},
  ) {}

  /**
   * Gate the utterance, then forward to mem0 ONLY when it's a real assertion.
   * "drop" (question/command/hypothetical/third-party) and "reinforce" never
   * create a new mem0 row — mem0 has no first-class confirm/contradict, so a
   * reinforcement is yours to apply to your own trust layer if you keep one.
   */
  async add(
    text: string,
    options: { user_id: string } & Record<string, unknown>,
  ): Promise<GatedAddResult> {
    const decision = gate(text, this.opts);
    if (decision.action === "store") {
      const backend = await this.client.add([{ role: "user", content: text }], options);
      return { decision, stored: true, backend };
    }
    return { decision, stored: false };
  }
}
