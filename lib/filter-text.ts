/**
 * Search input destined for a PostgREST `.or()` filter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS AN ALLOWLIST, NOT AN ESCAPE FUNCTION, AND THE DIFFERENCE MATTERS.
 *
 * `.or()` takes a STRING GRAMMAR, not a value: commas separate the filters,
 * parentheses group them, and dots separate column from operator from value.
 * So a raw query string is syntax — `a,b` silently becomes two filters, and an
 * unbalanced paren makes the whole request 400.
 *
 * Characters outside the allowlist are DROPPED rather than encoded, because
 * there is no encoding PostgREST would decode back. `%` and `_` go too: they
 * are LIKE wildcards, so a search for "50%" would otherwise match everything.
 *
 * 60 characters because a search box is not an input channel for the database.
 * Nobody types a longer name, and the cap bounds the pattern the planner runs
 * against every row — which matters more here than anywhere, since one caller
 * searches 266,305 contractors.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * EXTRACTED AT THE THIRD CALL SITE. It was written for /inquiries (147),
 * copied to /admin/leads (155), and /admin/contractors (156a) made three. The
 * two copies had drifted by exactly one character — leads allowed `+` so that
 * a search for an E.164 phone number like "+1305" worked, inquiries did not —
 * which is precisely the drift a third copy would have compounded.
 *
 * The union is what ships: `+` is a literal inside an ilike pattern, so
 * allowing it everywhere costs nothing and removes the difference rather than
 * parameterising it. A single behaviour beats an options argument for a
 * function whose whole job is to be predictable.
 */
export function sanitizeSearch(value: string | undefined): string {
  return (value ?? "")
    .replace(/[^a-zA-Z0-9 @.'+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
