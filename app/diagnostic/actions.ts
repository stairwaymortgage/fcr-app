"use server";

import { z } from "zod";

import { SMS_CONSENT_TEXT } from "@/lib/consent";
import { determineRouting, routesToJson } from "@/lib/lead-routing";
import { QUESTIONS, detectPersona, type Answers } from "@/lib/personas";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Diagnostic lead capture — the second and last write path in the public app.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ADMIN CLIENT. 03_rls_policies.sql gives leads exactly one policy —
 * "admin only leads" FOR ALL TO authenticated USING (is_admin()) — and says so
 * in a comment: "CRITICAL: leads contain PII. Never expose to anon. Inserts
 * from server-side (using service-role key) bypass RLS by design."
 *
 * Verified live 2026-07-31 with a valid payload:
 *   anon INSERT into leads -> 401 42501, new row violates row-level security
 *
 * So an anon insert here would fail on every submission, and because
 * supabase-js returns errors rather than throwing it would fail SILENTLY —
 * visitor sees the thank-you, no lead exists. That is the failure this design
 * exists to prevent, and it is the same one the inquiry action avoids.
 *
 * ---------------------------------------------------------------------------
 * SERVICE-ROLE MEANS RLS CHECKS NOTHING, SO THIS FUNCTION MUST.
 *
 * A Server Action is a public POST endpoint with a stable id; anything can call
 * it directly. The zod schema below is the only validation that exists — the
 * form's own `required` and `type="tel"` attributes do not apply to a crafted
 * request.
 *
 * FIELD ALLOWLIST, NEVER A SPREAD. The insert names its columns literally.
 * leads also has status, assigned_to_user_id, estimated_value, closed_reason
 * and created_at; a spread of untrusted input could set status 'closed_won' or
 * assign the lead to a user.
 * ---------------------------------------------------------------------------
 */

/** E.164, which is what the column comment specifies: +13055551234. */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalise a typed phone number to E.164.
 *
 * REJECTS RATHER THAN GUESSES when it cannot. Delivery runs through Twilio via
 * GoHighLevel and a malformed number is a lead the concierge can never call —
 * worse than a rejected form, because it looks captured.
 *
 * A bare 10-digit number is assumed US (+1); 11 digits starting 1 likewise.
 * Anything else must already carry its own country code.
 */
function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return E164.test(digits) ? digits : null;
  const bare = digits.replace(/\D/g, "");
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith("1")) return `+${bare}`;
  return null;
}

const VALID_ANSWERS = new Map(
  QUESTIONS.map((q) => [q.id, new Set(q.choices.map((c) => c.value))]),
);

const Schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(7).max(32),
  zip: z.string().trim().regex(/^\d{5}$/).optional().or(z.literal("")),
  smsConsent: z.boolean(),
  /** Hidden field. Bots fill it; people cannot see it. */
  website: z.string().max(0),
  answers: z.record(z.string(), z.string()),
  referringSlug: z.string().max(200).optional().or(z.literal("")),
});

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string; fields?: string[] };

export async function submitDiagnostic(input: unknown): Promise<SubmitResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please check the highlighted fields and try again.",
      fields: parsed.error.issues.map((i) => String(i.path[0])),
    };
  }
  const data = parsed.data;

  if (data.website) {
    // Honeypot tripped. Reported as a generic failure so a bot learns nothing.
    return { ok: false, error: "That submission looked automated." };
  }

  const phone = toE164(data.phone);
  if (!phone) {
    return {
      ok: false,
      error: "That phone number doesn't look right. Include the area code.",
      fields: ["phone"],
    };
  }

  /**
   * Answers are validated against the question definitions, not trusted.
   * An unrecognised value would otherwise land in diagnostic_answers and could
   * change which persona is computed.
   */
  const answers: Answers = {};
  for (const [key, value] of Object.entries(data.answers)) {
    const id = Number(key);
    if (!VALID_ANSWERS.get(id)?.has(value)) {
      return { ok: false, error: "Some answers were not recognised. Please start again." };
    }
    answers[id] = value;
  }
  if (!answers[1] || !answers[2] || !answers[3]) {
    return { ok: false, error: "Please answer the first three questions." };
  }

  // Recomputed on the SERVER from validated answers. The client also computes a
  // persona to pick the reframe copy, but that value is never trusted or sent —
  // a crafted request cannot choose its own routing.
  const persona = detectPersona(answers);
  const routes = determineRouting(persona.id, answers);

  /**
   * Consent is written as a unit or not at all. SMS_CONSENT_TEXT is the same
   * constant the checkbox label and /sms-terms §3 render, so the stored string
   * is provably what the visitor saw.
   *
   * Declining leaves all three NULL/false rather than storing an empty string,
   * so "no consent" is distinguishable from "consent recorded as blank".
   */
  const consent = data.smsConsent
    ? {
        sms_consent: true,
        sms_consent_text: SMS_CONSENT_TEXT,
        sms_consent_timestamp: new Date().toISOString(),
      }
    : { sms_consent: false, sms_consent_text: null, sms_consent_timestamp: null };

  const admin = createAdminClient();
  const { error } = await admin.from("leads").insert({
    name: data.name,
    email: data.email,
    phone,
    zip: data.zip || null,
    // Set here, never accepted from input — it is a CHECK-constrained column.
    lead_source: "diagnostic_flow",
    referring_url: data.referringSlug ? `/contractor/${data.referringSlug}` : null,
    diagnostic_answers: answers,
    primary_persona: persona.slug,
    routed_entities: routesToJson(routes),
    ...consent,
  });

  if (error) {
    // Logged loudly. A dropped lead is the funnel's whole product.
    console.error("[diagnostic] LEAD INSERT FAILED — lead lost", {
      code: error.code,
      message: error.message,
      persona: persona.slug,
    });
    return {
      ok: false,
      error: "Something went wrong on our side. Please try again in a moment.",
    };
  }

  return { ok: true };
}

/**
 * ===========================================================================
 * ⚠ LAUNCH BLOCKER — RATE LIMITING. Same status as the inquiry action.
 *
 * This is the second unauthenticated endpoint writing with service-role, and
 * it writes PII: name, email, phone, ZIP, and a full answer set. Validation
 * stops malformed abuse; nothing here stops volume. Close it before the apex
 * domain or the first paying contractor — Vercel WAF rules first.
 * ===========================================================================
 */
