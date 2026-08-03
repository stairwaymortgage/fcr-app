import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/auth";
import { CLAIM_ROLES, ID_PHOTO_BUCKET, oneRelation } from "@/lib/claims";
import { formatBusinessName } from "@/lib/contractor-profile";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { createAdminClient } from "@/lib/supabase/admin";

import { approveClaim, rejectClaim } from "./actions";

/**
 * Claim review queue — /admin/claims
 * Source: _handoff/02_mockups_production/08_admin/admin_claim_review.html
 *
 * The mockup shows fields this project does not collect — date of birth,
 * submitting IP, device, an automatic address-match verdict. They are omitted
 * rather than faked: a review screen that displays "✓ Address Match" from
 * nothing would be worse than not showing it, because the reviewer would
 * believe a check had happened.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMIN ONLY, AND A NON-ADMIN GETS 404.
 *
 * requireAdmin() calls notFound() rather than returning 403, so /admin/* never
 * confirms it exists to a signed-in contractor who guessed the URL. Middleware
 * rewrites the same path to the 404 as a first pass; this is the enforcement,
 * since middleware does not run for Server Actions.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE ID PHOTO IS A PLAIN <img> AND MUST STAY ONE.
 *
 * next/image would route these through Vercel's image optimizer, which fetches
 * the source once and CACHES THE RESULT ON THE CDN under a URL derived from
 * the source — no signed token involved. The photo would then be servable
 * after the signed URL expired, from an edge cache, to anyone who found the
 * optimizer URL. That is precisely the public copy the whole bucket design
 * exists to prevent.
 *
 * A plain <img> fetches the signed URL directly and nothing persists it.
 * unoptimized on next/image would also work, but it is one prop away from
 * being "tidied up" by someone who does not know why it is there.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const metadata: Metadata = {
  title: "Claim review · Admin",
  robots: { index: false, follow: false },
};

/** Signed URLs are minted per page load. Long enough to review, short enough
 *  that a copied link is not a lasting handout. */
const SIGNED_URL_TTL_SECONDS = 600;

const ROLE_LABEL = Object.fromEntries(CLAIM_ROLES.map((r) => [r.value, r.label]));

type ClaimRow = {
  id: string;
  created_at: string;
  claimant_user_id: string;
  claimant_name: string;
  claimant_email: string;
  claimant_phone: string | null;
  claimant_role: string | null;
  id_photo_url: string;
  proposed_business_description: string | null;
  proposed_business_website: string | null;
  contractor_dbpr_sync_key: string;
  contractors: unknown;
};

export default async function AdminClaimsPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string };
}) {
  await requireAdmin();

  /**
   * Read with the ADMIN client. RLS would allow an admin session to read claims
   * anyway, but the signed URLs below need service-role regardless, and using
   * one client for the whole page keeps the two from disagreeing about which
   * rows exist.
   */
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("claims")
    .select(
      `id, created_at, claimant_user_id, claimant_name, claimant_email,
       claimant_phone, claimant_role, id_photo_url,
       proposed_business_description, proposed_business_website,
       contractor_dbpr_sync_key,
       contractors ( slug, business_name, license_number, city,
                     qualifying_agent_name, claimed_by_user_id )`,
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[admin] could not load claim queue", error.message);
  }

  const claims = (data ?? []) as unknown as ClaimRow[];

  /**
   * One signed URL per claim, generated here so the reviewer never touches
   * Supabase. createSignedUrls is a single round trip rather than N.
   */
  const paths = claims.map((c) => c.id_photo_url).filter(Boolean);
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await admin.storage
      .from(ID_PHOTO_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl);
    }
  }

  /** Profiles with more than one pending claim — flagged, not auto-resolved. */
  const contested = new Set(
    claims
      .map((c) => c.contractor_dbpr_sync_key)
      .filter((k, i, arr) => arr.indexOf(k) !== i),
  );

  return (
    <main id="main" className="min-h-screen bg-paper">
      <div className="mx-auto max-w-[1100px] px-6 py-10 max-[700px]:px-4">
        <div className="mb-8 flex items-end justify-between gap-4 border-b border-gray-200 pb-5">
          <div>
            <p className="mb-2 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
              Admin
            </p>
            <h1 className="font-serif text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
              Claim review queue
            </h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <p className="font-mono text-[28px] font-semibold text-navy">
              {claims.length}
              <span className="ml-2 align-middle font-mono text-label uppercase tracking-label text-gray-500">
                pending
              </span>
            </p>
            {/*
              POST to the existing route, not a Server Action and not a link.
              Same control as the dashboard's, for the same reason recorded in
              app/auth/signout/route.ts: a GET sign-out can be fired by any image
              tag on any site, which logs a reviewer out mid-decision.

              No client JS — a plain form and a route handler. There is nothing
              here for "use client" to do.
            */}
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className={`text-note font-medium text-gray-600 underline hover:text-navy ${FOCUS_RING_PAPER}`}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {searchParams.ok && (
          <p
            role="status"
            className="mb-6 border-l-[3px] border-status-success bg-status-successBg px-4 py-3 text-note text-status-success"
          >
            Claim {searchParams.ok}.
            {searchParams.ok === "approved" &&
              " The profile is now linked to that contractor."}
          </p>
        )}
        {searchParams.error && (
          <p
            role="alert"
            className="mb-6 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note text-status-error"
          >
            {searchParams.error}
          </p>
        )}

        {claims.length === 0 ? (
          <p className="border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center text-note text-gray-600">
            Nothing waiting. New claims appear here as they&rsquo;re submitted.
          </p>
        ) : (
          <div className="flex flex-col gap-8">
            {claims.map((claim) => {
              const k = oneRelation<{
                slug: string;
                business_name: string | null;
                license_number: string | null;
                city: string | null;
                qualifying_agent_name: string | null;
                claimed_by_user_id: string | null;
              }>(claim.contractors);

              const photo = signedByPath.get(claim.id_photo_url);
              const business = k?.business_name
                ? formatBusinessName(k.business_name)
                : "(unknown business)";

              return (
                <article
                  key={claim.id}
                  className="border border-gray-200 bg-paper-raised"
                >
                  <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 px-6 py-4 max-[700px]:px-4">
                    <div>
                      <p className="font-mono text-micro uppercase tracking-label text-gray-500">
                        Claim {claim.id.slice(0, 8)} · submitted{" "}
                        {new Date(claim.created_at).toLocaleString("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                      <h2 className="mt-1 font-serif text-[21px] font-semibold text-navy">
                        {claim.claimant_name}
                      </h2>
                    </div>
                    {contested.has(claim.contractor_dbpr_sync_key) && (
                      <span className="bg-status-warnBg px-3 py-1 font-mono text-label font-semibold uppercase tracking-label text-status-warn">
                        ⚠ Contested — more than one pending claim
                      </span>
                    )}
                  </header>

                  <div className="grid grid-cols-2 gap-6 px-6 py-6 max-[900px]:grid-cols-1 max-[700px]:px-4">
                    {/* ── The comparison the whole page exists for ── */}
                    <div>
                      <h3 className="mb-3 font-mono text-label font-semibold uppercase tracking-label text-navy">
                        Identity check
                      </h3>
                      <dl className="mb-5 border border-gray-200">
                        <Row
                          label="Name on the claim"
                          value={claim.claimant_name}
                          emphasis
                        />
                        <Row
                          label="Qualifying agent (DBPR)"
                          value={k?.qualifying_agent_name ?? "— not on file —"}
                          emphasis
                        />
                        <Row label="License" value={k?.license_number ?? "—"} />
                        <Row
                          label="Role claimed"
                          value={
                            claim.claimant_role
                              ? (ROLE_LABEL[claim.claimant_role] ?? claim.claimant_role)
                              : "—"
                          }
                        />
                      </dl>
                      <p className="mb-5 text-micro leading-[1.6] text-gray-600">
                        Compare the name on the ID with the qualifying agent above. A
                        mismatch is usually a spouse or partner, not fraud &mdash; reject
                        with a reason saying so, or ask the qualifying agent to claim it.
                      </p>

                      <h3 className="mb-3 font-mono text-label font-semibold uppercase tracking-label text-navy">
                        Profile being claimed
                      </h3>
                      <dl className="mb-5 border border-gray-200">
                        <Row label="Business" value={business} />
                        <Row label="Location" value={k?.city ? `${k.city}, FL` : "—"} />
                        <Row
                          label="Already claimed?"
                          value={k?.claimed_by_user_id ? "YES — check before approving" : "No"}
                        />
                      </dl>

                      <h3 className="mb-3 font-mono text-label font-semibold uppercase tracking-label text-navy">
                        Claimant
                      </h3>
                      <dl className="border border-gray-200">
                        <Row label="Email" value={claim.claimant_email} />
                        <Row label="Phone" value={claim.claimant_phone ?? "—"} />
                      </dl>

                      {(claim.proposed_business_description ||
                        claim.proposed_business_website) && (
                        <>
                          <h3 className="mb-3 mt-5 font-mono text-label font-semibold uppercase tracking-label text-navy">
                            Proposed profile text{" "}
                            <span className="text-gray-500">(unverified)</span>
                          </h3>
                          <div className="border border-gray-200 px-4 py-3 text-note leading-[1.6] text-gray-700">
                            {claim.proposed_business_description && (
                              <p className="mb-2 whitespace-pre-line">
                                {claim.proposed_business_description}
                              </p>
                            )}
                            {claim.proposed_business_website && (
                              <p className="font-mono text-micro text-gray-600">
                                {claim.proposed_business_website}
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* ── The ID photo ── */}
                    <div>
                      <h3 className="mb-3 font-mono text-label font-semibold uppercase tracking-label text-navy">
                        Government ID
                      </h3>
                      {photo ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element --
                              Deliberate: next/image would cache this on the CDN
                              without a token. See the docblock at the top. */}
                          <img
                            src={photo}
                            alt={`Government ID submitted by ${claim.claimant_name}`}
                            className="w-full border border-gray-200 bg-gray-100"
                          />
                          <p className="mt-2 font-mono text-micro text-gray-500">
                            Private bucket · link expires in{" "}
                            {SIGNED_URL_TTL_SECONDS / 60} minutes
                          </p>
                          <a
                            href={photo}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block font-mono text-label uppercase tracking-label text-gold"
                          >
                            Open full size →
                          </a>
                        </>
                      ) : (
                        <p className="border border-dashed border-status-error bg-status-errorBg px-4 py-6 text-note text-status-error">
                          The ID photo could not be loaded. Path on record:{" "}
                          <span className="font-mono">{claim.id_photo_url}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* ── Decision ── */}
                  <div className="grid grid-cols-2 gap-6 border-t border-gray-200 bg-gray-50 px-6 py-5 max-[900px]:grid-cols-1 max-[700px]:px-4">
                    <form action={approveClaim} className="flex flex-col gap-2">
                      <input type="hidden" name="claim_id" value={claim.id} />
                      <label className="font-mono text-micro uppercase tracking-label text-gray-500">
                        Internal note (optional)
                      </label>
                      <input
                        name="admin_notes"
                        type="text"
                        maxLength={2000}
                        placeholder="e.g. ID matches DBPR record"
                        className="border border-gray-300 bg-white px-3 py-2 text-note"
                      />
                      <button
                        type="submit"
                        className="bg-status-success px-5 py-3 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-status-successDeep"
                      >
                        Approve — link profile to {claim.claimant_name.split(" ")[0]} →
                      </button>
                    </form>

                    <form action={rejectClaim} className="flex flex-col gap-2">
                      <input type="hidden" name="claim_id" value={claim.id} />
                      <label className="font-mono text-micro uppercase tracking-label text-gray-500">
                        Reason — shown to the contractor
                      </label>
                      <input
                        name="rejection_reason"
                        type="text"
                        maxLength={1000}
                        placeholder="e.g. The photo was too blurry to read the name."
                        className="border border-gray-300 bg-white px-3 py-2 text-note"
                      />
                      {/*
                        OPTIONAL, AND SAYING SO IS THE POINT.

                        Both decision forms are one input above one button, side
                        by side, with no confirm step — so Reject submits
                        immediately with whatever is in the box, and an empty box
                        is easy to not notice. A blank reason is a legitimate
                        outcome (reject_claim() blanks it to NULL and
                        /claim/rejected falls back to its generic wording), so
                        `required` would be wrong: a reviewer forced to type will
                        type "no". This line makes the consequence visible
                        instead, which is the part that was missing.
                      */}
                      <p className="text-micro leading-[1.5] text-gray-500">
                        Optional. Leave it blank and the contractor sees only our
                        generic explanation — no reviewer note.
                      </p>
                      <button
                        type="submit"
                        className="border border-status-error px-5 py-3 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-status-error transition-colors hover:bg-status-error hover:text-paper"
                      >
                        Reject
                      </button>
                    </form>
                  </div>

                  <footer className="border-t border-gray-200 px-6 py-3 max-[700px]:px-4">
                    <Link
                      href={`/contractor/${k?.slug ?? ""}`}
                      target="_blank"
                      className="font-mono text-label uppercase tracking-label text-gold"
                    >
                      View the public profile →
                    </Link>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-gray-200 px-4 py-2.5 last:border-b-0">
      <dt className="font-mono text-micro uppercase tracking-label text-gray-500">
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? "text-right text-[15px] font-semibold text-navy"
            : "text-right text-note text-gray-700"
        }
      >
        {value}
      </dd>
    </div>
  );
}
