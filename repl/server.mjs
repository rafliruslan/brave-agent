#!/usr/bin/env node
/**
 * brave-repl: batched, typed browser actions over an existing CDP connection.
 *
 * This exists to close the round-trip gap with single-`repl` agents like Aside,
 * where one 120-second call can snapshot, decide, act and verify. Granular MCP
 * tools are safer but chatty: a Google Calendar out-of-office event took ~15
 * separate tool calls, most of them re-reading a page that had barely changed.
 *
 * Two ideas do most of the work:
 *
 *   1. `snapshot` returns a DIFF. Measured on Google Calendar: the full tree is
 *      ~5.5KB, and the diff after opening a menu is 190 bytes. A follow-up call
 *      should not have to re-read the whole page to learn that four menu items
 *      appeared.
 *
 *   2. `act` takes a LIST of typed steps and runs them in one call, stopping at
 *      the first failure and returning the diff afterwards.
 *
 * What it deliberately does not do is evaluate arbitrary script. `op` is a
 * closed enum, so nothing here can express "run this JavaScript". That is the
 * whole difference from a REPL: the efficiency without the capability that
 * leaves half-completed forms behind.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright-core';
import { collect } from './snapshot.mjs';

const CDP = process.env.BRAVE_CDP_ENDPOINT || 'http://127.0.0.1:9222';

let browser = null;
/** Last serialised snapshot per page URL, so `diff` has something to compare. */
const lastSerial = new Map();

async function connect() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.connectOverCDP(CDP);
  return browser;
}

function allPages(b) {
  return b.contexts().flatMap((c) => c.pages());
}

/**
 * Resolve which page to act on. Defaults to the last one snapshotted, then to
 * whichever is frontmost, because an agent almost always means "the page I was
 * just looking at" rather than "page 0".
 */
async function resolvePage(b, match) {
  const pages = allPages(b);
  if (!pages.length) throw new Error('No pages open in the browser.');
  if (match === undefined || match === null || match === '') {
    return pages.find((p) => lastSerial.has(p.url())) || pages[0];
  }
  if (typeof match === 'number') {
    if (!pages[match]) throw new Error(`No page at index ${match}; ${pages.length} open.`);
    return pages[match];
  }
  const needle = String(match).toLowerCase();
  const hit = pages.find(
    (p) => p.url().toLowerCase().includes(needle) || (p._brTitle || '').toLowerCase().includes(needle),
  );
  if (hit) return hit;
  for (const p of pages) {
    const t = (await p.title().catch(() => '')).toLowerCase();
    if (t.includes(needle)) return p;
  }
  throw new Error(`No open page matching ${JSON.stringify(match)}.`);
}

function locate(page, ref) {
  if (!/^e\d+$/.test(String(ref))) {
    throw new Error(`Bad ref ${JSON.stringify(ref)}. Refs look like "e42" and come from snapshot.`);
  }
  return page.locator(`[data-bref="${ref}"]`);
}

/**
 * Click, preferring real input.
 *
 * Playwright's actionability gate requires the bounding box to be unchanged
 * across two consecutive animation frames, which continuously animating pages
 * never satisfy — Google Calendar refuses every time while being perfectly
 * clickable. So: try a real click briefly, and fall back to a DOM click rather
 * than failing. Report which path ran, because a DOM click bypasses handlers a
 * real one would trigger and that occasionally matters.
 */
async function clickSmart(page, ref) {
  const loc = locate(page, ref);
  try {
    await loc.click({ timeout: 2500 });
    return 'input';
  } catch (err) {
    if (!/stable|visible|enabled|timeout/i.test(err.message)) throw err;
    await loc.evaluate((el) => el.click());
    return 'dom';
  }
}

async function runStep(page, step, i) {
  const op = step.op;
  switch (op) {
    case 'click':
      return { i, op, ref: step.ref, via: await clickSmart(page, step.ref) };
    case 'type': {
      const loc = locate(page, step.ref);
      await loc.evaluate((el) => el.focus());
      if (step.clear) await page.keyboard.press('ControlOrMeta+A').catch(() => {});
      await page.keyboard.type(String(step.text ?? ''), { delay: step.delay ?? 20 });
      return { i, op, ref: step.ref, typed: String(step.text ?? '').length };
    }
    case 'press':
      await page.keyboard.press(String(step.key));
      return { i, op, key: step.key };
    case 'navigate':
      await page.goto(String(step.url), { waitUntil: 'domcontentloaded' });
      return { i, op, url: step.url };
    case 'select': {
      const loc = locate(page, step.ref);
      const picked = await loc.selectOption(String(step.value));
      return { i, op, ref: step.ref, picked };
    }
    case 'wait':
      if (step.forText) {
        await page.getByText(String(step.forText)).first().waitFor({ timeout: step.timeout ?? 10000 });
        return { i, op, forText: step.forText };
      }
      await page.waitForTimeout(Math.min(step.ms ?? 500, 15000));
      return { i, op, ms: step.ms ?? 500 };
    case 'screenshot': {
      const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
      return { i, op, screenshot: buf.toString('base64'), bytes: buf.length };
    }
    default:
      throw new Error(
        `Unknown op ${JSON.stringify(op)}. Allowed: click, type, press, navigate, select, wait, screenshot. ` +
          `There is deliberately no op for running arbitrary script.`,
      );
  }
}

async function snapshotPage(page, mode) {
  const prev = mode === 'diff' ? lastSerial.get(page.url()) ?? null : null;
  const r = await page.evaluate(collect, prev);
  lastSerial.set(r.url, r.serial);
  page._brTitle = r.title;
  return r;
}

function renderSnapshot(r, mode) {
  const head = `${r.title}\n${r.url}\n${r.count} refs`;
  if (mode === 'diff' && r.diff) {
    const { added, removed, unchanged } = r.diff;
    if (!added.length && !removed.length) return `${head}\n\nNo change since the last snapshot.`;
    return (
      `${head}\n\nDIFF  +${added.length} -${removed.length}  (${unchanged} unchanged)\n` +
      (added.length ? `\nAPPEARED\n${added.join('\n')}\n` : '') +
      (removed.length ? `\nGONE\n${removed.join('\n')}\n` : '')
    );
  }
  return `${head}\n\n${r.serial}`;
}

const TOOLS = [
  {
    name: 'snapshot',
    description:
      'Accessibility tree of a page with stable [ref=eNN] ids. mode "diff" returns only what appeared and disappeared since your last snapshot of that page, which is usually a fraction of the size — measured at 190 bytes against a 5.5KB full tree. Use diff for every read after the first. These refs work only with this server; mcp__brave__ and mcp__devtools__ each use their own.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: ['string', 'number'], description: 'URL substring, title substring, or index. Defaults to the page you last snapshotted.' },
        mode: { type: 'string', enum: ['full', 'diff'], default: 'full' },
      },
    },
  },
  {
    name: 'act',
    description:
      'Run several typed browser steps in ONE call, then return the snapshot diff. Worth using only when the steps are INDEPENDENT of each other: filling six known form fields then submitting, or a fixed navigate-wait-screenshot sequence. It does NOT help when a step needs a ref you can only learn from the previous step\'s result, which is most browser work — measured on a real task, batching saved zero turns because the menu had to open before its items could be referenced. Steps stop at the first failure by default and report which one failed with the page state at that moment. Clicks try real input first and fall back to a DOM click when Playwright\'s stability gate refuses, which it always does on continuously animating pages.',
    inputSchema: {
      type: 'object',
      required: ['steps'],
      properties: {
        page: { type: ['string', 'number'] },
        stopOnError: { type: 'boolean', default: true },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            required: ['op'],
            properties: {
              op: { type: 'string', enum: ['click', 'type', 'press', 'navigate', 'select', 'wait', 'screenshot'] },
              ref: { type: 'string', description: 'From snapshot, e.g. "e42"' },
              text: { type: 'string' },
              clear: { type: 'boolean', description: 'Select-all before typing' },
              key: { type: 'string', description: 'e.g. "Enter", "Escape", "ControlOrMeta+A"' },
              url: { type: 'string' },
              value: { type: 'string' },
              forText: { type: 'string', description: 'wait until this text is visible' },
              ms: { type: 'number' },
              timeout: { type: 'number' },
              delay: { type: 'number' },
            },
          },
        },
      },
    },
  },
  {
    name: 'pages',
    description: 'List open tabs with index, title and URL.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const server = new Server({ name: 'brave-repl', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    const b = await connect();

    if (name === 'pages') {
      const pages = allPages(b);
      const rows = await Promise.all(
        pages.map(async (p, i) => `${i}: ${await p.title().catch(() => '?')} — ${p.url()}`),
      );
      return { content: [{ type: 'text', text: rows.join('\n') }] };
    }

    if (name === 'snapshot') {
      const page = await resolvePage(b, args.page);
      const r = await snapshotPage(page, args.mode || 'full');
      return { content: [{ type: 'text', text: renderSnapshot(r, args.mode || 'full') }] };
    }

    if (name === 'act') {
      const page = await resolvePage(b, args.page);
      const steps = Array.isArray(args.steps) ? args.steps : [];
      if (!steps.length) throw new Error('act needs at least one step.');
      const stopOnError = args.stopOnError !== false;

      const results = [];
      const shots = [];
      let failed = null;

      for (let i = 0; i < steps.length; i++) {
        try {
          const r = await runStep(page, steps[i], i);
          if (r.screenshot) {
            shots.push(r.screenshot);
            delete r.screenshot;
          }
          results.push(r);
        } catch (err) {
          failed = { i, op: steps[i]?.op, error: err.message.split('\n')[0] };
          results.push({ i, op: steps[i]?.op, error: failed.error });
          if (stopOnError) break;
        }
      }

      // Always report state afterwards. A step that "succeeded" is not evidence
      // the app accepted it, and this is the cheapest way to check.
      const snap = await snapshotPage(page, 'diff');
      const lines = [
        `${results.length}/${steps.length} steps run` + (failed ? `, FAILED at step ${failed.i} (${failed.op}): ${failed.error}` : ''),
        results.map((r) => `  ${r.i} ${r.op}${r.via ? ` via ${r.via}` : ''}${r.error ? ` ERROR ${r.error}` : ' ok'}`).join('\n'),
        '',
        renderSnapshot(snap, 'diff'),
      ];
      const content = [{ type: 'text', text: lines.join('\n') }];
      for (const s of shots) content.push({ type: 'image', data: s, mimeType: 'image/jpeg' });
      return { content, isError: Boolean(failed) };
    }

    throw new Error(`Unknown tool ${name}`);
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
