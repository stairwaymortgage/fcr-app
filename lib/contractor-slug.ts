/**
 * Contractor profile slugs — the URL form of /contractor/[slug].
 *
 * The shape is fixed by the mockups, which link to exactly two real profiles:
 *   contractor_profile_aceca.html   /contractor/aceca-construction-cgc1520921-davie
 *   search_results.html             /contractor/acero-roofing-ccc1331458-davie
 *
 * so the pattern is {business}-{licence}-{city}, all slugified.
 *
 * THERE IS NO slug COLUMN. contractors is keyed on dbpr_sync_key and carries no
 * URL field (01_schema.sql), so the slug is derived, not stored. That makes this
 * function the single definition of a profile URL: the homepage builds links
 * with it now, and the /contractor/[slug] route in Week 2 Day 5 must resolve
 * them with it. If the two ever disagree, every profile link on the site 404s
 * while both halves look correct in isolation — so change this in one place or
 * not at all.
 *
 * NOT REVERSIBLE, BY CONSTRUCTION. Slugifying is lossy: "A&B Roofing, LLC" and
 * "A B Roofing LLC" both become "a-b-roofing-llc". The route cannot parse a slug
 * back into a query and must look the contractor up by the slug as a whole
 * (matching on the derived value, or on the licence number embedded in it).
 */

/**
 * Combining diacritical marks left behind by NFKD, U+0300–U+036F.
 *
 * BUILT FROM A STRING, NOT WRITTEN AS A REGEX LITERAL, for two reasons that
 * each rule out the obvious spellings:
 *
 *   /[̀-ͯ]/g        the literal characters are combining marks. They render on
 *                   top of the preceding bracket, so the class looks empty in
 *                   most editors and in `git diff` — unreviewable.
 *   /\p{Diacritic}/gu  needs `target` >= es2018. tsconfig.json sets no target,
 *                   so tsc defaults below that and `next build` fails with
 *                   "This regular expression flag is only available when
 *                   targeting 'es6' or later". Raising the project target to
 *                   satisfy one regex is a bigger change than this deserves.
 *
 * The constructor form keeps the source ASCII and needs no target bump.
 */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Lowercase, non-alphanumerics to single hyphens, no leading/trailing hyphen.
 *
 * NFKD then strip marks, in that order and before the alphanumeric pass:
 * decomposing turns "ñ" into "n" + U+0303, the strip drops the mark, and "peña"
 * becomes "pena". Skipping the strip would leave a stray combining mark for the
 * alphanumeric pass to turn into a hyphen — "pen-a".
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The columns a slug is built from. Matches the contractors table. */
export interface SlugSource {
  business_name: string | null;
  qualifying_agent_name: string;
  license_number: string | null;
  city: string | null;
}

/**
 * Build a profile slug.
 *
 * business_name is NULL on a large share of rows (the DBPR extract carries a
 * qualifying agent for every record but a DBA for only some), so it falls back
 * to qualifying_agent_name — which is NOT NULL in the schema and is therefore
 * the one component guaranteed to exist.
 *
 * license_number is NULL on roughly 125k rows. Those slugs collapse to
 * {name}-{city}, which is not reliably unique; callers that need a working link
 * should filter to rows that have a licence number rather than depend on this
 * function to invent uniqueness it has no basis for.
 */
export function contractorSlug({
  business_name,
  qualifying_agent_name,
  license_number,
  city,
}: SlugSource): string {
  return [business_name || qualifying_agent_name, license_number, city]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map(slugify)
    .filter(Boolean)
    .join("-");
}
