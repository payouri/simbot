import { describe, expect, test } from "bun:test";
import { type Clock, createThrottle } from "./throttle";

function fakeClock() {
  let now = 1_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const clock: Clock = {
    now: () => now,
    setTimer: (fn, ms) => {
      timers.set(next, { at: now + ms, fn });
      return next++;
    },
    clearTimer: (h) => void timers.delete(h as number),
  };
  return {
    clock,
    advance(ms: number) {
      const to = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= to)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = to;
    },
    pending: () => timers.size,
  };
}

describe("createThrottle", () => {
  test("the first value goes out at once, later ones at most once per interval", () => {
    const { clock, advance } = fakeClock();
    const out: number[] = [];
    const t = createThrottle<number>(250, (v) => out.push(v), clock);
    t.push(1);
    advance(10);
    t.push(2);
    advance(10);
    t.push(3);
    expect(out).toEqual([1]);
    advance(230);
    expect(out).toEqual([1, 3]);
  });

  test("a hundred values in one second come out at about four per second", () => {
    const { clock, advance } = fakeClock();
    const out: number[] = [];
    const t = createThrottle<number>(250, (v) => out.push(v), clock);
    for (let i = 0; i < 100; i++) {
      t.push(i);
      advance(10);
    }
    advance(250);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out.at(-1)).toBe(99);
  });

  test("a value after a quiet interval goes out at once", () => {
    const { clock, advance } = fakeClock();
    const out: number[] = [];
    const t = createThrottle<number>(250, (v) => out.push(v), clock);
    t.push(1);
    advance(300);
    t.push(2);
    expect(out).toEqual([1, 2]);
  });

  test("flush releases the waiting value; cancel drops it", () => {
    const { clock, advance, pending } = fakeClock();
    const out: number[] = [];
    const t = createThrottle<number>(250, (v) => out.push(v), clock);
    t.push(1);
    t.push(2);
    t.flush();
    expect(out).toEqual([1, 2]);
    expect(pending()).toBe(0);
    t.push(3);
    t.cancel();
    advance(1000);
    expect(out).toEqual([1, 2]);
    t.flush();
    expect(out).toEqual([1, 2]);
  });
});
