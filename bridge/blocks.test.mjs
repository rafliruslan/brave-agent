import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlocks, parseInline } from './blocks.mjs';

const sections = (text) => buildBlocks(text)[0].elements;

test('parseInline returns plain text unchanged', () => {
  assert.deepEqual(parseInline('hello there'), [{ type: 'text', text: 'hello there' }]);
});

test('parseInline marks bold', () => {
  assert.deepEqual(parseInline('*Sale:* Fina'), [
    { type: 'text', text: 'Sale:', style: { bold: true } },
    { type: 'text', text: ' Fina' },
  ]);
});

test('parseInline marks code and leaves its contents literal', () => {
  assert.deepEqual(parseInline('order `10&34`'), [
    { type: 'text', text: 'order ' },
    { type: 'text', text: '10&34', style: { code: true } },
  ]);
});

test('parseInline marks italic', () => {
  assert.deepEqual(parseInline('_Focus time_'), [
    { type: 'text', text: 'Focus time', style: { italic: true } },
  ]);
});

test('parseInline builds a labelled link', () => {
  assert.deepEqual(parseInline('see <https://a1c.io|the site>'), [
    { type: 'text', text: 'see ' },
    { type: 'link', url: 'https://a1c.io', text: 'the site' },
  ]);
});

test('parseInline builds a bare link', () => {
  assert.deepEqual(parseInline('<https://a1c.io>'), [{ type: 'link', url: 'https://a1c.io' }]);
});

// A mention must stay a real mention, not the raw id.
test('parseInline builds a user mention', () => {
  assert.deepEqual(parseInline('hi <@U08GZ0APDKL>'), [
    { type: 'text', text: 'hi ' },
    { type: 'user', user_id: 'U08GZ0APDKL' },
  ]);
});

// rich_text takes literal characters, unlike mrkdwn which needs them escaped.
test('parseInline decodes escaped entities', () => {
  assert.deepEqual(parseInline('Product &amp; Engineering'), [
    { type: 'text', text: 'Product & Engineering' },
  ]);
});

test('buildBlocks returns null for empty input', () => {
  assert.equal(buildBlocks(''), null);
  assert.equal(buildBlocks('   \n  '), null);
  assert.equal(buildBlocks(null), null);
});

test('buildBlocks wraps everything in one rich_text block', () => {
  const blocks = buildBlocks('hello');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'rich_text');
});

// The whole point: a real list, not a literal bullet character.
test('buildBlocks turns bullet lines into a native list', () => {
  const els = sections('• first\n• second');
  assert.equal(els.length, 1);
  assert.equal(els[0].type, 'rich_text_list');
  assert.equal(els[0].style, 'bullet');
  assert.equal(els[0].elements.length, 2);
  assert.deepEqual(els[0].elements[0].elements, [{ type: 'text', text: 'first' }]);
});

test('buildBlocks accepts hyphen markers as bullets too', () => {
  const els = sections('- first\n- second');
  assert.equal(els[0].type, 'rich_text_list');
  assert.equal(els[0].style, 'bullet');
});

test('buildBlocks builds an ordered list', () => {
  const els = sections('1. first\n2. second');
  assert.equal(els[0].type, 'rich_text_list');
  assert.equal(els[0].style, 'ordered');
  assert.equal(els[0].elements.length, 2);
});

test('buildBlocks keeps a lead line separate from the list', () => {
  const els = sections('Seven things, Captain\n\n• first\n• second');
  assert.equal(els.length, 2);
  assert.equal(els[0].type, 'rich_text_section');
  assert.equal(els[1].type, 'rich_text_list');
});

test('buildBlocks does not mix bullet and ordered into one list', () => {
  const els = sections('• a\n1. b');
  assert.equal(els.length, 2);
  assert.equal(els[0].style, 'bullet');
  assert.equal(els[1].style, 'ordered');
});

test('buildBlocks joins consecutive prose lines into one section', () => {
  const els = sections('line one\nline two');
  assert.equal(els.length, 1);
  assert.deepEqual(els[0].elements, [
    { type: 'text', text: 'line one' },
    { type: 'text', text: '\n' },
    { type: 'text', text: 'line two' },
  ]);
});

test('buildBlocks handles a list followed by more prose', () => {
  const els = sections('• only item\n\nNext: do the thing');
  assert.equal(els[0].type, 'rich_text_list');
  assert.equal(els[1].type, 'rich_text_section');
});

test('buildBlocks carries formatting inside list items', () => {
  const els = sections('• *Sale:* Fina (`FINA5`)');
  const item = els[0].elements[0].elements;
  assert.deepEqual(item[0], { type: 'text', text: 'Sale:', style: { bold: true } });
  assert.deepEqual(item[2], { type: 'text', text: 'FINA5', style: { code: true } });
});

// Shape check against the real reply she sent, so the schema stays valid.
test('buildBlocks produces a valid shape for a real reply', () => {
  const blocks = buildBlocks(
    'Both checked, Captain :heartpulse:\n\n• `example.com` → *Example Domain*\n• `wikipedia.org` → *Wikipedia*\n\nNext: say the word.',
  );
  assert.equal(blocks[0].type, 'rich_text');
  const types = blocks[0].elements.map((e) => e.type);
  assert.deepEqual(types, ['rich_text_section', 'rich_text_list', 'rich_text_section']);
  for (const el of blocks[0].elements) {
    const groups = el.type === 'rich_text_list' ? el.elements : [el];
    for (const g of groups) {
      assert.equal(g.type, 'rich_text_section');
      assert.ok(Array.isArray(g.elements) && g.elements.length > 0);
    }
  }
});

// She writes things like *`PE-779`:* and a flat parser rendered the backticks
// as visible characters inside the bold run.
test('parseInline handles code nested inside bold', () => {
  assert.deepEqual(parseInline('*`PE-779`:*'), [
    { type: 'text', text: 'PE-779', style: { bold: true, code: true } },
    { type: 'text', text: ':', style: { bold: true } },
  ]);
});

test('parseInline handles bold nested inside italic', () => {
  assert.deepEqual(parseInline('_soft *hard* soft_'), [
    { type: 'text', text: 'soft ', style: { italic: true } },
    { type: 'text', text: 'hard', style: { italic: true, bold: true } },
    { type: 'text', text: ' soft', style: { italic: true } },
  ]);
});

test('parseInline still omits style on plain text', () => {
  assert.deepEqual(parseInline('plain'), [{ type: 'text', text: 'plain' }]);
});

// A fenced table must land in a monospaced block, not be parsed as prose.
test('buildBlocks turns a fenced block into preformatted', () => {
  const els = sections('Prices:\n```\n| MYR | SGD |\n| RM89 | S$29 |\n```');
  assert.equal(els[0].type, 'rich_text_section');
  assert.equal(els[1].type, 'rich_text_preformatted');
  assert.match(els[1].elements[0].text, /RM89/);
  assert.match(els[1].elements[0].text, /\|/);
});

test('buildBlocks keeps content from an unterminated fence', () => {
  const els = sections('```\nstill useful');
  assert.equal(els[0].type, 'rich_text_preformatted');
  assert.match(els[0].elements[0].text, /still useful/);
});
