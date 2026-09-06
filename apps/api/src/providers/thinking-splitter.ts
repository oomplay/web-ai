/**
 * Splits a provider's streamed content into a "thinking" prefix and an
 * "answer" suffix.
 *
 * Background
 * ----------
 * Some models (e.g. Lorbus/Qwen3.6-27B-int4-AutoRound behind the KiwiCraft
 * gateway) do not expose their chain-of-thought as a separate
 * `reasoning_content` field, the way dedicated reasoning models do. They
 * instead concatenate "Here's a thinking process: …" and the actual reply
 * into a single `content` string, separated by a paragraph of three or
 * more blank lines (`\n\s*\n\s*\n`). The answer is always the part
 * AFTER the last such boundary.
 *
 * Why this is a streaming problem
 * --------------------------------
 * The upstream emits the content token by token. The boundary regex can
 * straddle chunks: e.g. the first chunk might end with `\n` and the next
 * one begins with `\n\nFoo bar…`. If we naively emit every chunk as soon
 * as it arrives, the first chunk of the answer would be classified as
 * "thinking" because the boundary has not been seen yet, and then re-
 * classified on the next chunk, producing visible flicker.
 *
 * Algorithm
 * ---------
 * State machine with two states: THINKING and ANSWER.
 *
 *   - THINKING:
 *       * If the buffer contains the boundary regex, split at the LAST
 *         match, emit everything before it as thinking, switch to
 *         ANSWER, and re-process the tail.
 *       * Otherwise, if the buffer ends with 1 or 2 newlines (the
 *         longest possible boundary prefix), hold those back and emit
 *         the rest as thinking.
 *       * Otherwise, emit the whole buffer as thinking.
 *   - ANSWER:
 *       * Emit everything as answer; never look for another boundary.
 *         (The model is supposed to have only one think/answer split.)
 *
 * On `flush()`, if we never saw a boundary, the entire stream is
 * classified as "answer" so a short response with no thinking is not
 * lost inside a closed thinking panel.
 */
export type StreamPart = { kind: 'thinking' | 'answer'; text: string };

const BOUNDARY = /\n\s*\n\s*\n/;
// The boundary contains at least 3 newlines; the longest *prefix* of the
// boundary that can be ambiguous with "just trailing newlines" is 2
// newlines. Holding back more would needlessly delay the very last bit
// of visible content.
const MAX_HOLD_NEWLINES = 2;

export class ThinkingSplitter {
  private state: 'thinking' | 'answer' = 'thinking';
  private buffer = '';

  /**
   * Feed a chunk of raw text. Returns zero or more parts to emit. The
   * caller MUST eventually call `flush()` once the stream ends so a
   * short response without a boundary is correctly classified as answer.
   */
  feed(chunk: string): StreamPart[] {
    if (chunk.length === 0) return [];
    this.buffer += chunk;
    const out: StreamPart[] = [];
    // We may cross the boundary and then still have leftover bytes that
    // belong to the answer; loop until the buffer is drained or until
    // we are back in THINKING and cannot progress without more data.
    // The loop is bounded because in THINKING state we always either
    // find a boundary (and re-enter ANSWER which drains the rest in one
    // step) or hold back a finite suffix.
    for (;;) {
      if (this.state === 'thinking') {
        // Look for the boundary anywhere in the buffer. We anchor on the
        // FIRST match (not last) because once we see the boundary, any
        // additional newlines are part of the answer (which cannot
        // contain another boundary, per the contract).
        const m = BOUNDARY.exec(this.buffer);
        if (m) {
          const thinking = this.buffer.slice(0, m.index);
          // Keep the boundary characters as the first bytes of the
          // answer. They render as a blank line in markdown, which is
          // the visual separator the model intended between its
          // thinking block and the final answer. Dropping them would
          // change the rendered output by one visible blank line.
          this.buffer = this.buffer.slice(m.index);
          if (thinking.length > 0) out.push({ kind: 'thinking', text: thinking });
          this.state = 'answer';
          // Fall through to process the remaining buffer in ANSWER.
          continue;
        }
        // No boundary yet. Decide how much of the buffer is safe to emit.
        // We must not emit a suffix that COULD grow into a boundary on
        // the next chunk. The boundary has at least 3 newlines, so the
        // longest ambiguous suffix is 2 newlines (with optional
        // whitespace). We count the trailing whitespace run that ends
        // in \n.
        const tailMatch = /\n\s*$/.exec(this.buffer);
        const tailLen = tailMatch ? tailMatch[0].length : 0;
        if (tailLen > 0 && tailLen <= MAX_HOLD_NEWLINES) {
          const safeLen = this.buffer.length - tailLen;
          if (safeLen > 0) {
            out.push({ kind: 'thinking', text: this.buffer.slice(0, safeLen) });
            this.buffer = this.buffer.slice(safeLen);
          }
        } else {
          // No trailing-newline ambiguity (tailLen === 0) or the run is
          // already longer than what could be a boundary prefix. Emit
          // everything we have.
          if (this.buffer.length > 0) {
            out.push({ kind: 'thinking', text: this.buffer });
            this.buffer = '';
          }
        }
        return out;
      }
      // ANSWER: emit everything as answer and stop until the next chunk.
      if (this.buffer.length > 0) {
        out.push({ kind: 'answer', text: this.buffer });
        this.buffer = '';
      }
      return out;
    }
  }

  /**
   * Signal end-of-stream. Returns any remaining buffered content.
   *
   * If we never saw a boundary, the whole stream is reclassified as
   * "answer" so a short response (e.g. "2 + 2 = 4" with no thinking
   * preamble) is not lost inside a thinking panel the user has to
   * manually expand.
   */
  flush(): StreamPart[] {
    if (this.buffer.length === 0) return [];
    if (this.state === 'thinking') {
      // No boundary in the entire stream -> fallback to plain answer.
      const text = this.buffer;
      this.buffer = '';
      this.state = 'answer';
      return [{ kind: 'answer', text }];
    }
    const text = this.buffer;
    this.buffer = '';
    return [{ kind: 'answer', text }];
  }

  /** Test-only accessor. */
  get debugState(): { state: 'thinking' | 'answer'; bufferedChars: number } {
    return { state: this.state, bufferedChars: this.buffer.length };
  }
}
