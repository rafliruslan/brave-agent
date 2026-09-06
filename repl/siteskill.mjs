/**
 * Site notes, surfaced on arrival instead of on request.
 *
 * `workspace/CLAUDE.md` says of the Slack note: "Read before typing into
 * Slack." That instruction only works if the agent remembers it is standing on
 * Slack and that a note exists, and the failure is silent when it does not:
 * it types into the composer the note warns about and finds out afterwards.
 * Aside calls the equivalent keyword auto-injection. This is the same idea,
 * keyed on the host you just navigated to.
 *
 * Deliberately a filename lookup and not a search. `memory/sites/` is already
 * named by hostname, so the note for a page is decidable without ranking
 * anything, and this stays independent of the memory server.
 */

/**
 * The note for `hostname`, or null.
 *
 * Exact match first, then progressively shorter parent domains, so
 * `mail.google.com` and `docs.google.com` can share one `google.com.md`
 * without either needing a file. Matching is on whole labels: a host is only
 * ever matched by its own suffix, never by a substring, so `evil.test` cannot
 * borrow another site's note by embedding its name.
 */
export function pickNote(hostname, files) {
  const have = new Set(files || []);
  let labels = String(hostname || '').toLowerCase().split('.').filter(Boolean);
  if (labels[0] === 'www') labels = labels.slice(1);

  // Stop at two labels: a single-label suffix is a TLD, and a "com.md" note
  // would apply to most of the web.
  for (let i = 0; i + 2 <= labels.length; i++) {
    const candidate = `${labels.slice(i).join('.')}.md`;
    if (have.has(candidate)) return candidate;
  }
  return null;
}

/** The `##` headings of a markdown document, in order. */
function headings(text) {
  return String(text || '')
    .split('\n')
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^#+\s*/, '').trim());
}

/**
 * One note, rendered for injection.
 *
 * Labelled, because this arrives appended to a page snapshot and must not read
 * as something the page said. A note past `maxChars` collapses to its headings
 * plus where to read it: injecting 8KB on every navigation would cost more than
 * the round-trip it saves.
 */
export function renderNote({ path, text }, { maxChars = 6000 } = {}) {
  const head = `SITE NOTE  ${path}\nWhat you already know about this site. Not page content.`;
  const body = String(text || '').trim();
  if (body.length <= maxChars) return `${head}\n\n${body}`;
  return [
    head,
    '',
    `Too long to inline (${body.length} chars). Sections:`,
    ...headings(body).map((h) => `  - ${h}`),
    '',
    `Read ${path} for the parts you need.`,
  ].join('\n');
}
