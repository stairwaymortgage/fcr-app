"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Inquiry submission — THE ONLY WRITE PATH IN THE PUBLIC APP.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS USES THE ADMIN CLIENT, AND WHY THAT IS NOT A SHORTCUT
 *
 * 03_rls_policies.sql grants inquiries exactly three policies — SELECT and
 * UPDATE to the owning authenticated contractor, and ALL to admins. There is no
 * INSERT policy for anon, and line 96 says so outright: "Inserts from public
 * contact form go through server-side with service-role."
 *
 * Verified live on 2026-07-30 with the real anon key and a fully valid payload,
 * so the rejection can only be the policy:
 *
 *   anon INSERT into inquiries -> 401 42501
 *   new row violates row-level security policy for table "inquiries"
 *
 * Using the anon client here would therefore fail on EVERY submission. Because
 * supabase-js returns errors rather than throwing, it would fail silently: the
 * visitor sees a success page, the contractor never gets the inquiry, and
 * nothing appears in the logs. Every lead lost at the capture point.
 *
 * ---------------------------------------------------------------------------
 * SERVICE-ROLE MEANS RLS IS NOT CHECKING ANYTHING, SO THIS FUNCTION MUST
 *
 * The policy that would normally constrain a write is bypassed, so every
 * constraint has to be enforced here, in code, on the server. In particular:
 *
 * A SERVER ACTION IS A PUBLIC HTTP ENDPOINT. Next.js compiles this into a
 * POST route with a stable ID that anything can call directly — curl, a script,
 * a replayed request. It is not reachable only through the form on the profile
 * page, and none of the form's own attributes (maxlength, type=email, required)
 * exist as far as this function is concerned. Client-side validation is a
 * courtesy to real users and worth exactly nothing here. Treat every field as
 * hostile.
 *
 * FIELD ALLOWLIST, NOT SPREAD. The insert names four columns literally. The
 * table also has status, replied_at and created_at, and a service-role insert
 * built by spreading untrusted input could set status:'replied' to hide an
 * inquiry, or backdate created_at. Never spread form data into this insert.
 * ---------------------------------------------------------------------------
 */

/** Mirrors the NOT NULL columns on inquiries plus the one optional field. */
const LIMITS = {
  name: { min: 2, max: 100 },
  // 254 is the maximum length of a deliverable address (RFC 5321 path limit).
  email: { max: 254 },
  phone: { max: 32 },
  // The table declares `message text` with no CHECK, so without a cap here a
  // single request could store an arbitrarily large document.
  message: { min: 10, max: 2000 },
} as const;

/**
 * Deliberately permissive. Validating email by regex cannot establish
 * deliverability and a strict pattern rejects legitimate addresses, so this
 * only rejects what is obviously not an address at all. Confirmed-opt-in is the
 * real check and belongs to the concierge flow, not to this function.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Error codes, surfaced through the URL so the page can render them. */
type ErrorCode =
  | "contractor"
  | "name"
  | "email"
  | "message"
  | "phone"
  | "spam"
  | "failed";

function fail(slug: string, codes: ErrorCode[]): never {
  const params = new URLSearchParams({
    inquiry: "invalid",
    e: codes.join(","),
  });
  redirect(`/contractor/${slug}?${params.toString()}`);
}

/**
 * C0 and C1 control characters.
 *
 * Built from a string rather than written as a literal class: these are
 * unprintable, so pasted into a regex literal they are invisible in the editor
 * and in `git diff` — the class looks empty and unreviewable. An earlier draft
 * did exactly that and git classified this file as binary.
 */
const CONTROL_CHARS = new RegExp("[\u0000-\u001f\u007f-\u009f]", "g");

/**
 * Collapse whitespace and strip control characters.
 *
 * Stripped BEFORE the length checks below, because control characters are
 * invisible: without this a "message" of 2,000 null bytes would satisfy the
 * minimum-length rule while being empty to any human reading it.
 */
function clean(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

export async function submitInquiry(formData: FormData): Promise<void> {
  // The slug is needed for every redirect, so it is read first and validated
  // hard — an attacker-supplied value ends up in a Location header.
  const slug = clean(formData.get("slug"));
  if (!slug || !/^[a-z0-9-]{1,200}$/.test(slug)) {
    // Not redirected back to a caller-controlled path: an unrecognised slug is
    // sent to the search page rather than anywhere the input chose.
    redirect("/search");
  }

  const syncKey = clean(formData.get("contractor_dbpr_sync_key"));
  const name = clean(formData.get("from_name"));
  const email = clean(formData.get("from_email")).toLowerCase();
  const phone = clean(formData.get("from_phone"));
  const message = clean(formData.get("message"));
  // Honeypot: a field hidden from users that bots fill in. Cheap, catches naive
  // spam, and stops nothing determined — see the note on rate limiting below.
  const honeypot = clean(formData.get("website"));

  const errors: ErrorCode[] = [];

  if (honeypot) errors.push("spam");
  if (!syncKey || syncKey.length > 200) errors.push("contractor");
  if (name.length < LIMITS.name.min || name.length > LIMITS.name.max) {
    errors.push("name");
  }
  if (!EMAIL_SHAPE.test(email) || email.length > LIMITS.email.max) {
    errors.push("email");
  }
  if (phone && (phone.length > LIMITS.phone.max || !/^[0-9+()\s.-]+$/.test(phone))) {
    errors.push("phone");
  }
  if (
    message.length < LIMITS.message.min ||
    message.length > LIMITS.message.max
  ) {
    errors.push("message");
  }

  if (errors.length > 0) fail(slug, errors);

  /**
   * The contractor must exist, and the slug in the URL must be the slug of the
   * contractor being written to.
   *
   * CHECKED WITH THE ANON CLIENT, ON PURPOSE — this is a read of public
   * directory data, and doing it under RLS keeps the admin client scoped to the
   * single INSERT below.
   *
   * BOTH HALVES MATTER. dbpr_sync_key arrives from a hidden form field, so
   * without the slug match a caller could post the sync key of contractor A
   * while claiming to be on contractor B's page, and the inquiry would land in
   * the wrong contractor's inbox. The FK would not catch that: it only checks
   * the row exists.
   */
  const db = createClient();
  const { data: contractor, error: lookupError } = await db
    .from("contractors")
    .select("dbpr_sync_key")
    .eq("slug", slug)
    .eq("dbpr_sync_key", syncKey)
    .maybeSingle();

  if (lookupError) {
    console.error("[inquiry] contractor lookup failed", lookupError.message);
    fail(slug, ["failed"]);
  }
  if (!contractor) fail(slug, ["contractor"]);

  /**
   * The one privileged statement in the public app.
   *
   * Four columns, named literally. status / replied_at / created_at keep their
   * schema defaults ('unread', NULL, now()) — they are not accepted as input.
   */
  const admin = createAdminClient();
  const { error: insertError } = await admin.from("inquiries").insert({
    contractor_dbpr_sync_key: contractor.dbpr_sync_key,
    from_name: name,
    from_email: email,
    from_phone: phone || null,
    message,
  });

  if (insertError) {
    // Logged loudly. A dropped inquiry is a lost lead, and the visitor is told
    // it failed rather than shown a false success.
    console.error("[inquiry] INSERT FAILED — lead lost", {
      slug,
      code: insertError.code,
      message: insertError.message,
    });
    fail(slug, ["failed"]);
  }

  redirect(`/contractor/${slug}?inquiry=sent`);
}

/**
 * ===========================================================================
 * ⚠ LAUNCH BLOCKER — RATE LIMITING. NOT BACKLOG.
 *
 * Reclassified from follow-up to launch-blocker on 2026-07-30. This must close
 * before EITHER of these, whichever comes first:
 *
 *   - the public apex domain goes live, or
 *   - the first paying (Featured, $29/mo) contractor is onboarded.
 *
 * WHY IT OUTRANKS ordinary spam handling: this is an unauthenticated endpoint
 * that writes with service-role, and every junk row it accepts is delivered to
 * a contractor as a LEAD. Once the Featured tier exists, those contractors are
 * paying for leads — so unthrottled spam is not spam in a table, it is spam
 * inside the monetized product, billed to the victim. That is a refund-and-churn
 * problem, not a cleanup problem.
 *
 * The validation above stops MALFORMED abuse. Nothing here stops VOLUME abuse:
 * a script can POST well-formed inquiries as fast as the endpoint answers. The
 * honeypot catches naive bots only.
 *
 * ORDER OF WORK:
 *   1. Vercel WAF / bot rules — no code, the project is already on Vercel.
 *   2. @upstash/ratelimit keyed on the forwarded IP — a few lines, needs a KV
 *      store. Do this if the WAF proves too coarse.
 *   3. Turnstile / reCAPTCHA — strongest, but adds a client script and so gives
 *      up the zero-client-JS property this page currently has. Last resort.
 *
 * Shipping to the preview deployment without it is fine: no crawlers, no paying
 * contractors, and malformed abuse is already blocked.
 * ===========================================================================
 */
