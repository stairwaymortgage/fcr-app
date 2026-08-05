import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { dataAsOf } from "@/lib/data-as-of";

/**
 * Sign-in link problem — /auth/error
 *
 * A magic link that fails is nearly always one of three ordinary things, and
 * every one of them is fixed by requesting another link. The reasons are
 * distinguished only to say something true rather than something generic —
 * none of them reveals whether an account exists.
 */

export const metadata: Metadata = {
  title: "Sign-in link problem · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

const REASONS: Record<string, { heading: string; body: string }> = {
  used: {
    heading: "That link has already been used.",
    body: "Sign-in links work once. If you clicked it before, or your email app previewed it, it's already spent. Request a new one and it'll work.",
  },
  link: {
    heading: "That link didn't work.",
    body: "It may have expired — links are short-lived on purpose. Requesting a new one takes a few seconds.",
  },
  missing: {
    heading: "Something was missing from that link.",
    body: "It may have been cut in half by your email app, which happens with long links. Request a new one, and try clicking rather than copying.",
  },
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: { reason?: string };
}) {
  const reason = REASONS[searchParams.reason ?? ""] ?? REASONS.link;
  const asOf = await dataAsOf();

  return (
    <>
      <Header statsTimestamp={asOf} />
      <main id="main" className="bg-paper">
        <div className="mx-auto max-w-[520px] px-6 py-20 max-[700px]:py-12">
          <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-status-error">
            Sign-in
          </p>
          <h1 className="mb-4 font-serif text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy max-[700px]:text-[27px]">
            {reason.heading}
          </h1>
          <p className="mb-8 text-[15px] leading-[1.65] text-gray-700">{reason.body}</p>
          <Link
            href="/login"
            className="inline-block bg-navy px-6 py-3.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-light"
          >
            Request a new link →
          </Link>
        </div>
      </main>
      <Footer lastSyncDate={asOf} />
    </>
  );
}
