/**
 * Validate a post-login redirect target.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE INPUT IS ATTACKER-CONTROLLED. The whole callback URL arrives in an email
 * and anyone can compose that email, so `next` is whatever the sender chose.
 * Handing it to redirect() unchecked makes /auth/callback an open redirect —
 * the most valuable kind to a phisher, because the victim really did just sign
 * in to the real site immediately before being bounced elsewhere.
 *
 * Accepts ONLY a same-site absolute path. Everything else falls back to "/".
 *
 * IN ITS OWN MODULE SO IT CAN BE TESTED. It previously lived inside the route
 * handler, where it could not be exercised without a valid single-use auth
 * code — meaning the security-critical branch was the one branch no test could
 * reach. A check nobody can test is a check nobody has verified.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/";

  // Must be a path, not a URL.
  if (!raw.startsWith("/")) return "/";

  // Protocol-relative in either slash form. "//evil.com" is a URL despite the
  // leading slash, and some parsers normalise "\" to "/".
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";

  // Control characters and whitespace can smuggle a header or confuse a parser.
  // RegExp constructor: literal control characters in a source file make it
  // binary to git, and \s here would otherwise be fine but is kept together.
  if (new RegExp("[\\u0000-\\u001f\\u007f\\s]").test(raw)) return "/";

  // Anything that still parses as an absolute URL with a scheme.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return "/";

  return raw;
}
