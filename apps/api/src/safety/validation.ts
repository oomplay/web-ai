/**
 * Input validation for the public chat endpoint.
 *
 * The policy enforced here is intentionally simple and explicit. The product
 * is a "no account, no signup" public chat, so:
 *   - The `system` role is NOT supported. Clients cannot inject system
 *     prompts; if they try, the request is rejected with HTTP 400.
 *   - Hard caps on message count, per-message length, and total length
 *     prevent trivial memory-exhaustion attacks.
 *
 * The error messages returned to the client do NOT echo the offending input
 * verbatim and do NOT include internal identifiers. Server-side logging is
 * the operator's job, not the user's.
 */

export interface ValidationConfig {
  maxMessages: number;
  maxMessageLength: number;
  maxTotalChars: number;
}

export type ValidationResult =
  | { ok: true; messages: Array<{ role: 'user' | 'assistant'; content: string }> }
  | { ok: false; reason: string; status: 400 };

function isPublicRole(s: unknown): s is 'user' | 'assistant' {
  return s === 'user' || s === 'assistant';
}

export function validateChatInput(
  body: unknown,
  cfg: ValidationConfig,
): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'Invalid request body.', status: 400 };
  }
  const b = body as { model?: unknown; messages?: unknown };

  if (typeof b.model !== 'string' || b.model.length === 0 || b.model.length > 256) {
    return { ok: false, reason: 'Invalid model.', status: 400 };
  }
  // Model id charset. Some upstream providers expose ids with `/`
  // (provider/model), spaces, parentheses, or unicode. We allow a wide
  // set of printable characters but reject control characters (which
  // would let an attacker inject CRLF into the JSON request body or
  // into log lines) and the JSON-significant `"` and `\\` (which would
  // let them break out of the JSON envelope). The authoritative
  // allowlist still lives in the provider (`allowedModels`), so even a
  // permissive charset here cannot route an unknown model to the
  // upstream.
  if (/[\x00-\x1f\x7f"\\]/.test(b.model)) {
    return { ok: false, reason: 'Invalid model.', status: 400 };
  }

  if (!Array.isArray(b.messages)) {
    return { ok: false, reason: 'Invalid messages.', status: 400 };
  }
  if (b.messages.length === 0) {
    return { ok: false, reason: 'Messages must not be empty.', status: 400 };
  }
  if (b.messages.length > cfg.maxMessages) {
    return {
      ok: false,
      reason: `Too many messages. Limit is ${cfg.maxMessages}.`,
      status: 400,
    };
  }

  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let totalChars = 0;
  for (const m of b.messages) {
    if (!m || typeof m !== 'object') {
      return { ok: false, reason: 'Invalid message.', status: 400 };
    }
    const r = (m as { role?: unknown }).role;
    if (!isPublicRole(r)) {
      // Public clients cannot send `system` (or any other role). Be honest
      // about the policy but do not echo the offending value.
      return { ok: false, reason: 'Unsupported role.', status: 400 };
    }
    const c = (m as { content?: unknown }).content;
    if (typeof c !== 'string') {
      return { ok: false, reason: 'Invalid message content.', status: 400 };
    }
    if (c.length > cfg.maxMessageLength) {
      return {
        ok: false,
        reason: `Message too long. Limit is ${cfg.maxMessageLength} characters.`,
        status: 400,
      };
    }
    totalChars += c.length;
    if (totalChars > cfg.maxTotalChars) {
      return {
        ok: false,
        reason: `Conversation too long. Total limit is ${cfg.maxTotalChars} characters.`,
        status: 400,
      };
    }
    out.push({ role: r, content: c });
  }
  return { ok: true, messages: out };
}

/**
 * Resolve the best-effort client IP. Honors `app.get('trust proxy')` so it
 * works correctly behind a reverse proxy. Falls back to the raw socket
 * address when the forwarded chain is untrusted or missing.
 */
export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
