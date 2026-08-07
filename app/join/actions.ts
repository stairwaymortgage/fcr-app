"use server";

import { redirect } from "next/navigation";

import { sendRegistryRequestEmail } from "@/lib/email";
import { LIMITS as RATE, checkLimits, requestIp } from "@/lib/rate-limit";
import { validateRegistryRequest } from "@/lib/registry-requests";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Registry request capture — /join, the no-match branch.
 *
 * The third and last public write path in the app, alongside the diagnostic and
 * the claim flow. The inquiry form that used to be the fourth was removed from
 * contractor profiles on 2026-08-07; its action still exists and is no longer
 * reachable from any page.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ADMIN CLIENT, AND WHY THERE IS NO ANON INSERT POLICY.
 *
 * db/migrations/20260807_registry_requests.sql gives registry_requests exactly
 * one policy — "admin only registry_requests" FOR ALL TO authenticated USING
 * (is_admin()) — and REVOKEs the table from anon and authenticated. So an anon
 * insert would fail on every submission, and because supabase-js returns errors
 * rather than throwing, it would fail SILENTLY: the business sees the thank-you,
 * no request exists, and nobody finds out until they follow up weeks later
 * asking why they were never listed.
 *
 * The alternative — an anon INSERT policy — hands anyone holding the anon key
 * (it ships in the browser bundle) a direct, unthrottled writer into a PII table
 * at /rest/v1/registry_requests that never passes through the validation, the
 * honeypot or the rate limiter below. Same reasoning as leads and inquiries.
 *
 * ---------------------------------------------------------------------------
 * SERVICE-ROLE MEANS RLS CHECKS NOTHING, SO THIS FUNCTION MUST.
 *
 * A Server Action is a public POST endpoint with a stable id; anything can call
 * it directly. validateRegistryRequest in lib/registry-requests.ts is the only
 * validation that exists — the form's own `required` and `maxLength` do not
 * apply to a crafted request.
 *
 * FIELD ALLOWLIST, NEVER A SPREAD. The insert names its columns literally.
 * registry_requests also has status, reviewed_at, reviewed_by and review_note;
 * a spread of untrusted input could self-approve a request or attribute the
 * decision to a real admin.
 * ---------------------------------------------------------------------------
 */

/** Field errors travel back in the URL — a redirecting action returns nothing. */
function back(params: Record<string, string>): never {
  redirect(`/join?${new URLSearchParams(params).toString()}`);
}

export async function submitRegistryRequest(formData: FormData): Promise<void> {
  const read = (key: string) => String(formData.get(key) ?? "");

  /**
   * The typed business name rides back on every failure so a refused submission
   * does not empty the form the visitor just filled in. Capped here because it
   * goes into a URL.
   */
  const typedName = read("business_name").trim().slice(0, 200);

  const parsed = validateRegistryRequest({
    businessName: read("business_name"),
    email: read("email"),
    licenseNumber: read("license_number"),
    trade: read("trade"),
    county: read("county"),
    contactName: read("contact_name"),
    phone: read("phone"),
    website: read("website"),
    notes: read("notes"),
    companyUrl: read("company_url"),
  });

  if (!parsed.ok) {
    // The honeypot reports as a generic failure so a bot learns nothing about
    // which field gave it away.
    if (parsed.fields.includes("spam")) back({ add: "1", e: "spam" });
    back({ add: "1", e: parsed.fields.join(","), name: typedName });
  }

  const values = parsed.values;

  /**
   * RATE LIMIT — after validation, before any database work or any email.
   *
   * Everything above this line is string work on data already in memory, so a
   * malformed flood costs nothing and never reaches Postgres. This is the first
   * point where a WELL-FORMED flood — the one the limiter exists for — is
   * stopped, and it is one round trip ahead of the insert and the Resend call.
   *
   * THE REFUSAL NAMES SOMEWHERE ELSE TO GO. A shared office IP is exactly where
   * two legitimate requests come from, so the message must not read as a broken
   * form — REQUEST_ERROR_TEXT.rate points at the support address, which reaches
   * the same people who read this queue.
   */
  const limit = await checkLimits([
    { spec: RATE.REGISTRY_REQUEST_IP_BURST, identifier: requestIp() },
    { spec: RATE.REGISTRY_REQUEST_IP_DAY, identifier: requestIp() },
  ]);
  if (!limit.allowed) back({ add: "1", e: "rate", name: typedName });

  const admin = createAdminClient();

  /**
   * DUPLICATE SUPPRESSION — the same sender, inside 24 hours, is one request.
   *
   * Keyed on email alone rather than (email, business_name): someone who submits
   * twice because they were not sure the first one sent will usually retype the
   * business name slightly differently, and two rows for one business is exactly
   * what makes a small review queue untrustworthy. A genuine second business
   * from the same address the next day is unaffected.
   *
   * ⚠ IT DOES SUPPRESS A GENUINE SECOND BUSINESS ON THE SAME DAY. Accepted: the
   * reviewer already has that person's address and the notes field is where a
   * multi-entity owner explains it, whereas the failure in the other direction
   * is a queue nobody trusts to be one-row-per-business.
   *
   * REPORTED AS SUCCESS, DELIBERATELY. Their request genuinely did arrive the
   * first time, so "sent" is the truthful answer.
   *
   * A FAILED CHECK FALLS THROUGH TO THE INSERT. A duplicate row is recoverable
   * by a human reading two lines; a dropped request is a business that thinks it
   * asked to be listed and was not.
   */
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: dedupeError } = await admin
    .from("registry_requests")
    .select("id")
    .eq("email", values.email)
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();

  if (dedupeError) {
    console.warn("[join] duplicate check failed — allowing the insert", {
      code: dedupeError.code,
      message: dedupeError.message,
    });
  }
  if (recent) {
    console.info("[join] duplicate suppressed — no second request, no second email", {
      existingRequestId: recent.id,
    });
    redirect("/join?sent=1");
  }

  /**
   * THE TABLE IS WRITTEN FIRST AND IS THE SOURCE OF TRUTH. Resend is delivery,
   * not storage — the request is committed before any network call, so a mail
   * outage cannot cost us the request. Only a Postgres failure is reported to
   * the visitor as a failure.
   *
   * status is NOT set here. It defaults to 'pending' in the schema, and naming
   * it would be the one line a future spread could turn into 'approved'.
   */
  const { data: inserted, error } = await admin
    .from("registry_requests")
    .insert({
      business_name: values.business_name,
      email: values.email,
      license_number: values.license_number,
      trade: values.trade,
      county: values.county,
      contact_name: values.contact_name,
      phone: values.phone,
      website: values.website,
      notes: values.notes,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[join] REGISTRY REQUEST INSERT FAILED — request lost", {
      code: error?.code,
      message: error?.message,
      hint:
        error?.code === "PGRST205"
          ? "db/migrations/20260807_registry_requests.sql has not been run."
          : undefined,
    });
    back({ add: "1", e: "failed", name: typedName });
  }

  /**
   * Acknowledgement. Deliberately AFTER the commit and deliberately unable to
   * fail the request: the row exists and the visitor is about to be told so.
   *
   * Awaited rather than fired and forgotten — serverless kills the process once
   * the response is sent, so an un-awaited fetch would be cancelled mid-flight
   * often enough to look like flaky delivery. sendRegistryRequestEmail never
   * throws by contract; the try is belt and braces.
   */
  try {
    const mail = await sendRegistryRequestEmail({
      to: values.email,
      businessName: values.business_name,
    });
    if (!mail.ok) {
      console.warn("[join] acknowledgement not sent — request is safe in Postgres", {
        requestId: inserted.id,
        error: mail.error,
      });
    }
  } catch (err) {
    console.warn("[join] acknowledgement threw — request is safe in Postgres", {
      requestId: inserted.id,
      error: String(err).slice(0, 300),
    });
  }

  redirect("/join?sent=1");
}
