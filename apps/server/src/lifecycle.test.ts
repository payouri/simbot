import { expect, test } from "bun:test";
import { canTransition, type SimStatus, simStatusSchema, simTransitions } from "@simbot/shared";

test("a Sim only moves draft → queued → running → succeeded | failed", () => {
  const allowed = [
    ["draft", "queued"],
    ["queued", "running"],
    ["running", "succeeded"],
    ["running", "failed"],
  ];
  for (const from of simStatusSchema.options) {
    for (const to of simStatusSchema.options) {
      const expected = allowed.some(([f, t]) => f === from && t === to);
      expect(canTransition(from, to)).toBe(expected);
    }
  }
  const terminal: SimStatus[] = ["succeeded", "failed"];
  for (const status of terminal) expect(simTransitions[status]).toEqual([]);
});
