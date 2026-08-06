import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { attestationText } from "@/lib/claims";
import { formatBusinessName } from "@/lib/contractor-profile";
import { dataAsOf } from "@/lib/data-as-of";
import { createClient } from "@/lib/supabase/server";

import ClaimForm from "./ClaimForm";

/**
 * Claim a profile — /contractor/[slug]/claim
 * Source: _handoff/02_mockups_production/04_contractor_facing/contractor_claim_flow.html
 *
 * Stage 1 of the mockup only. Stage 2 (the $199/mo ranking-website upsell) is
 * labelled "Shown After Approval" in the mockup itself and belongs on
 * /claim/approved — putting a paid upsell in front of someone who has not been
 * verified yet sells to a person who may turn out not to own the business.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SIGNED IN ONLY, AND THE PAGE IS THE BOUNDARY.
 *
 * requireUser() below is the enforcement. The middleware deny-list also covers
 * this path, but that is a redirect for humans — it does not run for Server
 * Actions and a matcher edit silently disables it. Both actions in ./actions.ts
 * re-check the session independently for the same reason.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * noindex: a claim form has nothing to offer search, and every profile in a
 * 266K-row directory would otherwise produce one.
 */

export const metadata: Metadata = {
  title: "Claim this profile · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

/** Field-level errors, echoed back through ?e= by the Server Action. */
const ERROR_TEXT: Record<string, string> = {
  contractor: "We couldn't match that profile. Start again from the profile page.",
  name: "Enter your full legal name as it appears on your ID.",
  role: "Choose your role at the business.",
  email: "Enter a valid email address.",
  phone: "Enter a phone number we can reach you on.",
  photo: "Your ID photo didn't upload. Please choose the file again.",
  attest: "You must confirm you're authorized to claim this profile.",
  terms: "You must accept the Terms of Service and Privacy Policy.",
  website: "Enter a full website address starting with http:// or https://",
  description: "That description is too long — keep it under 1,000 characters.",
  duplicate: "You already have a claim on this profile awaiting review.",
  claimed: "This profile has already been claimed.",
  spam: "That submission looked automated. Please try again.",
  rate: "Too many attempts in a short time. Please wait a few minutes and try again.",
  failed: "Something went wrong on our side. Please try again.",
};

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { e?: string; state?: string };
}) {
  /**
   * Bounce anon to /login carrying this page as `next`, so a contractor who
   * followed "Claim this profile" from the public page lands back here after
   * the magic link rather than on the homepage.
   */
  const user = await requireUser(`/contractor/${params.slug}/claim`);
  const asOf = await dataAsOf();

  const db = createClient();
  const { data: contractor } = await db
    .from("contractors")
    .select("dbpr_sync_key, slug, business_name, license_number, city, claimed_by_user_id")
    .eq("slug", params.slug)
    .maybeSingle();

  if (!contractor) notFound();

  /**
   * Claims are readable by their own claimant under RLS ("claimant reads own
   * claim"), so this returns THIS user's claims and nobody else's — the anon
   * client is doing the access control, not a WHERE clause we could forget.
   */
  const { data: myClaims } = await db
    .from("claims")
    .select("id, status, created_at, rejection_reason")
    .eq("contractor_dbpr_sync_key", contractor.dbpr_sync_key)
    .order("created_at", { ascending: false });

  const pending = myClaims?.find((c) => c.status === "pending");
  const approved = myClaims?.find((c) => c.status === "approved");
  const lastRejection = myClaims?.find((c) => c.status === "rejected");

  const name = formatBusinessName(contractor.business_name) ?? "this business";
  const claimedBySomeoneElse =
    !!contractor.claimed_by_user_id && contractor.claimed_by_user_id !== user.id;
  const claimedByYou = contractor.claimed_by_user_id === user.id;

  const codes = (searchParams.e ?? "").split(",").filter((c) => c in ERROR_TEXT);
  const showPendingNotice = searchParams.state === "pending" || !!pending;

  /** Every terminal state renders instead of the form, never alongside it. */
  const blocked = claimedByYou || claimedBySomeoneElse || showPendingNotice || !!approved;

  return (
    <>
      <Header statsTimestamp={asOf} />
      <main id="main" className="bg-paper">
        <div className="mx-auto max-w-[720px] px-6 py-16 max-[700px]:py-10">
          <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
            Verified contractor program
          </p>
          <h1 className="mb-4 font-serif text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy max-[700px]:text-[27px]">
            Claim <em className="not-italic text-gold">{name}</em>
          </h1>

          <div className="mb-8 border border-gray-200 bg-paper-raised px-6 py-5">
            <p className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
              You&rsquo;re claiming
            </p>
            <p className="mt-1 text-[17px] font-semibold text-navy">{name}</p>
            <p className="mt-0.5 font-mono text-note text-gray-600">
              {contractor.license_number ?? "—"}
              {contractor.city ? ` · ${contractor.city}, FL` : ""}
            </p>
            <Link
              href={`/contractor/${contractor.slug}`}
              className="mt-3 inline-block font-mono text-label uppercase tracking-label text-gold"
            >
              Not mine →
            </Link>
          </div>

          {claimedByYou && (
            <Notice heading="You already manage this profile.">
              This profile is yours. Head to your{" "}
              <Link href="/dashboard">dashboard</Link> to edit it.
            </Notice>
          )}

          {claimedBySomeoneElse && (
            <Notice heading="This profile has already been claimed.">
              Someone has already verified their identity against this license. If you
              believe that&rsquo;s wrong, email us and we&rsquo;ll investigate — we keep
              the ID photo behind every approved claim.
            </Notice>
          )}

          {!claimedByYou && !claimedBySomeoneElse && showPendingNotice && (
            <Notice heading="Your claim is being reviewed.">
              We received it{pending ? "" : " just now"} and a person is checking it
              against DBPR records. Manual review takes 24&ndash;48 hours and
              you&rsquo;ll get an email either way. There&rsquo;s nothing else to do.
            </Notice>
          )}

          {!blocked && (
            <>
              {codes.length > 0 && (
                <div
                  role="alert"
                  className="mb-6 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3"
                >
                  <p className="mb-1 font-mono text-label font-semibold uppercase tracking-label text-status-error">
                    Please fix the following
                  </p>
                  <ul className="list-disc pl-5 text-note text-status-error">
                    {codes.map((c) => (
                      <li key={c}>{ERROR_TEXT[c]}</li>
                    ))}
                  </ul>
                </div>
              )}

              {lastRejection && (
                <Notice heading="Your previous claim wasn't approved.">
                  {lastRejection.rejection_reason
                    ? lastRejection.rejection_reason
                    : "You're welcome to submit again with a clearer photo of your ID."}
                </Notice>
              )}

              <ClaimForm
                slug={contractor.slug}
                syncKey={contractor.dbpr_sync_key}
                licenseNumber={contractor.license_number ?? ""}
                businessName={name}
                defaultEmail={user.email ?? ""}
                attestation={attestationText(name)}
              />
            </>
          )}

          <section className="mt-12 border-t border-gray-200 pt-8">
            <h2 className="mb-4 font-serif text-[22px] font-semibold text-navy">
              How review works
            </h2>
            <ol className="flex flex-col gap-2 text-note leading-[1.6] text-gray-700">
              <li>1. You submit this form with a photo of your ID.</li>
              <li>2. We verify your name against public DBPR records.</li>
              <li>3. You receive an email approving the claim or asking for more.</li>
              <li>4. Once approved, your verified badge goes live immediately.</li>
            </ol>
            <p className="mt-4 text-note leading-[1.6] text-gray-600">
              Your ID is reviewed by a person and is never published on the site, sold,
              or shared. We delete it 90 days after the decision.
            </p>
          </section>
        </div>
      </main>
      <Footer lastSyncDate={asOf} />
    </>
  );
}

function Notice({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="mb-8 border-l-[3px] border-l-gold bg-gray-50 px-5 py-4">
      <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-navy">
        {heading}
      </p>
      <p className="text-note leading-[1.6] text-gray-700">{children}</p>
    </div>
  );
}
