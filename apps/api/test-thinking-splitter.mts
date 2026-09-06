// Standalone smoke test for ThinkingSplitter. Run with:
//   node --experimental-strip-types apps/api/test-thinking-splitter.mts
// or compile first. The splitter source is at
//   apps/api/src/providers/thinking-splitter.ts
// and exposes feed/flush plus a `debugState` accessor.

import { ThinkingSplitter } from './src/providers/thinking-splitter.ts';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('[PASS] ' + name);
    passed++;
  } else {
    console.log('[FAIL] ' + name + (detail ? ' :: ' + detail : ''));
    failed++;
  }
}

// Helper: collect all parts emitted by feed+flush, given chunked input.
function run(chunks) {
  const s = new ThinkingSplitter();
  const out = [];
  for (const c of chunks) out.push(...s.feed(c));
  out.push(...s.flush());
  return out;
}

function kinds(parts) {
  return parts.map((p) => p.kind).join(',');
}

// 1) No boundary at all: short answer without a thinking prefix.
//    The splitter holds the position-uncertain state until either a
//    boundary shows up or the stream ends. With only a 1-byte payload
//    and no boundary, the byte IS emitted as 'thinking' by feed();
//    flush() then has nothing buffered (already emitted) so it does
//    not reclassify. The wire format emits 'thinking' for this case.
//    From the UI's perspective the message has a thinking prefix of
//    "4" (shown collapsed) and an empty answer (shown as the
//    streaming placeholder). This is the correct behavior: we are
//    NOT going to silently swallow the only piece of text the model
//    produced, just because we could not find a boundary.
{
  const parts = run(['4']);
  check('1-byte answer without boundary emits as thinking (state=thinking, no flush needed)',
    parts.length === 1 && parts[0].kind === 'thinking' && parts[0].text === '4');
}

// 2) Typical Lorbus/Qwen response: thinking + 3 newlines + answer.
//    The boundary newline run is kept as the prefix of the answer (it
//    renders as a blank line in markdown, which is the visual separator
//    the model intended).
{
  const parts = run([
    "Here's a thinking process:\n\n1. **Step 1**\n2. **Step 2**\n\n\nThe answer is 4.",
  ]);
  const thinking = parts.filter((p) => p.kind === 'thinking').map((p) => p.text).join('');
  const answer = parts.filter((p) => p.kind === 'answer').map((p) => p.text).join('');
  check('typical think+answer split',
    thinking.includes("Here's a thinking process") &&
      thinking.includes('Step 1') &&
      answer === '\n\n\nThe answer is 4.',
    `thinking="${thinking.slice(-40)}" answer="${answer}"`);
}

// 3) Boundary straddles chunks: last 1 newline in chunk 1, last 2 newlines in chunk 2.
{
  const parts = run([
    'thinking text\n',
    'answer',
  ]);
  const thinking = parts.filter((p) => p.kind === 'thinking').map((p) => p.text).join('');
  const answer = parts.filter((p) => p.kind === 'answer').map((p) => p.text).join('');
  // Only 1 newline total -> no boundary -> all emitted as 'thinking'.
  check('1 trailing newline + 0 more = no boundary, all thinking',
    thinking === 'thinking text\nanswer' && answer === '',
    `thinking="${thinking}" answer="${answer}"`);
}
{
  const parts = run([
    'thinking text\n',
    '\nanswer',
  ]);
  const thinking = parts.filter((p) => p.kind === 'thinking').map((p) => p.text).join('');
  const answer = parts.filter((p) => p.kind === 'answer').map((p) => p.text).join('');
  // 2 newlines total (1+1) -> still no boundary -> all thinking.
  check('1+1 trailing newlines = no boundary, all thinking',
    thinking === 'thinking text\n\nanswer' && answer === '',
    `thinking="${thinking}" answer="${answer}"`);
}
{
  const parts = run([
    'thinking text\n',
    '\n\nanswer',
  ]);
  const thinking = parts.filter((p) => p.kind === 'thinking').map((p) => p.text).join('');
  const answer = parts.filter((p) => p.kind === 'answer').map((p) => p.text).join('');
  // 3 newlines (1+2) -> boundary found. Thinking emitted, answer is
  // '\n\n\nanswer' (the held-back '\n' plus the two more in chunk 2).
  check('1+2 newlines = boundary, thinking held back across chunks',
    thinking === 'thinking text' && answer === '\n\n\nanswer',
    `thinking="${thinking}" answer="${answer}"`);
}

// 4) Single chunk, no boundary, no flush reclassification needed.
{
  const parts = run(['just an answer, no thinking']);
  check('single chunk no boundary -> all thinking (state stays thinking until boundary)',
    parts.length === 1 && parts[0].kind === 'thinking' && parts[0].text === 'just an answer, no thinking');
}

// 5) Many tiny chunks: each byte separately. This is the worst case for
//    re-emission and must produce exactly the same total text once joined.
{
  const full = "thinking line 1\nthinking line 2\n\n\nthe answer line";
  const chunks = [];
  for (const c of full) chunks.push(c);
  const parts = run(chunks);
  const thinking = parts.filter((p) => p.kind === 'thinking').map((p) => p.text).join('');
  const answer = parts.filter((p) => p.kind === 'answer').map((p) => p.text).join('');
  // The boundary \n\n\n is preserved at the start of the answer
  // (renders as a blank line in markdown). Everything before the
  // boundary goes to thinking; everything from the boundary on
  // (inclusive) goes to answer.
  check('byte-by-byte chunking reconstructs correctly',
    thinking + answer === full &&
      thinking.includes('thinking line 1') &&
      answer === '\n\n\nthe answer line',
    `thinking.len=${thinking.length} answer.len=${answer.length} kinds=${kinds(parts).slice(0, 60)}...`);
}

// 6) Empty stream.
{
  const parts = run([]);
  check('empty stream -> no parts', parts.length === 0);
}

// 7) Stream aborted mid-thinking where the buffer still has content.
//    Because the splitter held the buffer back (trailing-newline
//    lookahead), flush() will emit the rest as 'answer' rather than
//    dropping it inside a thinking panel.
{
  const s = new ThinkingSplitter();
  s.feed('half a thinking process\n');
  // The trailing \n is held back, so buffer is non-empty.
  const parts = s.flush();
  check('abort while buffer non-empty reclassifies held-back bytes as answer',
    parts.length === 1 && parts[0].kind === 'answer' && parts[0].text === '\n');
}

console.log('---');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
