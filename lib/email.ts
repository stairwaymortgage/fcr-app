import "server-only";

import { headers } from "next/headers";

import {
  render,
  renderRegistryRequest,
  type ClaimDecisionEmail,
  type RegistryRequestEmail,
  type RenderedEmail,
} from "@/lib/email-copy";

/**
 * Transactional email — Resend.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS EXISTS BECAUSE TWO PAGES ALREADY PROMISED IT.
 *
 * /claim/approved and /claim/rejected both told the contractor "we'll email you
 * the moment it's decided", and nothing sent anything. The pages were correct;
 * the delivery was missing. A contractor whose claim was approved had no way to
 * find out short of guessing the URL — the dashboard does not show claim status
 * either.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTHING IN HERE THROWS. EVER.
 *
 * Same contract as pushLeadToGhl in lib/ghl.ts, and for a stronger reason. The
 * caller has already committed the decision inside approve_claim()/
 * reject_claim() — a transaction that linked contractors.claimed_by_user_id and
 * granted the contractor their profile. That happened. If Resend is down, or
 * the key is wrong, or the address bounces, the decision is still real and the
 * admin must still see their queue.
 *
 * An email failure that surfaced as a failed Server Action would be actively
 * harmful: the reviewer would see an error, assume the approval did not take,
 * and try again — and the second approve_claim() raises "claim is not pending"
 * because the first one worked. So every path here returns { ok: false, error }
 * and the caller logs it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `import "server-only"` on line 1 is enforcement, not decoration: this module
 * reads RESEND_API_KEY, and a client component importing it would be a build
 * error rather than a leaked key.
 *
 * THE COPY LIVES IN lib/email-copy.ts, and the split is deliberate. That import
 * on line 1 also stops a plain node script loading this file, so anything
 * defined here is untestable offline. What the email SAYS therefore lives next
 * door, in a module with no secret and no side effect, exercised by
 * scripts/verify-claim-emails.mjs. Same reasoning as lib/safe-next.ts.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Bounded so a hanging request cannot stall the reviewer.
 *
 * This send is awaited inside the admin's own Server Action, between the RPC
 * and the redirect back to /admin/claims. Without a timeout, a Resend outage
 * that accepts connections but never answers would hold the reviewer's page
 * until the platform's own limit — the decision already saved, the screen still
 * spinning, and no way to tell that the part that failed was only the email.
 */
const TIMEOUT_MS = 8000;

export type EmailResult = { ok: boolean; error?: string };

// Re-exported so callers have one import for the whole feature.
export type {
  ClaimDecision,
  ClaimDecisionEmail,
  RegistryRequestEmail,
} from "@/lib/email-copy";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NEXT_PUBLIC_SITE_URL IS PREFERRED HERE, AND THAT IS THE OPPOSITE OF
 * app/login/actions.ts:89-92 — DELIBERATELY.
 *
 * That file derives the origin from the request headers first, which is right
 * for a magic link: the link is consumed within minutes, by the person who just
 * asked for it, on whatever host they were using. localhost, a preview and
 * production each send a link back to themselves.
 *
 * A decision email is not that. It is durable, read hours or days later, and
 * possibly kept. If an admin approves a claim from a Vercel preview deployment,
 * header-derived links would send a real contractor to a preview URL that is
 * password-walled today and deleted next week — a dead link in the one email
 * that tells someone their business listing is live.
 *
 * So the canonical site URL wins when it is configured, and the request host is
 * the fallback for local development where it is not.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function siteOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const h = headers();
  const host = h.get("host");
  if (host) return `https://${host}`;

  return null;
}

/**
 * The transport, shared by every message this module sends.
 *
 * Extracted when the registry-request acknowledgement was added: two copies of
 * the config checks, the timeout and the Resend error handling would have been
 * two places for the timeout to drift and two places to forget that this must
 * never throw. What differs between messages is the copy, and that lives in
 * lib/email-copy.ts — not here.
 */
async function deliver(to: string, mail: RenderedEmail): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  // Missing configuration is reported, never thrown. On a deployment without
  // these set, the caller's own work keeps working and every skipped send is
  // logged.
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  if (!from) return { ok: false, error: "EMAIL_FROM not set" };
  if (!to) return { ok: false, error: "no recipient address" };

  const { subject, html, text } = mail;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // Resend returns a JSON body with a readable message; fall back to the
      // status when it does not, so the log never says merely "failed".
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        error: `resend responded ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      };
    }

    return { ok: true };
  } catch (cause) {
    // Timeout, DNS, TLS, offline. All the same to the caller: the decision
    // stands and the email did not go.
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Notify a contractor that their claim has been decided. Never throws. */
export async function sendClaimDecisionEmail(
  input: ClaimDecisionEmail,
): Promise<EmailResult> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, error: "cannot determine site origin for links" };

  return deliver(input.to, render(input, origin));
}

/**
 * Acknowledge a registry request from /join. Never throws.
 *
 * Same contract as the decision email and for the same reason: the request is
 * already committed to registry_requests by the time this runs. A Resend outage
 * must not turn a saved request into an error on the visitor's screen — the
 * obvious response to that error is to submit again, which is how one business
 * ends up three times in the reviewer's queue.
 */
export async function sendRegistryRequestEmail(
  input: RegistryRequestEmail,
): Promise<EmailResult> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, error: "cannot determine site origin for links" };

  return deliver(input.to, renderRegistryRequest(input, origin));
}
