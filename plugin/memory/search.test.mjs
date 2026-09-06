import test from 'node:test';
import assert from 'node:assert/strict';
import { sections, search } from './search.mjs';

const slack = {
  path: 'sites/app.slack.com.md',
  text: [
    'How the workspace is laid out.',
    '',
    '## Posting a message',
    'Use chat.postMessage. Threads need thread_ts.',
    '',
    '## Reading a thread',
    'conversations.replies, not conversations.history.',
  ].join('\n'),
};

const calendar = {
  path: 'skills/google-calendar/SKILL.md',
  text: ['## Creating an event', 'Click the day, then More options for the full form.'].join('\n'),
};

test('sections splits on headings and keeps the heading', () => {
  const out = sections(slack.path, slack.text);
  assert.deepEqual(out.map((s) => s.heading), [null, 'Posting a message', 'Reading a thread']);
});

test('sections keeps text before the first heading', () => {
  // A file that opens with a paragraph would otherwise lose it entirely, and
  // that opening line is usually the one that says what the file is for.
  const [first] = sections(slack.path, slack.text);
  assert.equal(first.heading, null);
  assert.match(first.text, /laid out/);
});

test('search returns the matching section, not the whole file', () => {
  const [hit] = search([slack], 'thread_ts');
  assert.equal(hit.heading, 'Posting a message');
  assert.doesNotMatch(hit.text, /conversations\.replies/);
});

test('a heading match outranks a body match', () => {
  const hits = search([slack], 'reading');
  assert.equal(hits[0].heading, 'Reading a thread');
});

test('a filename match counts, so a site file is findable by its site', () => {
  // "slack" appears nowhere in the prose of some site files, only in the path.
  const hits = search([{ path: 'sites/app.slack.com.md', text: '## Posting\nUse chat.postMessage.' }], 'slack');
  assert.equal(hits.length, 1);
});

test('sections carrying every term outrank sections carrying one', () => {
  const hits = search([slack, calendar], 'creating event');
  assert.match(hits[0].path, /google-calendar/);
});

test('no match returns nothing rather than everything', () => {
  assert.deepEqual(search([slack, calendar], 'kubernetes'), []);
});

test('an empty query returns nothing', () => {
  assert.deepEqual(search([slack], '   '), []);
});

test('limit caps the number of sections returned', () => {
  assert.equal(search([slack, calendar], 'a', { limit: 1 }).length <= 1, true);
});

test('a long section is truncated and says so', () => {
  const long = { path: 'notes.md', text: `## Big\n${'word '.repeat(2000)}` };
  const [hit] = search([long], 'big', { maxChars: 200 });
  assert.equal(hit.text.length <= 240, true);
  assert.match(hit.text, /truncated/);
});
