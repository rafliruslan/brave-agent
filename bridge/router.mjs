/**
 * Which model runs a turn.
 *
 * Sonnet 5 at xhigh handles the ordinary case: read a page, post a message,
 * check Linear, answer a question. Opus 5 at xhigh is reserved for work that is
 * genuinely visual or genuinely deep, where the cost difference buys something.
 *
 * Both `--model` and `--effort` are per-invocation, so a thread that starts on
 * Sonnet can escalate for one turn and drop back. The session carries the
 * conversation, not the model choice.
 *
 * Routing is keyword-based on purpose. An LLM classifier would cost a round
 * trip on every message to decide something a word list gets right nearly
 * always, and the cost of being wrong here is one pricier run, not a failure.
 */

export const DEFAULT_MODEL = 'sonnet';
export const DEEP_MODEL = 'opus';
export const EFFORT = 'xhigh';

/**
 * Explicit override, checked first: the user can force either model by opening the
 * message with a bare word. `deep: compare these two dashboards` or
 * `fast: what's my next meeting`.
 */
const FORCE_DEEP = /^\s*(deep|opus|think(\s+hard)?)\s*[:,-]/i;
const FORCE_FAST = /^\s*(fast|quick|sonnet)\s*[:,-]/i;

/**
 * Visual work. A screenshot has to be looked at rather than parsed, and the
 * accessibility snapshot is no help for anything that is about pixels: layout,
 * spacing, colour, whether a design actually reads well.
 */
const VISUAL = [
  'screenshot', 'screen shot', 'look at', 'take a look', 'see if',
  'visual', 'visually', 'design', 'mockup', 'mock up', 'layout',
  'colour', 'color', 'spacing', 'alignment', 'font', 'image', 'photo',
  'chart', 'graph', 'diagram', 'ui', 'ux', 'looks right', 'looks good',
  'render', 'preview', 'thumbnail', 'logo', 'banner',
  // Drawing and whiteboard tools. Added 2026-08-25 after "can you draft on how
  // you works in excalidraw?" routed to Sonnet: these are <canvas> apps, so the
  // accessibility snapshot is empty and every step has to be done from
  // screenshots. That is the most visual work there is.
  'excalidraw', 'draw', 'drawing', 'sketch', 'whiteboard', 'wireframe',
  'flowchart', 'figma', 'miro', 'illustrate', 'annotate',
];

/**
 * Deep work: open-ended investigation, cross-referencing, or judgement, as
 * opposed to fetching a fact or sending a message.
 */
const DEEP = [
  'investigate', 'analyse', 'analyze', 'analysis', 'audit', 'research',
  'compare', 'comparison', 'why is', 'why did', 'why does', 'figure out',
  'root cause', 'debug', 'diagnose', 'thorough', 'in depth', 'in-depth',
  'deep dive', 'deep-dive', 'strategy', 'plan out', 'review the',
  'walk through', 'walkthrough', 'summarise my inbox', 'summarize my inbox',
  'across all', 'every channel', 'trace',
];

function matches(haystack, needles) {
  return needles.find((n) => haystack.includes(n)) || null;
}

/**
 * Choose a model for one turn.
 *
 * @param {string} text  what the user actually typed, mention already stripped
 * @returns {{model: string, effort: string, reason: string}}
 */
export function pickModel(text) {
  const raw = String(text ?? '');
  const lower = raw.toLowerCase();

  if (FORCE_FAST.test(raw)) {
    return { model: DEFAULT_MODEL, effort: EFFORT, reason: 'forced fast' };
  }
  if (FORCE_DEEP.test(raw)) {
    return { model: DEEP_MODEL, effort: EFFORT, reason: 'forced deep' };
  }

  const visual = matches(lower, VISUAL);
  if (visual) {
    return { model: DEEP_MODEL, effort: EFFORT, reason: `visual: "${visual}"` };
  }

  const deep = matches(lower, DEEP);
  if (deep) {
    return { model: DEEP_MODEL, effort: EFFORT, reason: `deep: "${deep}"` };
  }

  return { model: DEFAULT_MODEL, effort: EFFORT, reason: 'default' };
}

/**
 * Strip a leading `deep:` / `fast:` marker so the model never sees the routing
 * instruction as part of the task.
 */
export function stripDirective(text) {
  return String(text ?? '').replace(FORCE_DEEP, '').replace(FORCE_FAST, '').trimStart();
}
