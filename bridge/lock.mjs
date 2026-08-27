/**
 * One bridge per machine.
 *
 * Socket Mode allows several concurrent connections and Slack delivers
 * `app_mention` to every one of them. Two bridges therefore answer every
 * mention twice, with two different agents reaching two different results in
 * the same thread. The failure is invisible from the outside: nothing errors,
 * the user just sees the agent contradict itself and assumes it is flaky.
 *
 * systemd already prevents two copies of the same unit. It does not prevent a
 * hand-run `node index.mjs` beside the service, which is exactly what happens
 * while developing, so this covers that case.
 *
 * A dead holder must never block a restart, so the lock records a pid and is
 * taken over when that pid is gone. `process.kill(pid, 0)` sends no signal, it
 * only asks whether the process exists.
 */
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, hostname } from 'node:os';

export const DEFAULT_LOCK_PATH = join(
  homedir(), '.local', 'state', 'brave-agent', 'bridge.lock',
);

/** True if a process with this pid exists and we may signal it. */
export function isAlive(pid, kill = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to another user, so it is alive.
    return err.code === 'EPERM';
  }
}

/**
 * Claim the lock. Returns { ok: true } on success, or { ok: false, holder }
 * naming who has it, so the caller can log something useful and exit.
 */
export async function acquire({ path = DEFAULT_LOCK_PATH, pid = process.pid, alive = isAlive } = {}) {
  let held = null;
  try {
    held = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // Absent or unreadable, treat as free.
  }

  if (held && held.pid !== pid && alive(held.pid)) {
    return { ok: false, holder: held };
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    pid, host: hostname(), since: new Date().toISOString(),
  }, null, 2));
  return { ok: true, tookOver: Boolean(held && held.pid !== pid) };
}

/** Release the lock, but never another process's. */
export async function release({ path = DEFAULT_LOCK_PATH, pid = process.pid } = {}) {
  try {
    const held = JSON.parse(await readFile(path, 'utf8'));
    if (held.pid !== pid) return false;
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}
