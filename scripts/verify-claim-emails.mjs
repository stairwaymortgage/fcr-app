/**
 * Claim decision email copy — lib/email-copy.ts
 *
 * Run:
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning
 *     scripts/verify-claim-emails.mjs
 *
 * NO NETWORK, NO ENV, NO SUPABASE, NO RESEND KEY. render() is pure and takes
 * the origin as an argument, so every assertion below is a string comparison.
 * Nothing here can send an email to anybody, which is the point: this file is
 * safe to run on any machine at any time, including against production config.
 *
 * WHY THE COPY IS TESTED AT ALL. A decision email is received once. If the link
 * is wrong, or the rejection reason is missing, or the approved template leaks
 * something it should not, the contractor cannot ask us to resend it and will
 * usually not report it — they will just conclude the claim failed. The pages
 * this links to are already careful about that; the email had no check at all.
 *
 * lib/email.ts itself is deliberately NOT imported: `import "server-only"` on
 * its first line throws outside a React Server Component, which is what makes
 * the key safe and the module untestable offline. See the docblock in
 * lib/email-copy.ts.
 */
import { render, esc } from "../lib/email-copy.ts";

const ORIGIN = "https://floridacontractorregistry.test";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "  PASS" : "  ****FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
  c ? pass++ : fail++;
};

/** Blank line then a heading. */
const head = (t) => { console.log(""); console.log(t); };

/** Asserts on both bodies at once — a claim true of the HTML and the text. */
const inBoth = (mail, needle, why) =>
  ok(why, mail.html.includes(needle) && mail.text.includes(needle), JSON.stringify(needle));

const APPROVED = {
  to: "owner@example.com",
  decision: "approved",
  contractorName: "Gulf Coast Roofing",
  licenseNumber: "CCC1331234",
};

const REJECTED = {
  to: "owner@example.com",
  decision: "rejected",
  contractorName: "Gulf Coast Roofing",
  licenseNumber: "CCC1331234",
  rejectionReason: "The photo was too blurred to read the licence number.",
};

head("── APPROVED ───────────────────────────────────────────");
{
  const m = render(APPROVED, ORIGIN);
  ok("subject names the business and the outcome",
     m.subject === "Your claim was approved — Gulf Coast Roofing", m.subject);
  inBoth(m, `${ORIGIN}/claim/approved`, "links to /claim/approved");
  ok("does NOT link to /claim/rejected",
     !m.html.includes("/claim/rejected") && !m.text.includes("/claim/rejected"));
  inBoth(m, "Gulf Coast Roofing", "names the business in the body");
  inBoth(m, "License CCC1331234", "shows the licence number");
  // Copy lifted from app/claim/approved/page.tsx:90-93 — the page it opens.
  inBoth(m, "your verified badge is live", "matches the wording on the page it links to");
}

head("── REJECTED ───────────────────────────────────────────");
{
  const m = render(REJECTED, ORIGIN);
  ok("subject names the business and the outcome",
     m.subject === "We couldn't verify your claim — Gulf Coast Roofing", m.subject);
  inBoth(m, `${ORIGIN}/claim/rejected`, "links to /claim/rejected");
  ok("does NOT link to /claim/approved",
     !m.html.includes("/claim/approved") && !m.text.includes("/claim/approved"));
  inBoth(m, REJECTED.rejectionReason, "shows the reviewer's reason verbatim");
  inBoth(m, "What the reviewer said", "labels the reason");
  // app/claim/rejected/page.tsx:92-96 and :21-27 — not a dead end.
  inBoth(m, "qualifying agent DBPR has on file", "matches the page's explanation");
  inBoth(m, "try again", "tells them a rejection is not a lockout");
}

head("── THE REASON IS OPTIONAL, AND MUST NOT LEAVE AN EMPTY BOX ───");
// reject_claim() blanks an empty reason to NULL, so a rejection can legitimately
// arrive with nothing written. The page drops its "what the reviewer said" block
// in that case and the email has to agree.
for (const [reason, label] of [
  [null, "null"],
  [undefined, "undefined"],
  ["", "empty string"],
  ["   ", "whitespace only"],
]) {
  const m = render({ ...REJECTED, rejectionReason: reason }, ORIGIN);
  ok(`no reviewer block when the reason is ${label}`,
     !m.html.includes("What the reviewer said") && !m.text.includes("What the reviewer said"));
}
{
  const m = render({ ...REJECTED, rejectionReason: "  padded  " }, ORIGIN);
  inBoth(m, "padded", "a padded reason is trimmed, not dropped");
}

head("── AN APPROVAL NEVER CARRIES A REJECTION REASON ────────");
// Defensive: notifyDecision reads the row back, and a re-submitted claim can
// hold a stale rejection_reason from an earlier attempt. Approving it must not
// tell the contractor why they were once turned down.
{
  const m = render(
    { ...APPROVED, rejectionReason: "Photo was unreadable on the previous attempt." },
    ORIGIN,
  );
  ok("the stale reason does not appear",
     !m.html.includes("unreadable") && !m.text.includes("unreadable"));
  ok("no reviewer block either",
     !m.html.includes("What the reviewer said"));
}

head("── MISSING LICENCE NUMBER ──────────────────────────────");
for (const decision of ["approved", "rejected"]) {
  const m = render({ ...APPROVED, decision, licenseNumber: null }, ORIGIN);
  ok(`${decision}: no empty "License" line`,
     !m.html.includes("License ") && !m.text.includes("License "));
  ok(`${decision}: the rest of the email still renders`,
     m.html.includes("Gulf Coast Roofing") && m.subject.includes("Gulf Coast Roofing"));
}

head("── HTML ESCAPING ───────────────────────────────────────");
ok("esc handles the four characters", esc('&<>"') === "&amp;&lt;&gt;&quot;", esc('&<>"'));
{
  // "Smith & Sons" is an ordinary Florida business name, not an attack.
  const m = render({ ...APPROVED, contractorName: "Smith & Sons" }, ORIGIN);
  ok("an ampersand is escaped in the HTML", m.html.includes("Smith &amp; Sons"));
  ok("...and left alone in the plain-text part", m.text.includes("Smith & Sons"));
  ok("...and left alone in the subject", m.subject.includes("Smith & Sons"));
}
{
  const m = render({ ...REJECTED, rejectionReason: "Name <b>did not</b> match" }, ORIGIN);
  ok("markup in a reviewer's reason cannot inject tags",
     m.html.includes("&lt;b&gt;") && !m.html.includes("<b>"));
}

head("── NO REMOTE CONTENT ───────────────────────────────────");
// A verification email that loads remote assets looks exactly like the phishing
// it would be mistaken for. The only URLs in the body are our own links.
for (const [input, label] of [[APPROVED, "approved"], [REJECTED, "rejected"]]) {
  const m = render(input, ORIGIN);
  ok(`${label}: no images`, !m.html.includes("<img"));
  ok(`${label}: no external stylesheet or script`,
     !m.html.includes("<link") && !m.html.includes("<script"));
  const urls = m.html.match(/https?:[^"'\s<>]+/g) ?? [];
  ok(`${label}: every URL points at our own origin`,
     urls.every((u) => u.startsWith(ORIGIN)), urls.join(" ") || "none");
}

head("── ORIGIN IS USED VERBATIM ─────────────────────────────");
// siteOrigin() strips trailing slashes before calling render, so render itself
// must not second-guess what it is handed.
{
  const m = render(APPROVED, "http://localhost:3000");
  inBoth(m, "http://localhost:3000/claim/approved", "a localhost origin works for local testing");
}

console.log("");
console.log("═".repeat(56));
console.log(`  ${pass} passed, ${fail} failed`);
console.log("═".repeat(56));
process.exit(fail === 0 ? 0 : 1);
