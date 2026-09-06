import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNote, renderNote } from './siteskill.mjs';

const FILES = ['app.slack.com.md', 'app.excalidraw.com.md', 'google.com.md'];

test('an exact hostname wins', () => {
  assert.equal(pickNote('app.slack.com', FILES), 'app.slack.com.md');
});

test('a subdomain falls back to a parent-domain note', () => {
  // mail.google.com and docs.google.com share one note rather than needing
  // a file each.
  assert.equal(pickNote('mail.google.com', FILES), 'google.com.md');
});

test('the most specific note wins over the parent', () => {
  const files = ['google.com.md', 'mail.google.com.md'];
  assert.equal(pickNote('mail.google.com', files), 'mail.google.com.md');
});

test('www is not a meaningful subdomain', () => {
  assert.equal(pickNote('www.google.com', FILES), 'google.com.md');
});

test('an unknown host has no note', () => {
  assert.equal(pickNote('example.com', FILES), null);
});

test('a partial name is not a match', () => {
  // "notslack.com" must not pick up the slack note by substring.
  assert.equal(pickNote('notapp.slack.com.evil.test', FILES), null);
});

test('renderNote carries the path and the content', () => {
  const out = renderNote({ path: 'sites/app.slack.com.md', text: '# Slack\nDo not press Enter blindly.' });
  assert.match(out, /sites\/app\.slack\.com\.md/);
  assert.match(out, /press Enter blindly/);
});

test('a long note is reduced to its headings and a pointer', () => {
  const text = ['# Big', ...Array.from({ length: 40 }, (_, i) => `## Section ${i}\n${'x'.repeat(300)}`)].join('\n');
  const out = renderNote({ path: 'sites/big.md', text }, { maxChars: 500 });
  assert.match(out, /Section 0/);
  assert.match(out, /Read sites\/big\.md/);
  assert.equal(out.length < 1400, true);
});

test('renderNote says what it is, so the agent does not read it as page content', () => {
  const out = renderNote({ path: 'sites/app.slack.com.md', text: '# Slack' });
  assert.match(out, /SITE NOTE/);
});
