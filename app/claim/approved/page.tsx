import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { oneRelation } from "@/lib/claims";
import { formatBusinessName } from "@/lib/contractor-profile";
import { dataAsOf } from "@/lib/data-as-of";
import { createClient } from "@/lib/supabase/server";

/**
 * Claim approved — /claim/approved
 * Source: _handoff/02_mockups_production/05_auth/claim_approved.html
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STATUS IS READ FROM THE DATABASE, NOT FROM THE URL.
 *
 * This page is linked from an approval email, and a URL in an email is a URL
 * anyone can type. If it rendered "approved" simply because someone reached
 * /claim/approved, every contractor could show themselves a page saying their
 * claim went through — and would then report a bug when the badge never
 * appeared.
 *
 * So the row is fetched under RLS, which returns this user's own claims only,
 * and a visitor with no approved claim is told where they actually stand.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const metadata: Metadata = {
  title: "Claim approved · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

export default async function ClaimApprovedPage() {
  const user = await requireUser("/claim/approved");
  const asOf = await dataAsOf();

  const db = createClient();
  const { data: claims } = await db
    .from("claims")
    .select(
      "id, status, reviewed_at, contractor_dbpr_sync_key, contractors(business_name, slug, license_number, city)",
    )
    .order("created_at", { ascending: false });

  const approved = claims?.find((c) => c.status === "approved");
  const pending = claims?.find((c) => c.status === "pending");

  if (!approved) {
    return (
      <Shell heading="No approved claim yet." asOf={asOf}>
        {pending ? (
          <>
            Your claim is still with a reviewer. Manual review takes 24&ndash;48 hours
            and we&rsquo;ll email you the moment it&rsquo;s decided.
          </>
        ) : (
          <>
            We don&rsquo;t have an approved claim on your account. If you were expecting
            one, check the email we sent you &mdash; it will say what we need.
          </>
        )}
      </Shell>
    );
  }

  const contractor = oneRelation<{
    business_name: string | null;
    slug: string;
    license_number: string | null;
    city: string | null;
  }>(approved.contractors);
  const name = contractor?.business_name
    ? formatBusinessName(contractor.business_name)
    : "your business";
  const firstName = (user.user_metadata?.full_name as string | undefined)?.split(" ")[0];

  return (
    <>
      <Header statsTimestamp={asOf} />
      <main id="main" className="bg-paper">
        <div className="mx-auto max-w-[720px] px-6 py-16 max-[700px]:py-10">
          <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-status-success">
            Your claim was approved
          </p>
          <h1 className="mb-4 font-serif text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy max-[700px]:text-[27px]">
            Welcome{firstName ? `, ${firstName}` : ""}.{" "}
            <em className="not-italic text-gold">{name}</em> is yours.
          </h1>
          <p className="mb-8 text-[15px] leading-[1.65] text-gray-700">
            Your profile is now under your control. Visitors who land on it will see
            whatever you decide to put there, and your verified badge is live.
          </p>

          <div className="mb-10 border border-gray-200 bg-paper-raised px-6 py-5">
            <p className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
              Your profile
            </p>
            <p className="mt-1 text-[17px] font-semibold text-navy">{name}</p>
            <p className="mt-0.5 font-mono text-note text-gray-600">
              {contractor?.license_number ?? "—"}
              {contractor?.city ? ` · ${contractor.city}, FL` : ""}
            </p>
            {contractor?.slug && (
              <Link
                href={`/contractor/${contractor.slug}`}
                className="mt-3 inline-block font-mono text-label uppercase tracking-label text-gold"
              >
                View live profile →
              </Link>
            )}
          </div>

          <h2 className="mb-4 font-serif text-[24px] font-semibold text-navy">
            Three things worth doing right now
          </h2>
          <ol className="mb-10 flex flex-col gap-5">
            <Step n="01" title="Add your about text">
              Two or three paragraphs about what makes {name} different. Homeowners
              landing on your profile want to know who you are, not just what license
              you hold.
            </Step>
            <Step n="02" title="Add your contact info">
              Business phone, email and website. Without them your profile is a dead
              end &mdash; inquiries can&rsquo;t reach you.
            </Step>
            <Step n="03" title="Upload a business logo">
              A logo or owner photo makes your profile look claimed. PNG or JPG, at
              least 400×400px.
            </Step>
          </ol>

          <Link
            href="/dashboard"
            className="inline-block bg-navy px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-deep"
          >
            Open your dashboard →
          </Link>

          {/*
            Stage 2 of contractor_claim_flow.html — the $199/mo ranking-website
            upsell — belongs here rather than on the claim form, because the
            mockup labels it "Shown After Approval". Deliberately NOT built yet:
            it is a paid referral to an outside partner and carries its own
            disclosure requirements. Building it as decoration on this page would
            put a price in front of contractors before anyone has agreed the
            terms of the referral.
          */}
        </div>
      </main>
      <Footer lastSyncDate={asOf} />
    </>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="border-l-[3px] border-l-gold bg-gray-50 px-5 py-4">
      <p className="mb-1 font-mono text-micro font-semibold uppercase tracking-label text-gold">
        Step {n}
      </p>
      <p className="mb-1 text-[16px] font-semibold text-navy">{title}</p>
      <p className="text-note leading-[1.6] text-gray-700">{children}</p>
    </li>
  );
}

/**
 * `asOf` arrives as a prop rather than being awaited here, so the page makes
 * one call for both branches. See lib/data-as-of.ts.
 */
function Shell({
  heading,
  asOf,
  children,
}: {
  heading: string;
  asOf: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Header statsTimestamp={asOf} />
      <main id="main" className="bg-paper">
        <div className="mx-auto max-w-[560px] px-6 py-20 max-[700px]:py-12">
          <h1 className="mb-4 font-serif text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
            {heading}
          </h1>
          <p className="mb-8 text-[15px] leading-[1.65] text-gray-700">{children}</p>
          <Link
            href="/dashboard"
            className="inline-block bg-navy px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper"
          >
            Go to your dashboard →
          </Link>
        </div>
      </main>
      <Footer lastSyncDate={asOf} />
    </>
  );
}
