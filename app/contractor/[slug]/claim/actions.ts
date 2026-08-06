"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth";
import {
  attestationText,
  CLAIM_LIMITS,
  CLAIM_ROLE_VALUES,
  ID_PHOTO_BUCKET,
  ID_PHOTO_EXTENSIONS,
  ID_PHOTO_MAX_BYTES,
  ID_PHOTO_MIME_TYPES,
} from "@/lib/claims";
import { LIMITS as RATE, checkLimit, checkLimits } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Claim submission.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A SERVER ACTION IS A PUBLIC HTTP ENDPOINT.
 *
 * Next.js compiles each of these into a POST route with a stable id. Anything
 * can call them — curl, a script, a replayed request — without ever loading the
 * claim page. Nothing the form does (required, accept, maxlength, the disabled
 * submit button) exists as far as these functions are concerned. Every field
 * below is treated as hostile.
 *
 * This is sharper here than on the inquiry form, because these two actions
 * together mint an upload credential for a private bucket and write the row
 * that decides who owns a business listing.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STORAGE PATH IS NEVER ACCEPTED FROM THE CLIENT. IT IS DERIVED.
 *
 * The obvious shape — hand the browser a path, take it back on submit — is an
 * arbitrary-write primitive: post someone else's uid as the first segment and
 * the service-role client writes into their folder, because service-role
 * bypasses the RLS that would have stopped it.
 *
 * So: the upload path is built server-side from getUser().id, and on submit
 * only the claim UUID crosses the wire. The object is then located by LISTING
 * the caller's own folder. A caller who posts someone else's claim id finds
 * nothing, because the folder searched is always their own.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const CONTROL_CHARS = new RegExp("[\u0000-\u001f\u007f-\u009f]", "g");

function clean(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** Multi-line fields keep their newlines; only control chars and edges go. */
function cleanMultiline(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, (c) => (c === "\n" ? "\n" : " ")).trim();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_SHAPE = /^[a-z0-9-]{1,200}$/;

export type UploadTarget =
  | { ok: true; claimId: string; path: string; token: string }
  | { ok: false; error: string };

/**
 * Look up the contractor and the caller's standing against it.
 *
 * Read with the ANON client on purpose: contractors is public directory data
 * and claims is readable by its own claimant under RLS, so neither needs
 * privilege. Keeping the admin client scoped to the single INSERT is the whole
 * point of having two clients.
 *
 * BOTH slug AND sync key are matched. The sync key arrives from a hidden field;
 * without the slug match a caller could post contractor A's key from
 * contractor B's page and claim the wrong business.
 */
async function loadContext(slug: string, syncKey: string, userId: string) {
  const db = createClient();

  const { data: contractor } = await db
    .from("contractors")
    .select("dbpr_sync_key, business_name, license_number, claimed_by_user_id")
    .eq("slug", slug)
    .eq("dbpr_sync_key", syncKey)
    .maybeSingle();

  if (!contractor) return { contractor: null as null, mine: null as null };

  const { data: mine } = await db
    .from("claims")
    .select("id, status")
    .eq("contractor_dbpr_sync_key", contractor.dbpr_sync_key)
    .eq("claimant_user_id", userId)
    .eq("status", "pending")
    .maybeSingle();

  return { contractor, mine };
}

/**
 * Step 1 — mint a one-shot upload URL for the ID photo.
 *
 * Returns a token the browser POSTs the file to directly. The file never
 * travels through this action: a Server Action body is capped (1 MB by default)
 * and a 10 MB phone photo would fail with a body-size error that reads like a
 * bug rather than a limit.
 */
export async function createIdPhotoUploadTarget(input: {
  slug: string;
  syncKey: string;
  mimeType: string;
  size: number;
}): Promise<UploadTarget> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Please sign in again — your session expired." };

  const slug = clean(input?.slug);
  const syncKey = clean(input?.syncKey);
  if (!SLUG_SHAPE.test(slug) || !syncKey || syncKey.length > 200) {
    return { ok: false, error: "That profile could not be found." };
  }

  /**
   * Type and size are checked here AND enforced by the bucket. This copy exists
   * to fail in one round trip with a readable message; the bucket's copy is the
   * one that cannot be lied to, since both values here are self-reported by the
   * browser.
   */
  const mime = String(input?.mimeType ?? "").toLowerCase();
  if (!(ID_PHOTO_MIME_TYPES as readonly string[]).includes(mime)) {
    return { ok: false, error: "That file type isn't accepted. Use a JPG, PNG, HEIC or WEBP photo." };
  }
  if (!Number.isFinite(input?.size) || input.size <= 0 || input.size > ID_PHOTO_MAX_BYTES) {
    return { ok: false, error: "That photo is larger than 10MB. Try again with a smaller image." };
  }

  /**
   * RATE LIMIT — keyed on the USER, and carrying more weight than "requires a
   * session" suggests. A session costs one email and two requests, so
   * authentication is a speed bump here rather than a control.
   *
   * ⚠ WHAT IT STOPS IS SPECIFIC TO THIS FUNCTION'S DESIGN. Every call mints a
   * FRESH claim id and therefore a FRESH storage path — deliberately, because
   * the bucket grants INSERT but not UPDATE and a reused path could never be
   * written twice. Both guards below ("already claimed", "you have a pending
   * claim") stay satisfied indefinitely until a claim ROW is actually written.
   * So without this limit one account can mint unlimited signed upload URLs and
   * push 10MB per object into a private bucket across 266,305 unclaimed
   * contractors — and nothing would ever remove them, because the 90-day purge
   * scans the claims table and an orphaned object has no claim row to find.
   *
   * PLACED BEFORE loadContext() so a flood does not get two free queries per
   * attempt, and well before the signed URL is minted.
   */
  const uploadVerdict = await checkLimits([
    { spec: RATE.CLAIM_UPLOAD_USER, identifier: user.id },
    { spec: RATE.CLAIM_UPLOAD_USER_DAY, identifier: user.id },
  ]);
  if (!uploadVerdict.allowed) {
    console.warn("[claim] upload target refused — limit reached", { userId: user.id });
    return {
      ok: false,
      error: "Too many upload attempts. Wait a few minutes before trying again.",
    };
  }

  const { contractor, mine } = await loadContext(slug, syncKey, user.id);
  if (!contractor) return { ok: false, error: "That profile could not be found." };
  if (contractor.claimed_by_user_id) {
    return { ok: false, error: "This profile has already been claimed." };
  }
  if (mine) {
    return { ok: false, error: "You already have a claim on this profile awaiting review." };
  }

  /**
   * The claim id is generated HERE, before the upload, so the file and the row
   * that will describe it share an identifier without a round trip.
   *
   * A fresh uuid on every attempt, deliberately. The bucket grants INSERT but
   * not UPDATE, so a path that already holds an object can never be written
   * again — reusing an id after a half-failed upload would fail forever.
   */
  const claimId = randomUUID();
  const ext = ID_PHOTO_EXTENSIONS[mime] ?? "jpg";
  const path = `${user.id}/${claimId}.${ext}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(ID_PHOTO_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[claim] could not create upload URL", { message: error?.message });
    return { ok: false, error: "We couldn't start the upload. Please try again." };
  }

  return { ok: true, claimId, path, token: data.token };
}

type ErrorCode =
  | "contractor"
  | "name"
  | "role"
  | "email"
  | "phone"
  | "photo"
  | "attest"
  | "terms"
  | "website"
  | "description"
  | "duplicate"
  | "claimed"
  | "spam"
  | "rate"
  | "failed";

function fail(slug: string, codes: ErrorCode[]): never {
  redirect(`/contractor/${slug}/claim?e=${codes.join(",")}`);
}

/**
 * Step 2 — validate everything and write the claim.
 */
export async function submitClaim(formData: FormData): Promise<void> {
  const slug = clean(formData.get("slug"));
  // Validated before any redirect uses it: an attacker-supplied value would
  // otherwise land in a Location header.
  if (!SLUG_SHAPE.test(slug)) redirect("/search");

  /**
   * Authentication is re-checked here rather than inherited from the page.
   * The page's requireUser() protects the page; this endpoint is reachable
   * without it.
   */
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/contractor/${slug}/claim`)}`);

  const syncKey = clean(formData.get("contractor_dbpr_sync_key"));
  const claimId = clean(formData.get("claim_id"));
  const name = clean(formData.get("claimant_name"));
  const role = clean(formData.get("claimant_role"));
  const email = clean(formData.get("claimant_email")).toLowerCase();
  const phone = clean(formData.get("claimant_phone"));
  const description = cleanMultiline(formData.get("business_description"));
  const website = clean(formData.get("business_website"));
  const attested = formData.get("attest") === "on";
  const acceptedTerms = formData.get("terms") === "on";
  const marketing = formData.get("marketing") === "on";
  const honeypot = clean(formData.get("website_hp"));

  const errors: ErrorCode[] = [];

  if (honeypot) errors.push("spam");
  if (!syncKey || syncKey.length > 200) errors.push("contractor");
  if (!UUID_SHAPE.test(claimId)) errors.push("photo");
  if (name.length < CLAIM_LIMITS.name.min || name.length > CLAIM_LIMITS.name.max) {
    errors.push("name");
  }
  if (!CLAIM_ROLE_VALUES.includes(role)) errors.push("role");
  if (!EMAIL_SHAPE.test(email) || email.length > CLAIM_LIMITS.email.max) errors.push("email");
  if (
    phone.length < CLAIM_LIMITS.phone.min ||
    phone.length > CLAIM_LIMITS.phone.max ||
    !/^[0-9+()\s.-]+$/.test(phone)
  ) {
    errors.push("phone");
  }
  if (description.length > CLAIM_LIMITS.description.max) errors.push("description");
  /**
   * A website is optional, but if given it must be http(s). Left unchecked this
   * string is rendered as an href on the public profile after approval, and
   * "javascript:..." in that position is stored XSS.
   */
  if (website) {
    if (website.length > CLAIM_LIMITS.website.max) {
      errors.push("website");
    } else {
      try {
        const parsed = new URL(website);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") errors.push("website");
      } catch {
        errors.push("website");
      }
    }
  }
  // Both boxes are legally required, so neither is inferred from the other.
  if (!attested) errors.push("attest");
  if (!acceptedTerms) errors.push("terms");

  if (errors.length > 0) fail(slug, errors);

  /**
   * RATE LIMIT — the lightest one here, and the reason is that this endpoint is
   * already well defended: it needs a session, it needs a real uploaded photo in
   * the caller's own folder, and the partial unique index makes a duplicate
   * claim a 23505 rather than a second row.
   *
   * It exists so that this is not the one write path in the application with no
   * ceiling at all. What it actually bounds is the storage LIST and the INSERT
   * attempt below — cheap individually, unbounded without it.
   */
  const submitVerdict = await checkLimit(RATE.CLAIM_SUBMIT_USER, user.id);
  if (!submitVerdict.allowed) {
    console.warn("[claim] submission refused — limit reached", { userId: user.id });
    fail(slug, ["rate"]);
  }

  const { contractor, mine } = await loadContext(slug, syncKey, user.id);
  if (!contractor) fail(slug, ["contractor"]);
  if (contractor.claimed_by_user_id) fail(slug, ["claimed"]);
  if (mine) fail(slug, ["duplicate"]);

  /**
   * THE PHOTO MUST EXIST, AND IT IS FOUND BY LISTING THE CALLER'S OWN FOLDER.
   *
   * Not by trusting a path. The folder searched is always `user.id`, so a
   * caller who posts a claim id belonging to someone else simply finds nothing
   * — the check cannot be steered at another user's objects.
   *
   * Without this a claim row could be written with no ID photo behind it, and
   * Jim would open a verification request with nothing to verify.
   */
  const admin = createAdminClient();
  const { data: files, error: listError } = await admin.storage
    .from(ID_PHOTO_BUCKET)
    .list(user.id, { search: claimId, limit: 2 });

  if (listError) {
    console.error("[claim] could not verify uploaded photo", { message: listError.message });
    fail(slug, ["failed"]);
  }
  const photo = files?.find((f) => f.name.startsWith(claimId));
  if (!photo) fail(slug, ["photo"]);

  const path = `${user.id}/${photo.name}`;

  /**
   * Field allowlist, named literally — never a spread of form data.
   *
   * status, created_at and id_photo_expires_at keep their schema defaults
   * ('pending', now(), now() + 90 days). Accepting them as input would let a
   * caller post status:'approved' and grant themselves a business listing,
   * because service-role means no policy is checking.
   */
  const { error: insertError } = await admin.from("claims").insert({
    id: claimId,
    contractor_dbpr_sync_key: contractor.dbpr_sync_key,
    claimant_user_id: user.id,
    claimant_name: name,
    claimant_email: email,
    claimant_phone: phone,
    claimant_role: role,
    id_photo_url: path,
    proposed_business_description: description || null,
    proposed_business_website: website || null,
    marketing_opt_in: marketing,
    attestation_text: attestationText(contractor.business_name ?? "this business"),
  });

  if (insertError) {
    // 23505 is the partial unique index: a second submission raced the first.
    // That is the index doing its job, so the claimant is told their claim is
    // already in review rather than shown a failure.
    if (insertError.code === "23505") {
      redirect(`/contractor/${slug}/claim?state=pending`);
    }
    console.error("[claim] INSERT FAILED", {
      slug,
      code: insertError.code,
      message: insertError.message,
    });
    fail(slug, ["failed"]);
  }

  redirect("/claim/submitted");
}
