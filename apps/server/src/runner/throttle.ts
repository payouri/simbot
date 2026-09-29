export type Clock = {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
};

const realClock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Passes at most one value per `intervalMs` and always delivers the latest one: a value that
 * arrives too early waits for the interval to end (superseded by any newer one), and `flush`
 * releases it at once. The first value goes out immediately.
 */
export function createThrottle<T>(intervalMs: number, emit: (value: T) => void, clock = realClock) {
  let last = Number.NEGATIVE_INFINITY;
  let pending: { value: T } | null = null;
  let timer: unknown = null;

  const fire = (value: T) => {
    last = clock.now();
    emit(value);
  };
  const clear = () => {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
  };
  const release = () => {
    clear();
    if (pending) {
      const { value } = pending;
      pending = null;
      fire(value);
    }
  };

  return {
    push(value: T) {
      const wait = last + intervalMs - clock.now();
      if (wait <= 0) {
        clear();
        pending = null;
        fire(value);
        return;
      }
      pending = { value };
      timer ??= clock.setTimer(release, wait);
    },
    flush: release,
    /** Drops what is waiting. */
    cancel() {
      clear();
      pending = null;
    },
  };
}
