/**
 * Keyed work queue: strict ordering within a key, bounded parallelism across keys.
 *
 * The key is a Slack thread. Two mentions in the same thread must never run at
 * once, because both would resume the same session and interleave turns
 * into one conversation history. Different threads are independent and may run
 * together, up to `concurrency`.
 *
 * The cap exists for cost and memory, not correctness: measured, concurrent
 * agent runs each open their own browser tabs and do not interfere.
 */
export function createQueue({ concurrency = 1 } = {}) {
  let active = 0;
  let pending = 0;
  const waiting = [];
  const tails = new Map();

  const acquire = () =>
    new Promise((resolve) => {
      if (active < concurrency) {
        active += 1;
        resolve();
      } else {
        waiting.push(resolve);
      }
    });

  const release = () => {
    const next = waiting.shift();
    // Hand the slot straight to the next waiter rather than decrementing and
    // re-incrementing, which would let a later caller jump the line.
    if (next) next();
    else active -= 1;
  };

  return {
    /** Tasks accepted but not yet finished, including those currently running. */
    get pending() {
      return pending;
    },

    /** Tasks currently executing. Never exceeds `concurrency`. */
    get active() {
      return active;
    },

    /** Tasks waiting on a concurrency slot. */
    get queued() {
      return waiting.length;
    },

    /** True if this key already has work in flight or queued. */
    isBusy(key) {
      return tails.has(key);
    },

    add(key, task) {
      pending += 1;

      const guarded = async () => {
        await acquire();
        try {
          return await task();
        } finally {
          release();
        }
      };

      const prev = tails.get(key) || Promise.resolve();
      // Run regardless of whether the previous task in this key succeeded, so
      // one failure cannot wedge a thread permanently.
      const run = prev.then(guarded, guarded);

      const settle = () => {
        pending -= 1;
        if (tails.get(key) === chained) tails.delete(key);
      };
      const chained = run.then(settle, settle);
      tails.set(key, chained);

      return run;
    },
  };
}
