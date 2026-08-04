import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ContractorHeader from "@/components/ContractorHeader";
import { requireUser } from "@/lib/auth";
import {
  formatBusinessName,
  formatPersonName,
  getContractorBySlug,
  type ContractorProfile,
} from "@/lib/contractor-profile";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { logoInitial, logoPublicUrl } from "@/lib/logo";
import { createClient } from "@/lib/supabase/server";

import LogoUploader from "./LogoUploader";
import ProfileForm from "./ProfileForm";

/**
 * Profile editor — /manage/[slug]
 * Source: _handoff/02_mockups_production/04_contractor_facing/manage_profile.html
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A NON-OWNER GETS 404, NOT 403.
 *
 * Same rule as /admin/claims, for the same reason. 403 confirms that this slug
 * has an editor and that somebody owns it; 404 is the answer a path that was
 * never a route gives. The contractor list is public, so "does this profile
 * have an owner" is exactly the question this page must not answer.
 *
 * THREE LAYERS, and this is only the middle one. Middleware bounces signed-out
 * visitors from /manage/* but does not run for Server Actions. This check
 * decides whether to render. update_own_contractor_profile() repeats the
 * ownership test inside the database and is the one that actually refuses a
 * write. Removing any single layer must not open the door.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NO AUTOSAVE, AND THE PREVIEW IS STATIC — both by decision. The mockup shows
 * an action bar reading "All changes saved automatically" next to Discard and
 * Publish buttons, which are two contradictory models; explicit save is the one
 * every other form in this codebase uses. The mockup's preview pane is likewise
 * static markup with a pulsing dot suggesting otherwise.
 *
 * NOT BUILT, DELIBERATELY: the "Regenerate with AI" button (no AI integration
 * exists and no spec says what it would generate from), the $29 Featured toggle
 * (Stripe is week 6, and the promote trigger currently fires on any write to
 * stripe_subscription_id), and the $199 web-partner strip (a paid referral with
 * its own disclosure requirements, held for the same reason as the one on
 * /claim/approved).
 */

export const metadata: Metadata = {
  title: "Edit your profile · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

export default async function ManageProfilePage({
  params,
}: {
  params: { slug: string };
}) {
  const user = await requireUser(`/manage/${params.slug}`);

  const db = createClient();
  const contractor = await getContractorBySlug(db, params.slug);

  // Missing profile and someone else's profile are the same answer on purpose.
  if (!contractor || contractor.claimed_by_user_id !== user.id) notFound();

  const name = contractor.business_name
    ? formatBusinessName(contractor.business_name)
    : formatPersonName(contractor.qualifying_agent_name);

  /**
   * The nav badge, now that /inquiries exists (147).
   *
   * COUNTED ACROSS EVERY PROFILE THIS USER HAS CLAIMED, not just the one being
   * edited — the badge links to /inquiries, which is one flat inbox spanning all
   * of them, and a number that disagreed with the page it points at would be
   * worse than no number. Hence the join filter rather than an eq on this
   * profile's sync key.
   *
   * The ownership test is written out even though RLS already restricts these
   * rows to the same set: RLS filters rows, it does not stop this page asking
   * for a count over the whole table. Same reasoning as app/inquiries/page.tsx.
   *
   * A failed count is not an error page. The badge simply does not render.
   */
  const { count: unread, error: unreadError } = await db
    .from("inquiries")
    .select("id, contractors!inner(claimed_by_user_id)", {
      count: "exact",
      head: true,
    })
    .eq("contractors.claimed_by_user_id", user.id)
    .eq("status", "unread");

  if (unreadError) {
    console.error("[manage] unread inquiry count failed", unreadError.message);
  }

  /**
   * The header wants a name and initials rather than deriving them, because
   * derivation breaks on single-word names and suffixes. A passwordless session
   * may carry no full_name at all, so the email local part is the fallback —
   * never the whole address, which would put a contractor's login on screen
   * beside their public business name.
   */
  const displayName =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.email ?? "").split("@")[0] ||
    "Your account";

  return (
    <>
      <ContractorHeader
        currentPath={`/manage/${params.slug}`}
        contractorSlug={params.slug}
        userName={displayName}
        userInitials={initialsFor(displayName)}
        unreadInquiries={unread ?? 0}
      />

      <main id="main" className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-app px-8 py-10 max-[900px]:px-5">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="mb-1.5 font-serif text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
                Edit your <em className="italic">profile</em>
              </h1>
              <p className="text-note text-gray-600">
                {name}
                {contractor.license_number && (
                  <>
                    {" · "}
                    <strong className="font-medium text-gray-700">
                      {contractor.license_number}
                    </strong>
                  </>
                )}
                {contractor.city && ` · ${formatBusinessName(contractor.city)}, FL`}
              </p>
            </div>
            <Link
              href={`/contractor/${contractor.slug}`}
              className={`border border-gray-300 bg-white px-4 py-2.5 font-mono text-label uppercase tracking-label text-gray-700 transition-colors hover:border-navy hover:text-navy ${FOCUS_RING_PAPER}`}
            >
              View public profile →
            </Link>
          </div>

          {/* Two panes above 1200px, stacked below — matching the mockup's own
              breakpoint. The preview follows the editor in source order, so a
              screen reader and a narrow viewport both get edit-then-result. */}
          <div className="grid grid-cols-2 gap-6 max-[1200px]:grid-cols-1">
            <div className="flex flex-col gap-5">
              <LockedCard contractor={contractor} />

              {/* The mockup puts this section BETWEEN About and Contact
                  (manage_profile.html:756). ProfileForm holds both of those in
                  one form with one Save, so slotting a separate component into
                  its middle would mean splitting that form — and a second Save
                  button is a worse outcome than a different order. Placed above
                  it instead, where it reads as part of the same "how your
                  profile looks" group as the licence card. */}
              <LogoUploader
                dbprSyncKey={contractor.dbpr_sync_key}
                businessName={name}
                currentPath={contractor.custom_logo_path}
              />

              <ProfileForm
                saved={{
                  dbprSyncKey: contractor.dbpr_sync_key,
                  slug: contractor.slug,
                  about: contractor.custom_about_text ?? "",
                  website: contractor.custom_website_url ?? "",
                  email: contractor.custom_email ?? "",
                  phone: contractor.custom_phone ?? "",
                  serviceArea: contractor.custom_service_area ?? "",
                }}
              />
            </div>

            <Preview contractor={contractor} name={name} />
          </div>
        </div>
      </main>
    </>
  );
}

/** "Cristian Acero" -> "CA". One letter when there is only one word. */
function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

/**
 * The DBPR fields, display-only.
 *
 * THE LOCK IS NOT THIS CARD. Rendering these as text rather than inputs is a
 * courtesy to the contractor, not a control — the mockup labelled them "Locked ·
 * sourced from DBPR" and that lock was CSS until the write path became an RPC
 * with a five-column allowlist. What makes them unwritable is that
 * update_own_contractor_profile() cannot reach them and direct UPDATE is
 * revoked. See db/migrations/20260803_contractor_profile_lockdown.sql.
 */
function LockedCard({ contractor }: { contractor: ContractorProfile }) {
  const address = [
    contractor.address_line && formatBusinessName(contractor.address_line),
    contractor.city &&
      `${formatBusinessName(contractor.city)}, ${contractor.state} ${contractor.zip ?? ""}`.trim(),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
        <h2 className="font-mono text-label font-semibold uppercase tracking-label text-gold">
          Profile basics
        </h2>
        <span className="font-mono text-label uppercase tracking-label text-gray-500">
          Locked · sourced from DBPR
        </span>
      </div>
      <dl className="px-6 py-2">
        <LockedRow term="Business name">
          {contractor.business_name ? formatBusinessName(contractor.business_name) : "—"}
        </LockedRow>
        <LockedRow term="Qualifying agent">
          {formatPersonName(contractor.qualifying_agent_name)}
        </LockedRow>
        <LockedRow term="License #">
          <span className="font-mono text-[13px] font-semibold text-gold">
            {contractor.license_number ?? "—"}
          </span>
        </LockedRow>
        <LockedRow term="License type">{contractor.license_type}</LockedRow>
        <LockedRow term="Status">{contractor.license_status}</LockedRow>
        {address && <LockedRow term="Mailing address">{address}</LockedRow>}
      </dl>
      <p className="border-t border-gray-100 px-6 py-4 text-note leading-[1.6] text-gray-600">
        These come straight from the Florida DBPR and can&rsquo;t be edited here.
        To correct one, update your record with DBPR at{" "}
        <a
          href="https://www.myfloridalicense.com"
          rel="noopener noreferrer"
          target="_blank"
          className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
        >
          myfloridalicense.com
        </a>{" "}
        — it will reach us on the next weekly sync.
      </p>
    </section>
  );
}

function LockedRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-4 border-b border-gray-100 py-2.5 last:border-b-0 max-[520px]:grid-cols-1 max-[520px]:gap-1">
      <dt className="font-mono text-label font-medium uppercase tracking-[0.06em] text-gray-500">
        {term}
      </dt>
      <dd className="text-[14px] font-medium text-gray-700">{children}</dd>
    </div>
  );
}

/**
 * What the public profile currently shows.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "AS PUBLISHED", NOT "LIVE PREVIEW".
 *
 * The mockup calls this pane a live preview and gives it a pulsing dot. It is
 * neither, by decision: it renders SAVED state and does not follow the fields
 * on the left. Labelling it "live" would be a promise the pane does not keep,
 * and the contractor most likely to be misled is the one who edits, glances
 * right, sees no change, and concludes the editor is broken.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Presentation follows /contractor/[slug]: About splits on newlines into
 * paragraphs, contact rows appear only when their column is set, and the
 * website is displayed without its scheme.
 */
function Preview({
  contractor,
  name,
}: {
  contractor: ContractorProfile;
  name: string;
}) {
  const previewLogoUrl = logoPublicUrl(contractor.custom_logo_path);

  const paragraphs = (contractor.custom_about_text ?? "")
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

  const contact = [
    contractor.custom_website_url && {
      term: "Website",
      value: contractor.custom_website_url.replace(/^https?:\/\//, ""),
    },
    contractor.custom_email && { term: "Email", value: contractor.custom_email },
    contractor.custom_phone && { term: "Phone", value: contractor.custom_phone },
    contractor.custom_service_area && {
      term: "Service area",
      value: contractor.custom_service_area,
    },
  ].filter(Boolean) as { term: string; value: string }[];

  return (
    <aside className="flex flex-col gap-3 self-start max-[1200px]:static sticky top-8">
      <div className="flex items-center justify-between gap-4 px-1">
        <h2 className="font-mono text-label font-semibold uppercase tracking-label text-gold">
          As published
        </h2>
        <span className="font-mono text-label text-gray-500">Saved state</span>
      </div>

      <div className="max-h-[calc(100vh-160px)] overflow-y-auto border border-gray-300 bg-paper max-[1200px]:max-h-none">
        <div className="border-b border-gray-200 bg-paper px-7 py-8">
          {/* 90x90 beside the name, matching .mini-profile-logo in the mockup
              (manage_profile.html:496-514). Shown even with no logo, because
              here the placeholder is doing a job — it is what the section above
              is offering to replace. The public profile makes the opposite
              call and renders nothing. */}
          <div className="mb-4 flex items-start gap-[22px]">
            <div className="relative h-[90px] w-[90px] shrink-0 bg-gradient-to-br from-navy to-navy-deep">
              {previewLogoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element --
                   Same reason as the uploader's: no second cache in front of an
                   image the contractor expects to be able to replace. */
                <img
                  src={previewLogoUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-full w-full items-center justify-center font-serif text-4xl font-bold italic text-gold"
                >
                  {logoInitial(name)}
                </span>
              )}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-1 border border-gold"
              />
            </div>

            <div>
              <p className="mb-2 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
                Verified contractor
              </p>
              <h3 className="font-serif text-[24px] font-semibold leading-[1.15] tracking-[-0.015em] text-navy">
                {name}
              </h3>
            </div>
          </div>
          <p className="mb-2 text-note text-gray-700">
            {formatPersonName(contractor.qualifying_agent_name)}, Qualifying Agent
            {contractor.city && ` · ${formatBusinessName(contractor.city)}, FL`}
          </p>
          <p className="font-mono text-note font-semibold text-gold">
            {contractor.license_number ?? "—"} · {contractor.license_type}
          </p>
        </div>

        <div className="px-7 py-6">
          <h4 className="mb-2.5 font-mono text-micro font-semibold uppercase tracking-label text-gray-500">
            About
          </h4>
          {paragraphs.length > 0 ? (
            <div className="mb-6 text-note leading-[1.65] text-gray-700">
              {paragraphs.map((para, i) => (
                <p key={i} className="mb-3 last:mb-0">
                  {para}
                </p>
              ))}
            </div>
          ) : (
            <p className="mb-6 text-note leading-[1.65] text-gray-500">
              Nothing yet. What you write on the left appears here once saved —
              until then your profile shows the generated description built from
              the DBPR record.
            </p>
          )}

          <h4 className="mb-2.5 font-mono text-micro font-semibold uppercase tracking-label text-gray-500">
            Contact
          </h4>
          {contact.length > 0 ? (
            <dl>
              {contact.map(({ term, value }) => (
                <div
                  key={term}
                  className="grid grid-cols-[90px_1fr] gap-3 border-b border-gray-100 py-2.5 text-note last:border-b-0"
                >
                  <dt className="font-mono text-label font-medium uppercase tracking-[0.06em] text-gray-500">
                    {term}
                  </dt>
                  <dd className="font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-note leading-[1.65] text-gray-500">
              No contact details published yet — homeowners have no way to reach
              you directly.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
