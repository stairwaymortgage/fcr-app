import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { oneRelation } from "@/lib/claims";
import { formatBusinessName } from "@/lib/contractor-profile";
import { DATA_AS_OF } from "@/lib/registry-stats";
import { createClient } from "@/lib/supabase/server";

/**
 * Claim not approved — /claim/rejected
 *
 * Status read from the database, not the URL — same reasoning as
 * /claim/approved. A page that says "rejected" to anyone who types the path
 * would tell a contractor with a perfectly good pending claim that they had
 * been turned down.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REJECTION IS NOT A DEAD END, AND THE PAGE MUST NOT READ LIKE ONE.
 *
 * Nearly every rejection is a blurred photo or a name that doesn't match DBPR
 * because the licence is held by a spouse or a business partner. The database
 * allows a fresh attempt — claims_one_pending_per_user_profile covers pending
 * rows only, so a rejected claimant can submit again immediately — and this
 * page is where they find that out.
 *
 * rejection_reason is shown verbatim when it exists. It is written by an admin
 * in the Supabase dashboard, so it is staff text, not user input.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const metadata: Metadata = {
  title: "Claim not approved · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

export default async function ClaimRejectedPage() {
  await requireUser("/claim/rejected");

  const db = createClient();
  const { data: claims } = await db
    .from("claims")
    .select("id, status, reviewed_at, rejection_reason, contractors(business_name, slug)")
    .order("created_at", { ascending: false });

  const rejected = claims?.find((c) => c.status === "rejected");
  const pending = claims?.find((c) => c.status === "pending");
  const approved = claims?.find((c) => c.status === "approved");

  const contractor = oneRelation<{ business_name: string | null; slug: string }>(
    rejected?.contractors,
  );
  const name = contractor?.business_name
    ? formatBusinessName(contractor.business_name)
    : "that profile";

  return (
    <>
      <Header statsTimestamp={DATA_AS_OF} />
      <main id="main" className="bg-paper">
        <div className="mx-auto max-w-[560px] px-6 py-20 max-[700px]:py-12">
          {!rejected ? (
            <>
              <h1 className="mb-4 font-serif text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
                Nothing was rejected.
              </h1>
              <p className="mb-8 text-[15px] leading-[1.65] text-gray-700">
                {approved
                  ? "Your claim was approved — your profile is live."
                  : pending
                    ? "Your claim is still with a reviewer. We'll email you when it's decided."
                    : "We don't have a rejected claim on your account."}
              </p>
              <Link
                href={approved ? "/claim/approved" : "/dashboard"}
                className="inline-block bg-navy px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper"
              >
                {approved ? "See your approved claim →" : "Go to your dashboard →"}
              </Link>
            </>
          ) : (
            <>
              <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-status-error">
                Claim not approved
              </p>
              <h1 className="mb-4 font-serif text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy max-[700px]:text-[27px]">
                We couldn&rsquo;t verify this one &mdash;{" "}
                <em className="not-italic text-gold">you can try again.</em>
              </h1>
              <p className="mb-6 text-[15px] leading-[1.65] text-gray-700">
                Your claim on <strong>{name}</strong> wasn&rsquo;t approved. This is
                usually a photo we couldn&rsquo;t read, or a name that doesn&rsquo;t
                match the qualifying agent DBPR has on file.
              </p>

              {rejected.rejection_reason && (
                <div className="mb-8 border-l-[3px] border-l-status-error bg-status-errorBg px-5 py-4">
                  <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-status-error">
                    What the reviewer said
                  </p>
                  <p className="text-note leading-[1.6] text-gray-700">
                    {rejected.rejection_reason}
                  </p>
                </div>
              )}

              <div className="mb-8 border-l-[3px] border-l-gold bg-gray-50 px-5 py-4">
                <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-navy">
                  If the license isn&rsquo;t in your name
                </p>
                <p className="text-note leading-[1.6] text-gray-700">
                  That&rsquo;s common &mdash; the qualifying agent is often a partner or
                  a spouse. Have that person claim it, or email us and we&rsquo;ll work
                  out the right route.
                </p>
              </div>

              {contractor?.slug && (
                <Link
                  href={`/contractor/${contractor.slug}/claim`}
                  className="inline-block bg-navy px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-light"
                >
                  Try again →
                </Link>
              )}
            </>
          )}
        </div>
      </main>
      <Footer lastSyncDate={DATA_AS_OF} />
    </>
  );
}
