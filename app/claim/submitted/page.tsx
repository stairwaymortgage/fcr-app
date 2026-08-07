import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { oneRelation } from "@/lib/claims";
import { dataAsOf } from "@/lib/data-as-of";
import { createClient } from "@/lib/supabase/server";

/**
 * Claim received — /claim/submitted
 *
 * Where submitClaim() lands. Separate from /claim/approved because nothing has
 * been approved yet, and a page that congratulates someone on a claim a human
 * has not looked at teaches them the review is a formality.
 */

export const metadata: Metadata = {
  title: "Claim submitted · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

export default async function ClaimSubmittedPage() {
  await requireUser("/claim/submitted");
  const asOf = await dataAsOf();

  /**
   * RLS returns this user's own claims only ("claimant reads own claim"), so
   * the most recent pending row is theirs by construction.
   */
  const db = createClient();
  const { data: claim } = await db
    .from("claims")
    .select("id, created_at, contractor_dbpr_sync_key, contractors(business_name, slug)")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const contractor = oneRelation<{ business_name: string | null; slug: string }>(
    claim?.contractors,
  );

  return (
    <>
      <Header statsTimestamp={asOf} />
      <main id="main" className="bg-paper">
        <div className="mx-auto max-w-[560px] px-6 py-20 max-[700px]:py-12">
          <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
            Claim received
          </p>
          <h1 className="mb-4 font-serif text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy max-[700px]:text-[27px]">
            We&rsquo;ve got it. Now a <em className="not-italic text-gold">person</em>{" "}
            checks it.
          </h1>
          <p className="mb-8 text-[15px] leading-[1.65] text-gray-700">
            {contractor?.business_name ? (
              <>
                Your claim on <strong>{contractor.business_name}</strong> is in the
                queue.{" "}
              </>
            ) : (
              <>Your claim is in the queue. </>
            )}
            We verify the name on your ID against public DBPR records by hand, which
            takes 24&ndash;48 hours. You&rsquo;ll get an email either way &mdash;
            there&rsquo;s nothing else for you to do.
          </p>

          <div className="mb-8 border-l-[3px] border-l-gold bg-gray-50 px-5 py-4">
            <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-navy">
              About your ID
            </p>
            <p className="text-note leading-[1.6] text-gray-700">
              It&rsquo;s stored privately, visible only to the reviewer, and never
              published, sold, or shared. We delete it 90 days after the decision.
            </p>
          </div>

          {contractor?.slug && (
            <Link
              href={`/contractor/${contractor.slug}`}
              className="inline-block bg-navy px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-deep"
            >
              View the profile →
            </Link>
          )}
        </div>
      </main>
      <Footer lastSyncDate={asOf} />
    </>
  );
}
