/**
 * Unit tests — run with: bun test
 * Covers the speech-act classifier, the Beta trust math, and the integrated gate.
 */

import { expect, test, describe } from "bun:test";
import {
  classifySpeechAct,
  isStorableFact,
  detectLang,
  newBelief,
  confirm,
  contradict,
  decay,
  confidence,
  stance,
  PRIOR_ALPHA,
  PRIOR_BETA,
  gate,
  MemoryGate,
} from "../src/index.ts";

describe("classifySpeechAct", () => {
  test("first-person assertion is stated", () => {
    expect(classifySpeechAct("I live in Bucharest.").act).toBe("stated");
  });

  test("question is never stated — the headline case", () => {
    expect(classifySpeechAct("What stage of my cycle am I at?").act).toBe("question");
    expect(classifySpeechAct("Am I allergic to hazelnuts?").act).toBe("question");
  });

  test("hypothetical is dropped", () => {
    expect(classifySpeechAct("If I moved to Thailand, what would change?").act).toBe("question"); // has ?
    expect(classifySpeechAct("I wish I lived by the sea.").act).toBe("hypothetical");
  });

  test("command to assistant is not a fact", () => {
    expect(classifySpeechAct("Remind me to call the accountant.").act).toBe("command");
  });

  test("'remember that <fact>' unwraps to the fact", () => {
    const c = classifySpeechAct("Remember that I like dark coffee.");
    expect(c.act).toBe("stated");
    expect(c.reason).toContain("memorize-directive");
  });

  test("'remember to <action>' stays a non-fact directive", () => {
    expect(classifySpeechAct("Remember to call the dentist.").act).toBe("command");
  });

  test("third-party claim is not a self-fact", () => {
    expect(classifySpeechAct("My wife is studying for an exam.").act).toBe("thirdparty");
    expect(classifySpeechAct("Elena prefers tea.").act).toBe("thirdparty");
  });

  test("possessive identity about family stays storable", () => {
    expect(isStorableFact(classifySpeechAct("My son's name is Demian."))).toBe(true);
  });

  test("negation is a contradiction signal, not a new fact", () => {
    expect(classifySpeechAct("I no longer work at the old company.").act).toBe("negation");
  });

  test("multilingual: Hebrew question vs report", () => {
    expect(classifySpeechAct("באיזה שלב של המחזור אני?").act).toBe("question");
    expect(classifySpeechAct("קיבלתי את המחזור היום.").act).toBe("stated");
  });

  test("multilingual: Russian + Romanian questions drop", () => {
    expect(classifySpeechAct("Когда у меня встреча?").act).toBe("question");
    expect(classifySpeechAct("Unde locuiesc?").act).toBe("question");
  });

  test("never classifies on assistant text — caller passes user msg only (doc contract)", () => {
    // The assistant explaining a fact must NOT read as the user asserting it.
    // We can't enforce who calls us, but a declarative-from-assistant style line
    // about a third party should classify as thirdparty/declarative, never as a
    // first-person 'stated' self-fact.
    const c = classifySpeechAct("Your period started on May 16.");
    expect(c.act).not.toBe("stated"); // "your" / second-person → not a self-assertion
  });
});

describe("detectLang", () => {
  test("scripts and diacritics", () => {
    expect(detectLang("I live here")).toBe("en");
    expect(detectLang("אני גר כאן")).toBe("he");
    expect(detectLang("Я живу здесь")).toBe("ru");
    expect(detectLang("Locuiesc în București")).toBe("ro");
  });
});

describe("Beta trust math", () => {
  test("prior starts at 0.5, NOT 1.0 (this is the mem0 fix)", () => {
    const b = newBelief(0);
    expect(confidence(b)).toBeCloseTo(0.5, 5);
    expect(b.alpha).toBe(PRIOR_ALPHA);
    expect(b.beta).toBe(PRIOR_BETA);
  });

  test("one confirmation does not peg to certain", () => {
    const b = confirm(newBelief(0), 0);
    expect(confidence(b)).toBeLessThan(1.0);
    expect(confidence(b)).toBeGreaterThan(0.5);
  });

  test("contradiction outweighs confirmation (asymmetric)", () => {
    const confirmed = confirm(newBelief(0), 0);
    const contradicted = contradict(newBelief(0), 0);
    // same number of updates, but contradiction moves confidence further from 0.5
    const dUp = Math.abs(confidence(confirmed) - 0.5);
    const dDown = Math.abs(confidence(contradicted) - 0.5);
    expect(dDown).toBeGreaterThan(dUp);
  });

  test("repeated confirmation rises toward but never reaches 1.0", () => {
    let b = newBelief(0);
    for (let i = 0; i < 10; i++) b = confirm(b, 0);
    expect(confidence(b)).toBeGreaterThan(0.85);
    expect(confidence(b)).toBeLessThan(1.0);
  });

  test("decay pulls a stale belief back toward the prior", () => {
    const HALF = 90 * 24 * 3600 * 1000;
    let b = newBelief(0);
    for (let i = 0; i < 5; i++) b = confirm(b, 0);
    const fresh = confidence(b);
    const aged = confidence(decay(b, { halfLifeMs: HALF, now: HALF })); // one half-life later
    expect(aged).toBeLessThan(fresh);
    expect(aged).toBeGreaterThan(0.5); // but not all the way back yet
  });

  test("pinned (human-confirmed) beliefs never decay", () => {
    let b = newBelief(0, true);
    b = confirm(b, 0);
    const before = confidence(b);
    const after = confidence(decay(b, { now: 10 * 365 * 24 * 3600 * 1000 }));
    expect(after).toBeCloseTo(before, 5);
  });

  test("stance: assert / hedge / withhold thresholds", () => {
    let strong = newBelief(0);
    for (let i = 0; i < 8; i++) strong = confirm(strong, 0);
    expect(stance(strong, { now: 0 })).toBe("assert");
    expect(stance(newBelief(0), { now: 0 })).toBe("withhold"); // prior 0.5 < hedge 0.6
  });
});

describe("gate() integration", () => {
  test("stores facts, drops questions, reinforces negations", () => {
    expect(gate("I live in Bucharest.").action).toBe("store");
    expect(gate("Where do I live?").action).toBe("drop");
    expect(gate("I no longer drink coffee.").action).toBe("reinforce");
  });

  test("third-party dropped by default, stored only on opt-in", () => {
    expect(gate("Elena prefers tea.").action).toBe("drop");
    expect(gate("Elena prefers tea.", { storeThirdParty: true }).action).toBe("store");
  });

  test("world facts toggle", () => {
    expect(gate("Bucharest is in Romania.").action).toBe("store");
    expect(gate("Bucharest is in Romania.", { storeWorldFacts: false }).action).toBe("drop");
  });
});

describe("MemoryGate end-to-end loop", () => {
  test("ingest → recall reflects gate + trust", () => {
    const m = new MemoryGate({ now: 0 });
    m.ingest("I live in Bucharest.", "u1");
    m.ingest("What time is my flight?", "u1");      // dropped
    m.ingest("I prefer dark coffee.", "u1");
    expect(m.all("u1").length).toBe(2);             // only the two real facts stored

    // a fresh fact is at prior 0.5 → withheld until confirmed
    expect(m.recall("u1", { now: 0 }).length).toBe(0);

    // confirm one fact a few times; it should surface
    m.ingest("I live in Bucharest.", "u1");
    m.ingest("I live in Bucharest.", "u1");
    m.ingest("I live in Bucharest.", "u1");
    const recalled = m.recall("u1", { now: 0 });
    expect(recalled.length).toBeGreaterThanOrEqual(1);
    expect(recalled[0]!.text.toLowerCase()).toContain("bucharest");
  });

  test("contradiction lowers trust", () => {
    const m = new MemoryGate({ now: 0 });
    m.ingest("I work at the old company.", "u1");
    for (let i = 0; i < 4; i++) m.ingest("I work at the old company.", "u1"); // build trust
    const before = confidence(m.all("u1")[0]!.belief);
    m.ingest("I no longer work at the old company.", "u1"); // negation → contradict
    const after = confidence(m.all("u1")[0]!.belief);
    expect(after).toBeLessThan(before);
  });
});
