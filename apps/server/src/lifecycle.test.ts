import { expect, test } from "bun:test";
import { canTransition, type SimStatus, simStatusSchema, simTransitions } from "@simbot/shared";

test("a Sim only moves along the allowed life-cycle edges", () => {
  const allowed = [
    ["draft", "queued"],
    ["queued", "running"],
    ["running", "succeeded"],
    ["running", "failed"],
    ["running", "cancelled"], // Stop
    ["queued", "draft"], // Discard
    ["running", "draft"], // Discard
    ["running", "queued"], // interrupted by a crash
  ];
  for (const from of simStatusSchema.options) {
    for (const to of simStatusSchema.options) {
      const expected = allowed.some(([f, t]) => f === from && t === to);
      expect(canTransition(from, to)).toBe(expected);
    }
  }
  const terminal: SimStatus[] = ["succeeded", "failed", "cancelled"];
  for (const status of terminal) expect(simTransitions[status]).toEqual([]);
});
