/**
 * SSRF guard for the AI Gateway base URL.
 *
 * Refuses anything that is not https:, refuses any host that is not on
 * the operator's allowlist, and refuses any IP literal that falls into a
 * private/loopback/link-local range even if it were on the allowlist
 * (defence-in-depth; the allowlist is the primary control).
 *
 * Returns the chat-completions endpoint URL on success, throws
 * `GatewayConfigError` on rejection.
 */
import { GatewayConfigError } from './ai-gateway-utils.js';

function isPrivateOrLoopbackIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 127) return true;                      // 127.0.0.0/8
  if (a === 169 && b === 254) return true;         // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16
  if (a === 0) return true;                        // 0.0.0.0/8
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    return true; // fe80::/10 link-local
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower === '::' || lower === '::ffff:0:0') return true;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1, ::ffff:127.0.0.1, etc.)
  const m = lower.match(/^::ffff:([0-9.]+)$/);
  if (m && m[1]) return isPrivateOrLoopbackIPv4(m[1]);
  return false;
}

const HARD_BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

export function resolveChatEndpoint(
  baseUrl: string,
  allowedHosts: string[],
): { endpoint: string; host: string } {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new GatewayConfigError('AI gateway base URL is not a valid URL.');
  }
  // HTTPS-only enforcement. This is the transport-security control: a
  // production operator who points the gateway at an `http://` URL is
  // either misconfigured or trying to MITM themselves, and the API key
  // would leak in cleartext over the wire. We refuse to start in that
  // case.
  //
  // The dev/verify harness (`AI_GATEWAY_ALLOW_LOOPBACK=true` against a
  // local 127.0.0.1 mock) needs HTTP, so we honour the same opt-out
  // here that the private/loopback check honours. The opt-out is
  // suppressed when `NODE_ENV=production`, so a production deploy
  // *cannot* accidentally talk to an HTTP gateway.
  const httpOptOut =
    process.env.AI_GATEWAY_ALLOW_LOOPBACK === 'true' &&
    process.env.NODE_ENV !== 'production';
  if (httpOptOut) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ai-gateway] AI_GATEWAY_ALLOW_LOOPBACK=true: allowing http:// ' +
        'base URL. This MUST NOT be enabled in production.',
    );
  } else if (parsed.protocol !== 'https:') {
    throw new GatewayConfigError(
      `AI gateway base URL must use https: (got '${parsed.protocol}').`,
    );
  }
  const hostRaw = parsed.hostname.toLowerCase();
  // URL.hostname for IPv6 literals keeps the surrounding brackets
  // (e.g. "[::1]"). Strip them so allowlist matching and IP-block
  // checks operate on the bare address.
  const host = hostRaw.startsWith('[') && hostRaw.endsWith(']')
    ? hostRaw.slice(1, -1)
    : hostRaw;
  if (!host) {
    throw new GatewayConfigError('AI gateway base URL has no host.');
  }
  if (HARD_BLOCKED_HOSTS.has(host)) {
    throw new GatewayConfigError(`AI gateway host '${host}' is blocked.`);
  }
  if (allowedHosts.length > 0 && !allowedHosts.includes(host)) {
    throw new GatewayConfigError(
      `AI gateway host '${host}' is not in AI_GATEWAY_ALLOWED_HOSTS.`,
    );
  }
  // Loopback / private IP guard. This is the SSRF defence: an
  // operator who accidentally pasted a metadata endpoint URL would
  // hit this and the request would never go out. The guard has an
  // explicit opt-out for local development and the verify harness
  // (AI_GATEWAY_ALLOW_LOOPBACK=true) — it is OFF by default and
  // logged loudly when ON. Production deploys must never set it.
  if (
    process.env.AI_GATEWAY_ALLOW_LOOPBACK === 'true' &&
    process.env.NODE_ENV !== 'production'
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ai-gateway] AI_GATEWAY_ALLOW_LOOPBACK=true: skipping SSRF ' +
        'private/loopback check. This MUST NOT be enabled in production.',
    );
  } else if (isPrivateOrLoopbackIPv4(host) || isBlockedIPv6(host)) {
    throw new GatewayConfigError(
      `AI gateway host '${host}' is a private/loopback address.`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new GatewayConfigError(
      'AI gateway base URL must not contain credentials in the URL.',
    );
  }
  // Normalise: strip trailing slash, append /chat/completions.
  const base = baseUrl.replace(/\/+$/, '');
  return { endpoint: base + '/chat/completions', host };
}
