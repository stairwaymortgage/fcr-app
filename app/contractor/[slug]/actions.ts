"use server";

import { redirect } from "next/navigation";

// Aliased: this file already has a LIMITS const for field lengths, and two
// different things called LIMITS one screen apart is how the wrong one gets
// edited.
import { LIMITS as RATE, checkLimits, requestIp } from "@/lib/rate-limit";
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
  | "rate"
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
   * RATE LIMIT — after validation, before any database work.
   *
   * ORDER MATTERS AND THIS IS THE CHEAPEST CORRECT POSITION. Validation above
   * costs nothing (string work on data already in memory), so a malformed flood
   * is rejected without touching Postgres at all. A well-formed flood — the one
   * the limiter exists for — is stopped here, one round trip in, before the
   * contractor lookup and before the privileged INSERT.
   *
   * THE PER-CONTRACTOR BUCKET USES THE SUBMITTED SYNC KEY, not the looked-up
   * one, because the lookup has not happened yet and doing it first would give
   * a flood a free query each. A caller who posts a junk sync key therefore
   * consumes a junk bucket and is refused by the lookup a moment later either
   * way; the key is length-capped above, and it is hashed before storage.
   */
  const ip = requestIp();
  const limit = await checkLimits([
    { spec: RATE.INQUIRY_IP_BURST, identifier: ip },
    { spec: RATE.INQUIRY_CONTRACTOR, identifier: syncKey },
    { spec: RATE.INQUIRY_IP_DAY, identifier: ip },
  ]);
  if (!limit.allowed) fail(slug, ["rate"]);

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

  const admin = createAdminClient();

  /**
   * DUPLICATE SUPPRESSION — the same sender, to the same contractor, inside 24
   * hours writes one row, not two.
   *
   * This is a rate-limiting control, not a tidiness one, and it covers a case
   * the counters above cannot: an actor who stays politely under every window
   * but submits from a rotating IP pool all week. The thing that has to stay
   * constant for the spam to reach its target is the target, and for it to look
   * like a real lead it needs a plausible sender — so (sender, contractor) is
   * the pair worth collapsing.
   *
   * IT ALSO FIXES A REAL-USER BUG that predates this work: a double-click, or
   * the browser replaying the POST on a back-navigation, currently delivers the
   * contractor two identical leads. They are billed for one of those.
   *
   * REPORTED AS SUCCESS, DELIBERATELY. The sender's message did arrive the
   * first time, so "sent" is the truthful answer, and a "duplicate" error would
   * tell a spammer exactly which of their identities has already landed.
   *
   * A failed check falls through to the insert rather than blocking. The worst
   * case is the duplicate row we have always had — never a lost lead.
   */
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: dupeError } = await admin
    .from("inquiries")
    .select("id")
    .eq("contractor_dbpr_sync_key", contractor.dbpr_sync_key)
    .eq("from_email", email)
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();

  if (dupeError) {
    console.warn("[inquiry] duplicate check failed — allowing the insert", {
      code: dupeError.code,
      message: dupeError.message,
    });
  }
  if (recent) {
    redirect(`/contractor/${slug}?inquiry=sent`);
  }

  /**
   * The one privileged statement in the public app.
   *
   * Four columns, named literally. status / replied_at / created_at keep their
   * schema defaults ('unread', NULL, now()) — they are not accepted as input.
   */
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
 * RATE LIMITING — the launch blocker recorded here on 2026-07-30, closed for
 * THIS ENDPOINT on 2026-08-06.
 *
 * ⚠ "CLOSED FOR THIS ENDPOINT" IS THE WHOLE CLAIM. The blocker covers six
 * public write paths and is not closed until all six are wired and
 * db/migrations/20260806_rate_limits.sql has been run. Do not read this note as
 * the blocker being done.
 *
 * What it was: this is an unauthenticated endpoint that writes with
 * service-role, and every junk row it accepts is delivered to a contractor as a
 * LEAD. Once the Featured tier exists those contractors are paying for leads, so
 * unthrottled spam is not spam in a table — it is spam inside the monetized
 * product, billed to the victim. A refund-and-churn problem, not a cleanup one.
 *
 * WHAT NOW STANDS BETWEEN THE FORM AND THE INSERT, cheapest first:
 *   0. Validation and the honeypot above — free, stops malformed abuse.
 *   1. Three counters in lib/rate-limit.ts: per-IP burst, per-CONTRACTOR, per-IP
 *      daily. The per-contractor one is the one that survives IP rotation and
 *      the one that protects the paying customer's inbox.
 *   2. Duplicate suppression on (sender, contractor) within 24h.
 *
 * WHAT IS DELIBERATELY STILL OPEN:
 *
 *   VOLUME COSTS ARE NOT HANDLED HERE AND CANNOT BE. Every request rejected
 *   above has already booted a Vercel function and been billed. Dropping
 *   traffic before compute is the WAF's job — the rules live in the Vercel
 *   dashboard, and they are step 1 of this defence, not an optional extra. If
 *   they are ever removed, this file does not compensate.
 *
 *   TURNSTILE IS STILL DEFERRED, and the reason is specific to THIS page rather
 *   than general reluctance: the profile page ships zero client JavaScript, and
 *   a challenge widget gives that up for every visitor in order to inconvenience
 *   a spammer who is already limited to 3 per 10 minutes. Revisit only if the
 *   counters are observed tripping constantly, which would mean a distributed
 *   source the IP buckets cannot see.
 *
 * THE LIMITER FAILS OPEN. If Postgres is unreachable this endpoint is unlimited
 * again, loudly, in the logs. That is the intended trade — see the docblock in
 * lib/rate-limit.ts — because a limiter outage that ate leads would be worse
 * than the abuse it prevents.
 * ===========================================================================
 */
