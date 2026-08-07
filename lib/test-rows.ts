/**
 * Synthetic test rows — the prefix, and the filter that hides them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS. A VERIFY SUITE MUTATED A REAL BUSINESS'S LIVE LISTING.
 *
 * On 2026-08-07, GROSSI (CGC1531481) — a real Florida contractor — was found
 * with claim_tier = 'claimed' and claimed_by_user_id = NULL. It had been
 * rendering that way on the public site.
 *
 * The cause: scripts/verify-admin-claims.mjs picked two REAL contractors rows
 * with `.is("claimed_by_user_id", null).limit(2)`, approved a fabricated claim
 * against one of them, and then cleaned up by nulling the owner — but not
 * claim_tier, which approve_claim() had begun setting on 2026-08-03. The row was
 * left in a state no code path can produce, on a live site, for a real business.
 *
 * The invariant check in verify-claim-approval.mjs caught the residue. Nothing
 * caught the mutation itself, because a suite writing to production data was
 * never treated as the defect — and any of these suites crashing between the
 * write and its cleanup leaves the same damage.
 *
 * SO NO SUITE MAY TOUCH A ROW IT DID NOT CREATE. Mutating suites now insert
 * their own contractors rows keyed with TEST_ROW_PREFIX and delete them in
 * cleanup.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ THE PREFIX IS ONLY HALF THE PROTECTION. Cleanup runs in a `finally`, which
 * does not survive a killed process, a machine losing power, or an exception
 * inside the cleanup itself. So the public read paths ALSO exclude these rows —
 * a leaked synthetic row is then invisible rather than a fake business in the
 * directory. Belt and braces, because the belt is a `finally` block.
 */

/**
 * Every synthetic contractors row starts with this.
 *
 * ZZ so it sorts last in any ad-hoc query, and it cannot collide with a DBPR
 * sync key — those are derived from the licence number and the extract's own
 * identifiers, none of which begin with letters.
 */
export const TEST_ROW_PREFIX = "ZZTEST_";

/**
 * The LIKE pattern used to exclude them.
 *
 * ⚠ DELIBERATELY "ZZTEST%" AND NOT "ZZTEST\_%". `_` is a single-character
 * wildcard in LIKE, so the literal prefix would need escaping, and escaping
 * inside a PostgREST query string is the kind of detail that silently stops
 * working. Widening the pattern to the unambiguous "ZZTEST%" costs nothing:
 * no real DBPR record begins with those six characters, so the only rows it can
 * ever match are the ones this file exists to hide.
 */
export const TEST_ROW_LIKE = "ZZTEST%";

/**
 * Hide synthetic rows from a contractors query.
 *
 * Applied to the three paths that can put a contractors row in front of the
 * public: the sitemap, search, and the browse lists. Profile pages are NOT
 * filtered — /contractor/[slug] looks a row up by slug, and a synthetic row has
 * no slug, so it 404s on its own.
 *
 * Typed loosely on purpose. The three call sites hold PostgREST builders at
 * different stages with different row generics, and pinning that type here would
 * mean three casts at the call sites instead of one here.
 */
export function excludeTestRows<T>(query: T): T {
  return (query as { not: (c: string, o: string, v: string) => T }).not(
    "dbpr_sync_key",
    "like",
    TEST_ROW_LIKE,
  );
}
