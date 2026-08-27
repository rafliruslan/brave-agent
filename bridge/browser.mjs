import { readFile } from 'node:fs/promises';

/**
 * Which browser the agent drives is a property of the MCP config, not of this
 * code, so the tool allowlist is derived from that file rather than hardcoded.
 *
 * The bridge runs `claude -p --strict-mcp-config`, which loads only the file it
 * is handed and ignores everything else configured. So the servers named in
 * that file are, exactly, the servers that will exist. Deriving the allowlist
 * from the same source means the two can never drift, and swapping browsers is
 * a config edit rather than a patch.
 *
 * This is what lets one codebase serve two machines: Brave over CDP on Linux
 * (`brave`, `devtools`, `brave-repl`), Aside on macOS (`aside`). A hardcoded
 * `mcp__brave` list silently leaves the agent with no browser at all on the
 * other one, because --allowedTools is a whitelist: an unlisted tool is not
 * denied loudly, it is simply never offered.
 */

/** Tools the agent gets regardless of which browser is attached. */
export const BASE_TOOLS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch',
];

/**
 * `mcp__<server>` for every server in an MCP config object. The prefix form is
 * deliberate: it covers every tool a server exposes without this file needing
 * to track what those are.
 */
export function toolPrefixes(config) {
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== 'object') return [];
  return Object.keys(servers)
    .filter((name) => typeof name === 'string' && name.length > 0)
    .map((name) => `mcp__${name}`);
}

/**
 * Read the MCP config and return the full allowlist.
 *
 * A missing or unreadable config is not fatal. The agent still has Read, Bash
 * and the rest, and it will say it cannot reach the browser, which is a far
 * better failure than refusing to start: the bridge is also how you would ask
 * it what went wrong.
 */
export async function browserPrefixes(path, { read = readFile, log = console.warn } = {}) {
  try {
    const prefixes = toolPrefixes(JSON.parse(await read(path, 'utf8')));
    if (prefixes.length === 0) log(`[browser] no mcpServers in ${path}; the agent will have no browser`);
    return prefixes;
  } catch (err) {
    log(`[browser] could not read ${path} (${err.message}); the agent will have no browser`);
    return [];
  }
}

/**
 * The browser plus a set of non-browser tools. `base` is a parameter because
 * routines.mjs deliberately runs narrower than the bridge does: an unattended
 * scheduled run has no one to sanity-check a web search, so it does not get one.
 */
export async function allowedTools(path, { base = BASE_TOOLS, ...opts } = {}) {
  return [...(await browserPrefixes(path, opts)), ...base];
}
