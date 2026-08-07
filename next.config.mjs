/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * /contractors -> /join, PERMANENT (308).
   *
   * app/contractors/page.tsx was deleted on 2026-08-07. It said "Claiming opens
   * soon" and had done since before the claim flow shipped, while being linked
   * from the header, the footer, the homepage and three content pages — so the
   * most prominent contractor CTA on the site pointed at a page telling them to
   * come back later. /join is what it should have been.
   *
   * REDIRECTED RATHER THAN 404ed, because that URL is not only ours to break:
   * it is in the sitemap Google has already crawled, and it is the target of
   * every external link anyone has made to "the contractor page". A 404 would
   * throw away whatever ranking it has and land real contractors on an error.
   *
   * WHY HERE AND NOT A ROUTE HANDLER. This runs before rendering and before
   * middleware's own work, costs no function invocation on Vercel, and — the
   * part that matters — leaves no app/contractors directory behind. A
   * route.ts that only redirects is a file someone later "fixes" by putting a
   * page back in it, which is how the stale page survived as long as it did.
   *
   * PERMANENT IS THE RIGHT CALL AND IS HARD TO UNDO. A 308 is cached by
   * browsers indefinitely, so if /contractors is ever wanted as a real page
   * again, testers who visited it once will keep landing on /join until they
   * clear their cache. That is accepted: this move is not provisional.
   *
   * The internal links were repointed at the same time — this redirect exists
   * for external traffic and for anything missed, not as the mechanism.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async redirects() {
    return [
      {
        source: "/contractors",
        destination: "/join",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
