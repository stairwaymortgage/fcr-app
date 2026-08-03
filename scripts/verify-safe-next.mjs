/**
 * Post-login redirect validation — lib/safe-next.ts
 *
 * Run:
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning
 *     scripts/verify-safe-next.mjs
 *
 * The flag is what lets this import the REAL module rather than a copy of it.
 * safe-next.ts was pulled out of /auth/callback precisely so it could be
 * exercised without a valid single-use auth code — "a check nobody can test is
 * a check nobody has verified". Re-implementing its rules here would hand that
 * property straight back: the copy would pass while the shipped function
 * rotted.
 *
 * No env, no network, no Supabase. Pure function, so this runs anywhere and in
 * milliseconds — unlike the other verify-* scripts it has no cleanup and cannot
 * leave state behind.
 *
 * TWO CALLERS DEPEND ON THIS, and they did not always agree:
 *   app/auth/callback/route.ts:61   safeNext(searchParams.get("next"))
 *   app/login/page.tsx:52           safeNext(searchParams.next)
 * The login page previously used its own inline check. The REGRESSION section
 * at the bottom pins the three shapes that check let through.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY CONTROL CHARACTER AND BACKSLASH HERE IS BUILT WITH String.fromCharCode,
 * AND THAT IS NOT STYLE.
 *
 * A literal control byte in the source makes this file BINARY TO GIT — no
 * diff, no review, and a security test nobody can read is worth about as much
 * as one nobody can run. That is the same reason safe-next.ts assembles its
 * character class with the RegExp constructor rather than a literal.
 *
 * Escape sequences would read better and are the obvious alternative. They are
 * avoided because they do not survive every editor and tooling path intact:
 * writing this file, "backslash-u-0-0-0-0" was silently turned into a real NUL
 * byte, which is exactly the outcome the rule exists to prevent. fromCharCode
 * cannot be mangled that way — it is ordinary code, and it says the codepoint
 * out loud.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { safeNext } from "../lib/safe-next.ts";

const ch = String.fromCharCode;
const BACKSLASH = ch(92);
const NUL = ch(0);
const SOH = ch(1);
const TAB = ch(9);
const LF = ch(10);
const CR = ch(13);
const DEL = ch(127);

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "  PASS" : "  ****FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
  c ? pass++ : fail++;
};

/** Blank line then a heading. Written this way to keep newline escapes out. */
const head = (t) => { console.log(""); console.log(t); };

/** Survives untouched — a legitimate same-site destination. */
const keeps = (input, why) => {
  const got = safeNext(input);
  ok(why, got === input, `${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
};

/** Refused and replaced with the homepage. */
const drops = (input, why) => {
  const got = safeNext(input);
  ok(why, got === "/", `${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
};

head("── LEGITIMATE TARGETS PASS THROUGH ─────────────────────");
keeps("/dashboard", "a plain path");
keeps("/dashboard?tab=inquiries", "a path with a query string");
keeps("/contractor/abc-plumbing/claim", "the claim path middleware actually sets");
keeps("/manage/profile#licence", "a fragment is not stripped");
keeps("/", "the homepage itself");

head("── NOTHING TO REDIRECT TO ──────────────────────────────");
drops(null, "null becomes the homepage");
drops(undefined, "undefined becomes the homepage");
drops("", "an empty string becomes the homepage");

head("── PROTOCOL-RELATIVE URLS ARE NOT PATHS ────────────────");
// Leading slash, but the browser reads these as another origin entirely.
drops("//evil.com", "//evil.com");
drops("//evil.com/login", "//evil.com with a path");
drops("/" + BACKSLASH + "evil.com", "backslash form some parsers normalise");
drops("/" + BACKSLASH + "/evil.com", "mixed slash form");

head("── ABSOLUTE URLS AND SCHEMES ───────────────────────────");
drops("https://evil.com", "https://");
drops("http://evil.com", "http://");
drops("javascript:alert(1)", "javascript:");
drops("mailto:someone@evil.com", "mailto:");
drops("data:text/html,<script>alert(1)</script>", "data:");
drops("evil.com", "a bare host with no leading slash");
drops("../admin", "a relative path");

head("── WHITESPACE AND CONTROL CHARACTERS ───────────────────");
// Either can smuggle a header past a naive parser or disguise the real target.
drops("/dashboard ", "a trailing space");
drops(" /dashboard", "a leading space");
drops("/dash board", "an interior space");
drops("/dashboard" + TAB, "a tab");
drops("/dashboard" + LF, "a newline");
drops("/dashboard" + CR + LF + "Location: https://evil.com", "a CRLF header-injection attempt");
drops("/dashboard" + NUL, "a NUL byte");
drops("/dashboard" + DEL, "DEL");
drops("/dash" + SOH + "board", "an interior control character");

head("── REGRESSION: WHAT THE OLD INLINE CHECK ALLOWED ───────");
/**
 * app/login/page.tsx used to gate on:
 *
 *   next.startsWith("/") && !next.startsWith("//")
 *
 * which caught //evil.com and absolute URLs but nothing below. Reachable only
 * by an already-signed-in visitor following a crafted link — narrow, and it was
 * the one redirect in the flow not covered by this module.
 */
const oldCheck = (n) => Boolean(n && n.startsWith("/") && !n.startsWith("//"));
for (const [input, label] of [
  ["/" + BACKSLASH + "evil.com", "backslash protocol-relative"],
  ["/dashboard" + CR + LF + "Location: https://evil.com", "CRLF injection"],
  ["/dash board", "interior whitespace"],
]) {
  ok(`the old check accepted ${label}; safeNext refuses it`,
     oldCheck(input) && safeNext(input) === "/",
     JSON.stringify(input));
}

console.log("");
console.log("═".repeat(56));
console.log(`  ${pass} passed, ${fail} failed`);
console.log("═".repeat(56));
process.exit(fail === 0 ? 0 : 1);
