import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import ContractorHeader from "@/components/ContractorHeader";
import SubmitButton from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import {
  formatBusinessName,
  formatPersonName,
  getContractorBySlug,
} from "@/lib/contractor-profile";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { createClient } from "@/lib/supabase/server";

import { releaseProfile } from "./actions";

/**
 * Contractor settings — /manage/[slug]/settings
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THERE IS NO MOCKUP FOR THIS PAGE. THAT IS WHY IT IS SHORT.
 *
 * All 28 production mockups were searched on 2026-08-04. The only settings file
 * in the handoff is 08_admin/admin_settings.html, which is JIM'S: DBPR sync
 * cadence, integrations, team members, purge-all-leads. Its account section
 * offers a password field and a two-factor toggle, and this product has
 * neither — sign-in is a one-time emailed code.
 *
 * So this page borrows that file's SHELL (numbered sections, serif italic
 * titles, a red danger zone) and none of its content. Everything it shows is
 * something the schema or a shipped feature actually supports. Same rule the
 * portfolio gallery was cut under.
 *
 * NOT BUILT, EACH FOR A STATED REASON:
 *
 *   · Notification toggles. See section 02 — there is nothing optional to
 *     toggle, and a switch that changes nothing is worse than no switch.
 *   · Change your sign-in email. An auth-level operation and an account-takeover
 *     surface; it needs a confirm-both-addresses flow that does not exist.
 *   · Password / two-factor. This app has no passwords.
 *   · Delete my account. claims.claimant_user_id is ON DELETE CASCADE, so
 *     deleting the auth user destroys the verification record for every claim
 *     that user ever made. It stays a support request until there is a design
 *     that preserves the audit trail.
 *   · Anything billing. Stripe is week 6.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A NON-OWNER GETS 404, NOT 403 — the same rule as /manage/[slug], for the same
 * reason: the contractor list is public, so "does this profile have an owner"
 * is exactly the question this page must not answer.
 */

export const metadata: Metadata = {
  title: "Settings · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

/** ?e= codes set by ./actions.ts. Never a raw Postgres message. */
const ERROR_TEXT: Record<string, string> = {
  confirm:
    "That didn’t match, so nothing was released. Check the text below and type it exactly as shown.",
  notyours: "You no longer manage that profile.",
  gone: "That profile no longer exists.",
  failed: "Something went wrong on our side. Nothing was released — try again.",
};

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { e?: string };
}) {
  const user = await requireUser(`/manage/${params.slug}/settings`);

  const db = createClient();
  const contractor = await getContractorBySlug(db, params.slug);

  // Missing profile and someone else's profile are the same answer on purpose.
  if (!contractor || contractor.claimed_by_user_id !== user.id) notFound();

  const name = contractor.business_name
    ? formatBusinessName(contractor.business_name)
    : formatPersonName(contractor.qualifying_agent_name);

  /**
   * Every profile this user manages, because a contractor can hold several
   * licences — the qualifying agent behind Aceca holds three — and the portal's
   * other pages are slug-scoped. This is the only place that says out loud how
   * many there are.
   */
  const { data: ownedData, error: ownedError } = await db
    .from("contractors")
    .select("slug, business_name, qualifying_agent_name, license_number, city")
    .eq("claimed_by_user_id", user.id)
    .order("claimed_at", { ascending: true });

  if (ownedError) {
    console.error("[settings] could not load managed profiles", ownedError.message);
  }

  const owned = (ownedData ?? []) as {
    slug: string;
    business_name: string | null;
    qualifying_agent_name: string;
    license_number: string | null;
    city: string | null;
  }[];

  /**
   * The unread badge, counted across every claimed profile — the same query
   * /manage/[slug] runs, and for the same reason: the badge links to one flat
   * inbox spanning all of them.
   */
  const { count: unread } = await db
    .from("inquiries")
    .select("id, contractors!inner(claimed_by_user_id)", { count: "exact", head: true })
    .eq("contractors.claimed_by_user_id", user.id)
    .eq("status", "unread");

  /**
   * What must be typed to release.
   *
   * The licence number when there is one — short, unambiguous, and printed two
   * lines above the box. Some rows genuinely have none: a QB (qualifying
   * business) record carries the business name and an empty licence field, and
   * those profiles are claimable like any other. Falling back to the display
   * name keeps the confirmation possible for them rather than shipping a button
   * nobody can complete.
   */
  const confirmPhrase = contractor.license_number?.trim() || name;

  const displayName =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.email ?? "").split("@")[0] ||
    "Your account";

  return (
    <>
      <ContractorHeader
        currentPath={`/manage/${params.slug}/settings`}
        contractorSlug={params.slug}
        userName={displayName}
        userEmail={user.email}
        userInitials={initialsFor(displayName)}
        unreadInquiries={unread ?? 0}
      />

      <main id="main" className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-[860px] px-8 py-10 max-[900px]:px-5">
          <div className="mb-8">
            <h1 className="mb-1.5 font-serif text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
              Settings
            </h1>
            <p className="text-note text-gray-500">
              {name}
              {contractor.license_number && (
                <>
                  {" · "}
                  <strong className="font-medium text-gray-700">
                    {contractor.license_number}
                  </strong>
                </>
              )}
            </p>
          </div>

          {searchParams.e && ERROR_TEXT[searchParams.e] && (
            <p
              role="alert"
              className="mb-6 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note text-status-error"
            >
              {ERROR_TEXT[searchParams.e]}
            </p>
          )}

          <Section
            num="01 · Account"
            title={
              <>
                Your <em className="italic">account.</em>
              </>
            }
            desc="How you sign in, and what you manage."
          >
            <Row label="Sign-in email">
              <p className="text-[14.5px] font-medium text-ink">{user.email}</p>
              <p className="mt-1 text-note leading-[1.55] text-gray-500">
                Changing this isn&rsquo;t self-service yet &mdash;{" "}
                <a
                  href="mailto:support@floridacontractorregistry.com"
                  className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
                >
                  email us
                </a>{" "}
                and we&rsquo;ll move your profiles across.
              </p>
            </Row>

            <Row label="Password">
              {/* Answering the question before it is asked. Every other portal
                  this contractor has used has a password field here, and its
                  absence reads as a missing feature unless the page says why. */}
              <p className="text-note leading-[1.6] text-gray-700">
                There isn&rsquo;t one. We email you a six-digit code each time you
                sign in, so there is no password to choose, forget, or reuse.
              </p>
            </Row>

            <Row label={owned.length > 1 ? `Profiles you manage (${owned.length})` : "Profile you manage"}>
              <ul className="flex flex-col gap-2">
                {owned.map((p) => {
                  const label = p.business_name
                    ? formatBusinessName(p.business_name)
                    : formatPersonName(p.qualifying_agent_name);
                  return (
                    <li key={p.slug} className="text-[14.5px]">
                      <Link
                        href={`/manage/${p.slug}`}
                        className={`font-medium text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
                      >
                        {label}
                      </Link>
                      {(p.license_number || p.city) && (
                        <span className="ml-2 font-mono text-label uppercase tracking-label text-gray-500">
                          {[p.license_number, p.city && formatBusinessName(p.city)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                      {p.slug === params.slug && (
                        <span className="ml-2 font-mono text-label uppercase tracking-label text-gold">
                          You&rsquo;re here
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {owned.length > 1 && (
                <p className="mt-2 text-note leading-[1.55] text-gray-500">
                  Each licence is its own profile with its own page and its own
                  logo. Inquiries from all of them arrive in one inbox.
                </p>
              )}
            </Row>

            {/* Sign-out moved to ContractorHeader on 2026-08-06, where it is
                reachable from all three portal pages. It lived here alone, so a
                contractor on their profile editor or inquiries inbox had to
                navigate here first to find it. */}
          </Section>

          <Section
            num="02 · Email"
            title={
              <>
                What we <em className="italic">send you.</em>
              </>
            }
            desc="All of it, and there is less than you might expect."
          >
            {/*
              NO TOGGLES, AND THAT IS THE HONEST ANSWER RATHER THAN AN OMISSION.
              This app sends contractors exactly two kinds of mail and both are
              transactional: the decision on a claim they submitted, and the code
              that signs them in. Neither can be switched off — one is the answer
              to a question they asked, the other IS the login.

              An unsubscribe control over those would imply we send things we do
              not, and if anyone ticked it the honest implementation would keep
              sending both. A preference that changes nothing is a lie stored in
              a column, which is why there is no column.

              THE FIRST GENUINELY OPTIONAL EMAIL WILL BE INQUIRY NOTIFICATIONS,
              and they do not exist yet — submitInquiry() writes the row and
              stops, so a contractor learns about an inquiry by signing in. When
              that ships it needs a preference column and this section grows its
              first switch.
            */}
            <Row label="Claim decisions">
              <p className="text-note leading-[1.6] text-gray-700">
                One email when a profile claim is approved or turned down. Sent
                once per claim.
              </p>
            </Row>
            <Row label="Sign-in codes">
              <p className="text-note leading-[1.6] text-gray-700">
                The six-digit code, each time you sign in.
              </p>
            </Row>
            <Row label="Everything else">
              <p className="text-note leading-[1.6] text-gray-700">
                Nothing. No newsletters, no digests, no marketing &mdash; so there
                is nothing here to switch off. New homeowner inquiries appear in{" "}
                <Link
                  href="/inquiries"
                  className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
                >
                  your inbox
                </Link>
                ; we don&rsquo;t email them to you yet.
              </p>
            </Row>
          </Section>

          <Section
            danger
            num="03 · Danger zone"
            title={
              <>
                Release this <em className="italic">profile.</em>
              </>
            }
            desc="Hands the listing back. Not reversible without verifying your identity again."
          >
            <div className="flex flex-col gap-4">
              <div className="text-note leading-[1.65] text-gray-700">
                <p className="mb-2">Releasing <strong className="font-semibold text-ink">{name}</strong> immediately:</p>
                <ul className="ml-4 flex list-disc flex-col gap-1">
                  <li>unlinks it from your account, so the public page shows the
                      unclaimed state again;</li>
                  <li>hides your About text and public contact details;</li>
                  <li>deletes your uploaded logo &mdash; the file, not just the link;</li>
                  <li>frees the profile for someone else to claim.</li>
                </ul>
                <p className="mt-3">
                  Your About text and contact details are kept but hidden, so
                  re-claiming restores them. Getting it back means submitting a
                  new photo of your ID and waiting for a person to review it.
                </p>
                {/* Said plainly because "release" and "delete my data" are
                    different requests and conflating them would be the kind of
                    thing someone discovers at the worst moment. */}
                <p className="mt-3 text-gray-500">
                  This isn&rsquo;t a data-deletion request. If you want what
                  you&rsquo;ve written erased rather than hidden,{" "}
                  <a
                    href="mailto:support@floridacontractorregistry.com"
                    className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
                  >
                    email us
                  </a>{" "}
                  and say so.
                </p>
              </div>

              {/* A plain form. No client JS, no confirm() dialog — the typed
                  phrase IS the confirmation step, and it survives with
                  JavaScript disabled. */}
              <form action={releaseProfile} className="border-t border-gray-200 pt-4">
                <input type="hidden" name="slug" value={params.slug} />
                <input type="hidden" name="dbpr_sync_key" value={contractor.dbpr_sync_key} />
                <input type="hidden" name="confirm_expected" value={confirmPhrase} />

                <label
                  htmlFor="release-confirm"
                  className="mb-1.5 block font-mono text-label font-medium uppercase tracking-label text-gray-500"
                >
                  Type{" "}
                  <span className="text-status-error">{confirmPhrase}</span>{" "}
                  to confirm
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="release-confirm"
                    name="confirm"
                    type="text"
                    autoComplete="off"
                    maxLength={200}
                    className={`w-[280px] max-w-full border border-gray-300 bg-white px-3 py-2.5 text-note text-ink ${FOCUS_RING_PAPER}`}
                  />
                  <SubmitButton
                    pendingLabel="Releasing…"
                    className={`border border-status-error bg-white px-5 py-2.5 font-mono text-label font-semibold uppercase tracking-label text-status-error transition-colors hover:bg-status-errorBg ${FOCUS_RING_PAPER}`}
                  >
                    Release this profile
                  </SubmitButton>
                </div>
              </form>
            </div>
          </Section>
        </div>
      </main>
    </>
  );
}

/** "Cristian Acero" -> "CA". Same helper as the other portal pages. */
function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

/**
 * One numbered settings card.
 * Source: _handoff/02_mockups_production/08_admin/admin_settings.html:133-190,
 * with the danger variant from :411-416 (red border-left 3px, red num, red
 * title). The shell is reused; none of that file's contractor-irrelevant
 * content is.
 */
function Section({
  num,
  title,
  desc,
  danger = false,
  children,
}: {
  num: string;
  title: ReactNode;
  desc: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`mb-6 border bg-white ${
        danger ? "border-l-[3px] border-status-error" : "border-gray-200"
      }`}
    >
      <div className="border-b border-gray-200 px-7 py-5 max-[700px]:px-5">
        <p
          className={`mb-1.5 font-mono text-label font-semibold uppercase tracking-eyebrow ${
            danger ? "text-status-error" : "text-gold"
          }`}
        >
          {num}
        </p>
        <h2
          className={`mb-1.5 font-serif text-[22px] font-semibold leading-[1.3] tracking-[-0.015em] ${
            danger ? "text-status-error" : "text-navy"
          }`}
        >
          {title}
        </h2>
        <p className="text-note leading-[1.55] text-gray-500">{desc}</p>
      </div>
      <div className="px-7 py-5 max-[700px]:px-5">{children}</div>
    </section>
  );
}

/** A labelled row inside a section. 200px label column, per .form-row. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-6 border-b border-gray-100 py-3.5 last:border-b-0 max-[700px]:grid-cols-1 max-[700px]:gap-2">
      <p className="font-mono text-label font-medium uppercase tracking-label text-gray-500">
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}
