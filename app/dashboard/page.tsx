import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { isAdmin, requireUser } from "@/lib/auth";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { dataAsOf } from "@/lib/data-as-of";

/**
 * Contractor dashboard — /dashboard
 *
 * PLACEHOLDER. Step 1 is auth only; the real portal (profile editor, inquiries
 * inbox) is Week 5b. This page exists so the guard has something to guard, and
 * so signing in ends somewhere that proves it worked.
 *
 * requireUser() HERE AS WELL AS IN THE MIDDLEWARE, ON PURPOSE. The middleware
 * is a redirect for humans, not a security boundary: it does not run for Server
 * Actions, and a matcher edit disables it silently across every route at once.
 * This call is the check that actually belongs to this page.
 */

export const metadata: Metadata = {
  title: "Dashboard · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { released?: string };
}) {
  const user = await requireUser("/dashboard");
  const admin = isAdmin(user);
  const asOf = await dataAsOf();

  /**
   * Where /manage/[slug]/settings sends a contractor after they release a
   * profile — they cannot be sent back to the editor, which now 404s for them.
   *
   * The slug is rendered rather than looked up: after the release this user has
   * no link to that row, so a query would return nothing. It is shape-checked
   * because it arrives in the URL and is printed into the page.
   */
  const released =
    searchParams.released && /^[a-z0-9-]{1,200}$/.test(searchParams.released)
      ? searchParams.released
      : null;

  return (
    <>
      <Header statsTimestamp={asOf} />
      <main id="main" className="bg-paper">
        <div className="mx-auto max-w-[720px] px-6 py-16 max-[700px]:py-10">
          <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
            Signed in
          </p>
          <h1 className="mb-4 font-serif text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy max-[700px]:text-[27px]">
            Your <em className="not-italic text-gold">dashboard.</em>
          </h1>
          <p className="mb-8 text-[15px] leading-[1.65] text-gray-700">
            You&rsquo;re signed in as{" "}
            <strong className="font-semibold text-navy">{user.email}</strong>.
          </p>

          {released && (
            <div
              role="status"
              className="mb-8 border-l-[3px] border-l-status-success bg-status-successBg px-5 py-4"
            >
              <p className="mb-1.5 font-mono text-label font-semibold uppercase tracking-label text-status-success">
                Profile released
              </p>
              <p className="text-note leading-[1.6] text-gray-700">
                You no longer manage that listing, and your logo has been
                deleted. Your About text and contact details are kept but hidden
                &mdash; claiming it again restores them, though it needs a fresh
                ID check.{" "}
                <Link
                  href={`/contractor/${released}`}
                  className="text-navy underline decoration-gold underline-offset-2"
                >
                  See how it looks now
                </Link>
                .
              </p>
            </div>
          )}

          <div className="border border-gray-200 bg-paper-raised px-6 py-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-note">
              <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
                Account
              </dt>
              <dd className="text-gray-700">{user.email}</dd>
              <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
                Role
              </dt>
              <dd className="text-gray-700">{admin ? "Admin" : "Contractor"}</dd>
            </dl>
          </div>

          {/* The copy that used to live here said claiming, editing and the
              inquiries inbox "are being built. Nothing here yet." All three
              shipped in tasks 145-147, and this is where a contractor lands
              after releasing a profile — so it was both stale and the first
              thing they would read. */}
          <div className="mt-8 border-l-[3px] border-l-gold bg-gray-50 px-5 py-4">
            <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-navy">
              Your portal
            </p>
            <p className="text-note leading-[1.6] text-gray-700">
              Once a profile is verified as yours you can edit your listing,
              upload a logo, and read homeowner inquiries. Find your business on{" "}
              <Link href="/search" className="text-navy underline decoration-gold underline-offset-2">
                the contractor search
              </Link>{" "}
              to claim it.
            </p>
          </div>

          <div className="mt-8 flex items-center gap-6">
            {/* /admin/claims directly rather than /admin. The index route now
                exists and redirects here, so both work — but linking to the
                destination skips a round trip, and this link is the one that
                was reported as a 404. */}
            {admin && (
              <Link href="/admin/claims" className="text-note font-medium text-navy underline">
                Admin
              </Link>
            )}
            {/*
              POST, not a link. A GET sign-out can be fired by any image tag on
              any site — harmless-looking CSRF that logs people out mid-task.
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
      </main>
      <Footer lastSyncDate={asOf} />
    </>
  );
}
