/**
 * The runs currently in flight, so one can be stopped.
 *
 * `runAgent` owned its child privately, which is why the bridge could start
 * work and never end it: a "stop" reply in Slack queued behind the very run it
 * was trying to stop. This holds the handle.
 *
 * In memory only, and that is correct rather than lazy. A child does not
 * survive a bridge restart, so persisting the map would only ever describe
 * processes that are already gone - which is exactly the bug the lock's pid
 * check had. `pendingStore` remains the durable record of "a run was started
 * and not finished", and it is what the orphan sweep at boot reads.
 */

/** @returns a registry keyed by Slack thread ts. */
export function createRunRegistry({ log = console } = {}) {
  /** @type {Map<string, {child: object, startedBy: object|null}>} */
  const live = new Map();

  /** Forget a child, but only if it is still the one on record. */
  function untrack(key, child) {
    if (live.get(key)?.child === child) live.delete(key);
  }

  return {
    /**
     * Record the child running work for `key`.
     *
     * A second child for the same key kills the first. The queue serialises
     * per thread so this should not happen; if it does, two live children mean
     * two answers in one thread, which is the failure the queue and the lock
     * both exist to prevent. Losing the handle would make it unfixable.
     */
    track(key, child, startedBy = null) {
      const existing = live.get(key)?.child;
      if (existing && existing !== child) {
        log.warn?.(`[runs] second run for ${key}; stopping the first`);
        try {
          existing.kill('SIGKILL');
        } catch {
          // Already gone. Nothing to do.
        }
      }
      live.set(key, { child, startedBy });
      // Self-cleaning: a run that ends on its own must stop looking busy, or a
      // later interrupt kills nothing and reports that it did.
      child.once?.('exit', () => untrack(key, child));
      child.once?.('close', () => untrack(key, child));
    },

    /** True while a run for `key` is in flight. */
    isRunning(key) {
      return live.has(key);
    },

    /**
     * The message that triggered the run, or null.
     *
     * Carried because the progress signals - the reaction and the pending
     * record - are keyed on the message that STARTED the work, not on the one
     * asking to stop it. Without this a stop leaves a 👀 on the original
     * message and a pending entry the next boot apologises for.
     */
    startedBy(key) {
      return live.get(key)?.startedBy ?? null;
    },

    /**
     * Kill the run for `key`.
     *
     * @returns {boolean} whether something was actually killed. False covers
     *   both "nothing was running" and "the kill failed", because the caller
     *   says the same thing to the user either way: there is nothing running
     *   now.
     */
    stop(key) {
      const child = live.get(key)?.child;
      if (!child) return false;
      try {
        child.kill('SIGKILL');
        return true;
      } catch (err) {
        log.warn?.(`[runs] could not stop ${key}: ${err.message}`);
        live.delete(key);
        return false;
      }
    },

    size() {
      return live.size;
    },
  };
}
