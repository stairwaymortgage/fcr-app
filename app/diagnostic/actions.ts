"use server";

import { z } from "zod";

import { SMS_CONSENT_TEXT } from "@/lib/consent";
import { pushLeadToGhl } from "@/lib/ghl";
import { LIMITS as RATE, checkLimits, requestIp } from "@/lib/rate-limit";
import { determineRouting, routesToJson } from "@/lib/lead-routing";
import {
  CAPTURE_FIELDS,
  QUESTIONS,
  detectPersona,
  type Answers,
  type CaptureAnswers,
} from "@/lib/personas";
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

/** Same treatment for the capture-step selects — allowlisted, never trusted. */
const VALID_CAPTURE = new Map(
  CAPTURE_FIELDS.map((f) => [f.key as string, new Set(f.choices.map((c) => c.value))]),
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
  /** Capture-step selects. Optional so an older cached client still submits. */
  captureFields: z.record(z.string(), z.string()).optional(),
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

  /**
   * Capture-step selects — budget, timeline, insurance, contact_preference.
   *
   * Allowlisted exactly like the questions: a Server Action is a public POST
   * endpoint, so `required` on a <select> guarantees nothing. An unrecognised
   * value is rejected rather than stored, because these land in GoHighLevel and
   * the concierge acts on them during a call.
   *
   * They do NOT feed detectPersona — persona detection is defined over Q1–Q7
   * only, and quietly widening its inputs would reroute existing leads.
   */
  const captureFields: CaptureAnswers = {};
  for (const [key, value] of Object.entries(data.captureFields ?? {})) {
    if (value === "") continue; // Not chosen. Stored as absent, not as blank.
    if (!VALID_CAPTURE.get(key)?.has(value)) {
      return {
        ok: false,
        error: "Some selections were not recognised. Please try again.",
        fields: [key],
      };
    }
    captureFields[key] = value;
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

  const referringUrl = data.referringSlug ? `/contractor/${data.referringSlug}` : null;

  /**
   * RATE LIMIT — after validation, before any database work or any GHL call.
   *
   * Everything above this line is string work on data already in memory, so a
   * malformed flood costs nothing and never reaches Postgres. This is the first
   * point where a WELL-FORMED flood — the one the limiter exists for — is
   * stopped, and it is one round trip ahead of the insert, the GHL contact, the
   * GHL opportunity and the concierge callback that would otherwise follow.
   *
   * THE REFUSAL TELLS THE VISITOR WHAT TO DO INSTEAD. A homeowner sharing an
   * office or CGNAT address can legitimately land here (see the note on
   * DIAGNOSTIC_IP_DAY), so the message must not read as a broken form or an
   * accusation — it routes them to the phone, which is the same concierge the
   * form would have reached.
   */
  const limit = await checkLimits([
    { spec: RATE.DIAGNOSTIC_IP_BURST, identifier: requestIp() },
    { spec: RATE.DIAGNOSTIC_IP_DAY, identifier: requestIp() },
  ]);
  if (!limit.allowed) {
    return {
      ok: false,
      error:
        "We've already received a few requests from your connection today. " +
        "If you still need help, call us and we'll pick it up from there.",
    };
  }

  const admin = createAdminClient();

  /**
   * DUPLICATE SUPPRESSION — the same person, inside 24 hours, is one lead.
   *
   * ⚠ THIS MATTERS MORE HERE THAN ON THE INQUIRY FORM, because a duplicate is
   * not just a duplicate row: it is a second GHL contact, a second opportunity
   * in the pipeline, and a second concierge callback to someone who has already
   * been called. That is a CRM the sales process stops trusting.
   *
   * MATCHED ON EITHER EMAIL OR PHONE, not both. A spammer who rotates one
   * usually does not rotate the other, and a real homeowner who retypes their
   * email still has the same phone. Scoped to the diagnostic source so a lead
   * captured by some other route never suppresses one captured here.
   *
   * ⚠ IT DOES SUPPRESS A GENUINE RETAKE. Someone who completes the wizard, then
   * redoes it within a day with DIFFERENT answers, has that second set
   * discarded. Accepted knowingly: the concierge already has their number and
   * the call has not happened yet, so the answers are refined on the phone —
   * whereas a second row means two people call the same homeowner about the same
   * roof. If this ever needs to change, the fix is to UPDATE the existing row's
   * diagnostic_answers rather than to drop the suppression.
   *
   * REPORTED AS SUCCESS, DELIBERATELY. Their request genuinely did arrive the
   * first time, so "sent" is the truthful answer — and a "duplicate" error would
   * tell a spammer exactly which of their identities has already landed.
   *
   * A FAILED CHECK FALLS THROUGH TO THE INSERT. The worst case is the duplicate
   * we have always had. A dropped lead is the funnel's whole product.
   */
  const dedupeSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentLead, error: dedupeError } = await admin
    .from("leads")
    .select("id")
    .eq("lead_source", "diagnostic_flow")
    .gte("created_at", dedupeSince)
    /**
     * VALUES ARE QUOTED. PostgREST's `or` filter is a comma-separated string,
     * so an unquoted value containing a comma or a parenthesis would be parsed
     * as filter syntax rather than as data. Both values are already validated
     * (zod email, E.164 phone) and cannot contain either character today —
     * quoted anyway, because that validation living somewhere else is exactly
     * the assumption that rots.
     */
    .or(`email.eq."${data.email}",phone.eq."${phone}"`)
    .limit(1)
    .maybeSingle();

  if (dedupeError) {
    console.warn("[diagnostic] duplicate check failed — allowing the insert", {
      code: dedupeError.code,
      message: dedupeError.message,
    });
  }
  if (recentLead) {
    console.info("[diagnostic] duplicate suppressed — no second lead, no second GHL push", {
      existingLeadId: recentLead.id,
      persona: persona.slug,
    });
    return { ok: true };
  }

  /**
   * THE TABLE IS WRITTEN FIRST AND IS THE SOURCE OF TRUTH.
   *
   * GoHighLevel is delivery, not storage. The lead is committed to Postgres
   * before any network call to GHL, so a GHL outage, a rate limit or a schema
   * change there cannot cost us the lead. Only a Postgres failure is reported
   * to the visitor as a failure.
   */
  const { data: inserted, error } = await admin
    .from("leads")
    .insert({
      name: data.name,
      email: data.email,
      phone,
      zip: data.zip || null,
      // Set here, never accepted from input — it is a CHECK-constrained column.
      lead_source: "diagnostic_flow",
      referring_url: referringUrl,
      /**
       * The numbered answers and the capture-step selects share this jsonb
       * column — numeric keys "1".."7" for the questions, named keys "budget",
       * "timeline", "insurance", "contact_preference" for the selects.
       *
       * ONE COLUMN, NO MIGRATION. Four new columns would each have needed DDL
       * run by hand in the SQL editor before any of this could ship, and a
       * deploy that silently depends on someone remembering to run a migration
       * is how a field ends up quietly empty in production.
       */
      diagnostic_answers: { ...answers, ...captureFields },
      primary_persona: persona.slug,
      routed_entities: routesToJson(routes),
      ...consent,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    // Logged loudly. A dropped lead is the funnel's whole product.
    console.error("[diagnostic] LEAD INSERT FAILED — lead lost", {
      code: error?.code,
      message: error?.message,
      persona: persona.slug,
    });
    return {
      ok: false,
      error: "Something went wrong on our side. Please try again in a moment.",
    };
  }

  /**
   * GHL push. Deliberately AFTER the commit and deliberately unable to fail the
   * request: whatever happens here, the visitor already has a saved lead and is
   * told so.
   *
   * ghl_synced stays false on any failure, which is the retry queue —
   * `WHERE ghl_synced = false`. ghl_last_error keeps the reason so a flapping
   * integration is visible rather than just slow.
   *
   * NOTHING FROM routed_entities IS SENT. GHL receives the persona slug, the
   * answers, contact details and consent; entity routing happens in a GHL
   * automation keyed on the persona.
   */
  try {
    const ghl = await pushLeadToGhl({
      name: data.name,
      email: data.email,
      phone,
      zip: data.zip || null,
      personaSlug: persona.slug,
      answers,
      captureFields,
      smsConsent: consent.sms_consent,
      smsConsentText: consent.sms_consent_text,
      smsConsentTimestamp: consent.sms_consent_timestamp,
      referringUrl,
    });

    if (ghl.unmapped.length > 0) {
      console.warn("[diagnostic] GHL fields omitted — no value mapping", {
        leadId: inserted.id,
        unmapped: ghl.unmapped,
      });
    }

    /**
     * THE RESULT OF THIS UPDATE IS CHECKED, not discarded.
     *
     * Caught by the live end-to-end test on 2026-07-31: the migration adding
     * these columns had not been run, so every one of these UPDATEs failed with
     * PGRST204 "Could not find the 'ghl_synced' column" — and because supabase-js
     * returns errors instead of throwing, an ignored result made it invisible.
     * The push had genuinely succeeded, the lead was genuinely saved, and the
     * row still read as never-delivered. The retry queue would have re-pushed a
     * lead that was already in GHL, forever.
     *
     * A failure here does NOT fail the request — the lead is committed and the
     * contact is in GHL. It only has to be loud.
     */
    const { error: syncError } = await admin
      .from("leads")
      .update(
        ghl.ok
          ? {
              ghl_synced: true,
              ghl_contact_id: ghl.contactId ?? null,
              ghl_opportunity_id: ghl.opportunityId ?? null,
              ghl_synced_at: new Date().toISOString(),
              ghl_last_error: null,
            }
          : {
              ghl_synced: false,
              ghl_contact_id: ghl.contactId ?? null,
              ghl_last_error: ghl.error ?? "unknown",
            },
      )
      .eq("id", inserted.id);

    if (syncError) {
      console.error("[diagnostic] GHL SYNC STATE NOT RECORDED — row will look undelivered", {
        leadId: inserted.id,
        ghlOk: ghl.ok,
        ghlContactId: ghl.contactId,
        code: syncError.code,
        message: syncError.message,
        hint: "db/migrations/20260731_leads_ghl_sync.sql not run?",
      });
    }

    if (!ghl.ok) {
      console.error("[diagnostic] GHL PUSH FAILED — lead is safe in Postgres, retry needed", {
        leadId: inserted.id,
        error: ghl.error,
      });
    }
  } catch (err) {
    // Belt and braces: pushLeadToGhl is written not to throw, but an unexpected
    // throw here must still not turn a saved lead into a visitor-facing error.
    console.error("[diagnostic] GHL push threw — lead is safe in Postgres", {
      leadId: inserted.id,
      error: String(err).slice(0, 300),
    });
    const { error: syncError } = await admin
      .from("leads")
      .update({ ghl_synced: false, ghl_last_error: String(err).slice(0, 500) })
      .eq("id", inserted.id);
    if (syncError) {
      console.error("[diagnostic] GHL SYNC STATE NOT RECORDED after throw", {
        leadId: inserted.id,
        code: syncError.code,
        message: syncError.message,
      });
    }
  }

  return { ok: true };
}

/**
 * ===========================================================================
 * RATE LIMITING — the launch blocker recorded here on 2026-07-30, closed for
 * THIS ENDPOINT on 2026-08-06.
 *
 * ⚠ "CLOSED FOR THIS ENDPOINT" IS THE WHOLE CLAIM. The blocker covers six
 * public write paths and is not closed until all six are wired and
 * db/migrations/20260806_rate_limits.sql has been run. Do not read this note as
 * the blocker being done.
 *
 * What it was: the second unauthenticated endpoint writing with service-role,
 * and the one that writes the most PII — name, email, phone, ZIP and a full
 * answer set — then spends a GHL contact, a GHL opportunity and a concierge
 * callback on every row it accepts.
 *
 * WHAT NOW STANDS BETWEEN THE FORM AND THE INSERT, cheapest first:
 *   0. The zod schema, the answer allowlists and the honeypot above — free,
 *      and they stop malformed abuse without touching Postgres.
 *   1. Two counters: 2 per 10 minutes and 3 per day, per IP. The tightest in
 *      the application, because this is the most expensive thing an anonymous
 *      stranger can make us do.
 *   2. Duplicate suppression on email OR phone within 24 hours, which is what
 *      catches a slow drip from a rotating IP pool that never trips a counter.
 *
 * WHAT IS DELIBERATELY STILL OPEN:
 *
 *   VOLUME COSTS ARE NOT HANDLED HERE AND CANNOT BE. Every request refused
 *   above has already booted a Vercel function and been billed. Dropping
 *   traffic before compute is the WAF's job — those rules are step 1 of this
 *   defence, not an optional extra, and this file does not compensate if they
 *   are removed.
 *
 *   THE COUNTERS ARE PER-IP ONLY. There is no per-persona or per-ZIP bucket, so
 *   a distributed source submitting one lead per address is limited only by the
 *   24-hour duplicate rule. If that is ever observed, the next control is
 *   Turnstile on this form specifically — unlike the contractor profile, this
 *   page already ships client JavaScript, so a challenge widget costs nothing
 *   architecturally here. It is the obvious next step, not a last resort.
 *
 * THE LIMITER FAILS OPEN. If Postgres is unreachable this endpoint is unlimited
 * again, loudly, in the logs — see the docblock in lib/rate-limit.ts. A limiter
 * outage that ate leads would be worse than the abuse it prevents.
 * ===========================================================================
 */
