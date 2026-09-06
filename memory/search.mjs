/**
 * Ranked search over the agent's memory, returning SECTIONS rather than files.
 *
 * The agent has always been able to Grep and Read `memory/`. This exists for
 * the same reason `repl/snapshot.mjs` returns a diff: reading is cheap to ask
 * for and expensive to receive. `memory/sites/app.slack.com.md` is one file the
 * agent wants two paragraphs of, and Read gives it all of them, every time.
 *
 * Deliberately lexical, not semantic. No embeddings, no index, no model, no
 * dependency: a few dozen markdown files re-read per query is microseconds, and
 * the moment this needs a vector store it has outgrown being a memory the agent
 * writes by hand. Call it what it is, so nobody expects it to match "how do I
 * reply in a thread" against a section that never says "reply".
 */

/** Words worth matching on. Short ones match everywhere and rank nothing. */
function terms(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9_.]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Split markdown into `##`-level sections.
 *
 * Content before the first heading becomes a section with a null heading. It
 * would otherwise be dropped, and in these files the opening line is usually
 * the one saying what the file is for.
 */
export function sections(path, text) {
  const out = [];
  let heading = null;
  let buf = [];

  const flush = () => {
    const body = buf.join('\n').trim();
    if (body || heading) out.push({ path, heading, text: body });
    buf = [];
  };

  for (const line of String(text || '').split('\n')) {
    const m = /^#{2,6}\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** Occurrences of `term` in `haystack`, already lowercased. */
function count(haystack, term) {
  let n = 0;
  let i = haystack.indexOf(term);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(term, i + term.length);
  }
  return n;
}

function score(section, wanted) {
  const heading = (section.heading || '').toLowerCase();
  const body = section.text.toLowerCase();
  const path = section.path.toLowerCase();

  let total = 0;
  let matched = 0;

  for (const term of wanted) {
    const inHeading = count(heading, term);
    const inBody = count(body, term);
    // The path carries real signal: sites/app.slack.com.md is the Slack file
    // even when the prose inside never says "Slack".
    const inPath = count(path, term);
    if (!inHeading && !inBody && !inPath) continue;

    matched++;
    // A heading is the author saying what the section is about, so it counts
    // for more than the same word buried in a paragraph.
    total += inHeading * 10 + inPath * 6 + Math.min(inBody, 4);
  }

  if (matched === 0) return 0;
  // Carrying every term beats carrying one of them many times over.
  if (matched === wanted.length && wanted.length > 1) total += 25 * wanted.length;
  return total;
}

function clip(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n… truncated, Read the file for the rest`;
}

/**
 * Rank sections of `files` against `query`.
 *
 * @param {Array<{path: string, text: string}>} files
 * @param {string} query
 * @returns {Array<{path: string, heading: string|null, score: number, text: string}>}
 */
export function search(files, query, { limit = 5, maxChars = 1200 } = {}) {
  const wanted = terms(query);
  if (wanted.length === 0) return [];

  const hits = [];
  for (const file of files || []) {
    for (const section of sections(file.path, file.text)) {
      const s = score(section, wanted);
      if (s > 0) hits.push({ ...section, score: s });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, limit).map((h) => ({ ...h, text: clip(h.text, maxChars) }));
}

/** One hit, rendered for the agent to read. */
export function render(hit) {
  const where = hit.heading ? `${hit.path} › ${hit.heading}` : hit.path;
  return `## ${where}\n${hit.text}`;
}
