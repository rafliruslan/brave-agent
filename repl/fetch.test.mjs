import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget, isWrite, renderResponse } from './fetch.mjs';

const PAGE = 'https://mail.google.com/mail/u/0/#inbox';

test('a relative path resolves against the page origin', () => {
  const t = resolveTarget(PAGE, '/sync/u/0/i/s');
  assert.equal(t.url, 'https://mail.google.com/sync/u/0/i/s');
});

test('an absolute same-origin url is allowed', () => {
  const t = resolveTarget(PAGE, 'https://mail.google.com/sync/u/0/i/s?x=1');
  assert.equal(t.url, 'https://mail.google.com/sync/u/0/i/s?x=1');
});

test('a cross-origin url is refused, naming both origins', () => {
  // Same-origin is the whole security boundary. Without it this is a tool for
  // making authenticated requests anywhere, from inside the user's browser.
  assert.throws(() => resolveTarget(PAGE, 'https://evil.example/steal'), /mail\.google\.com/);
  assert.throws(() => resolveTarget(PAGE, 'https://evil.example/steal'), /evil\.example/);
});

test('a subdomain is a different origin', () => {
  assert.throws(() => resolveTarget(PAGE, 'https://drive.google.com/x'), /origin/i);
});

test('a different scheme is a different origin', () => {
  assert.throws(() => resolveTarget(PAGE, 'http://mail.google.com/x'), /origin/i);
});

test('a non-http scheme is refused outright', () => {
  assert.throws(() => resolveTarget(PAGE, 'file:///etc/passwd'), /http/i);
  assert.throws(() => resolveTarget(PAGE, 'javascript:alert(1)'), /http/i);
});

test('a page on about:blank has no origin to fetch from', () => {
  assert.throws(() => resolveTarget('about:blank', '/x'), /origin/i);
});

test('isWrite marks the methods that change things', () => {
  assert.equal(isWrite('GET'), false);
  assert.equal(isWrite('head'), false);
  assert.equal(isWrite('POST'), true);
  assert.equal(isWrite('delete'), true);
  assert.equal(isWrite('PATCH'), true);
});

test('renderResponse leads with status and url', () => {
  const out = renderResponse({ status: 200, url: 'https://x.test/a', headers: {}, body: 'ok' });
  assert.match(out.split('\n')[0], /^200 .*https:\/\/x\.test\/a/);
});

test('renderResponse keeps only headers worth reading', () => {
  const out = renderResponse({
    status: 200,
    url: 'https://x.test/a',
    headers: { 'content-type': 'application/json', 'set-cookie': 'session=abc', 'x-frame-options': 'DENY' },
    body: '{}',
  });
  assert.match(out, /content-type/);
  // Never echo credentials back into the transcript.
  assert.doesNotMatch(out, /set-cookie/i);
  assert.doesNotMatch(out, /session=abc/);
});

test('a long body is truncated and says so', () => {
  const out = renderResponse({ status: 200, url: 'https://x.test/a', headers: {}, body: 'y'.repeat(50000) }, { maxChars: 100 });
  assert.equal(out.length < 400, true);
  assert.match(out, /truncated/);
});

test('a failed request renders the error rather than throwing', () => {
  const out = renderResponse({ error: 'NetworkError when attempting to fetch resource.' });
  assert.match(out, /NetworkError/);
});
