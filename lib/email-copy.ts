/**
 * Transactional email copy — subjects and bodies.
 *
 * Two messages live here: the claim decision (approved / rejected) and the
 * registry-request acknowledgement sent by /join. They share this file because
 * they share the same constraint — pure, dependency-free, offline-testable —
 * and the same `shell` at the foot, so the two cannot drift apart visually.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SPLIT OUT OF lib/email.ts SO IT CAN BE TESTED. SAME MOVE AS safe-next.ts.
 *
 * lib/email.ts starts with `import "server-only"`, which is not a hint — the
 * package throws the moment it is loaded anywhere but a React Server Component.
 * That is exactly what we want guarding an API key, and it also means a plain
 * node script cannot import that module to check what the email SAYS. The copy
 * would have been the part nobody could exercise, in a message a contractor
 * receives once and cannot ask us to resend.
 *
 * So the same fix safe-next.ts got: the pure part moves to a module with no
 * server-only, no next/headers, no env and no network, and the test imports
 * this. scripts/verify-claim-emails.mjs runs it in milliseconds, offline.
 *
 * NOTHING WITH A SECRET OR A SIDE EFFECT BELONGS IN THIS FILE. If it ever needs
 * the API key, the request, or the clock, it belongs next door.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The copy tracks the two pages it links to — app/claim/approved/page.tsx and
 * app/claim/rejected/page.tsx. If the wording there changes, change it here
 * too: an email that says something different from the page it points at reads
 * as a mistake to the person holding both.
 */

export type ClaimDecision = "approved" | "rejected";

export type ClaimDecisionEmail = {
  to: string;
  decision: ClaimDecision;
  contractorName: string;
  licenseNumber: string | null;
  /** Admin-written, shown verbatim. Ignored when the decision is "approved". */
  rejectionReason?: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

/**
 * Escapes the four characters that can break out of the HTML below.
 *
 * The inputs are staff-written (rejection_reason) or DBPR-derived (business
 * name, licence number), so this is not defence against an attacker — it is
 * defence against an ampersand. "Smith & Sons" is an extremely ordinary Florida
 * business name and would otherwise render as a broken entity in some clients.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Subject and both bodies for one decision.
 *
 * Pure: no env, no network, no clock. `origin` is passed in rather than read,
 * which is what lets the test assert the links without a request context.
 */
export function render(input: ClaimDecisionEmail, origin: string): RenderedEmail {
  const name = input.contractorName;
  const licence = input.licenseNumber ? `License ${input.licenseNumber}` : null;

  if (input.decision === "approved") {
    const url = `${origin}/claim/approved`;
    return {
      subject: `Your claim was approved — ${name}`,
      text: [
        `Your claim on ${name} was approved.`,
        licence ?? "",
        "Your profile is now under your control. Visitors who land on it will see whatever you decide to put there, and your verified badge is live.",
        `See your profile and what to do next: ${url}`,
        "Florida Contractor Registry",
      ]
        .filter((line) => line !== "")
        .join("\n\n"),
      html: shell(
        `<p style="margin:0 0 16px"><strong>Your claim on ${esc(name)} was approved.</strong></p>` +
          (licence ? `<p style="margin:0 0 16px;color:#555">${esc(licence)}</p>` : "") +
          `<p style="margin:0 0 16px">Your profile is now under your control. Visitors who land on it will see whatever you decide to put there, and your verified badge is live.</p>` +
          `<p style="margin:0 0 16px"><a href="${url}">See your profile and what to do next</a></p>`,
      ),
    };
  }

  const url = `${origin}/claim/rejected`;
  /**
   * Blank-safe. reject_claim() already blanks an empty reason to NULL, but a
   * whitespace-only string arriving here would otherwise render an empty "what
   * the reviewer said" box — the same failure the rejected page guards against.
   */
  const reason = input.rejectionReason?.trim() || null;

  return {
    subject: `We couldn't verify your claim — ${name}`,
    text: [
      `Your claim on ${name} wasn't approved.`,
      licence ?? "",
      "This is usually a photo we couldn't read, or a name that doesn't match the qualifying agent DBPR has on file.",
      reason ? `What the reviewer said: ${reason}` : "",
      "You can try again straight away — a rejection is not a lockout.",
      `Details and a link to resubmit: ${url}`,
      "Florida Contractor Registry",
    ]
      .filter((line) => line !== "")
      .join("\n\n"),
    html: shell(
      `<p style="margin:0 0 16px"><strong>Your claim on ${esc(name)} wasn't approved.</strong></p>` +
        (licence ? `<p style="margin:0 0 16px;color:#555">${esc(licence)}</p>` : "") +
        `<p style="margin:0 0 16px">This is usually a photo we couldn't read, or a name that doesn't match the qualifying agent DBPR has on file.</p>` +
        (reason
          ? `<p style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #b3261e;background:#fdf3f2"><strong>What the reviewer said</strong><br>${esc(reason)}</p>`
          : "") +
        `<p style="margin:0 0 16px">You can try again straight away — a rejection is not a lockout.</p>` +
        `<p style="margin:0 0 16px"><a href="${url}">Details and a link to resubmit</a></p>`,
    ),
  };
}

export type RegistryRequestEmail = {
  to: string;
  /** As typed by the sender, shown back so they can see what we recorded. */
  businessName: string;
};

/**
 * "We got your request" — the only email /join sends.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT PROMISES AN ACKNOWLEDGEMENT AND NOTHING ELSE, DELIBERATELY.
 *
 * There is no decision email on this queue: approving a registry request does
 * not create a listing, it records that someone should create one by hand (see
 * db/migrations/20260807_registry_requests.sql). So this message must not say
 * "we'll email you when it's approved" — that is the sentence the claim flow can
 * make good on and this one cannot, and an unkept promise here reads as being
 * ignored rather than as a queue with a person in it.
 *
 * It also must not imply the business is now listed. Someone who reads "request
 * received" as "you're in the registry" will stop looking, and the whole point
 * of the directory is that being in it means DBPR has a record.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure: no env, no network, no clock. `origin` is passed in, which is what lets
 * the test assert the links without a request context.
 */
export function renderRegistryRequest(
  input: RegistryRequestEmail,
  origin: string,
): RenderedEmail {
  const name = input.businessName;
  const searchUrl = `${origin}/search`;

  return {
    subject: `We received your registry request — ${name}`,
    text: [
      `Thanks — we've received your request to add ${name} to Florida Contractor Registry.`,
      "A person reviews every request against public DBPR records. If we can match your business to a license, we'll add the listing and reply to this address. If we can't, we'll reply and tell you why.",
      "This is not a listing yet, and there's nothing else you need to do.",
      `In the meantime, it's worth searching the registry once more — most Florida licensees are already in it under a business or qualifying agent name they don't expect: ${searchUrl}`,
      "Florida Contractor Registry",
    ].join("\n\n"),
    html: shell(
      `<p style="margin:0 0 16px"><strong>Thanks — we've received your request to add ${esc(name)} to Florida Contractor Registry.</strong></p>` +
        `<p style="margin:0 0 16px">A person reviews every request against public DBPR records. If we can match your business to a license, we'll add the listing and reply to this address. If we can't, we'll reply and tell you why.</p>` +
        `<p style="margin:0 0 16px">This is not a listing yet, and there's nothing else you need to do.</p>` +
        `<p style="margin:0 0 16px">In the meantime, it's worth <a href="${searchUrl}">searching the registry</a> once more — most Florida licensees are already in it under a business or qualifying agent name they don't expect.</p>`,
    ),
  };
}

/**
 * Minimal wrapper. No images, no external stylesheet, no tracking pixel — a
 * verification email that loads remote content is exactly the shape of the
 * phishing it would be mistaken for, and half of mail clients block it anyway.
 * scripts/verify-claim-emails.mjs asserts that, so it stays true.
 */
function shell(body: string): string {
  return (
    `<!doctype html><html><body style="margin:0;padding:24px;` +
    `font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.6;color:#1a1a1a">` +
    `<div style="max-width:520px;margin:0 auto">` +
    body +
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;font-size:13px;color:#777">` +
    `Florida Contractor Registry` +
    `</p></div></body></html>`
  );
}
