/**
 * Registry-wide counts, in one place.
 *
 * These numbers appear in body copy on multiple pages. They were hard-coded in
 * five separate places (Header's default prop, the 404's lede and its two
 * browse links, ContentPageLayout's rail); changing the figure meant finding
 * all five. Same rule as the design tokens: do not bake a value into six
 * places.
 *
 * WEEK 2: replace these constants with a cached query against the live tables.
 * They are constants only because there is no data layer yet.
 *
 * ---------------------------------------------------------------------------
 * CONTRACTOR_COUNT IS DISPUTED AND HELD FOR JIM. DO NOT SILENTLY "FIX" IT.
 *
 * 266,312 is the row count of the DBPR CONSTRUCTIONLICENSE_1 extract, and it
 * is what every mockup and the Build Brief use. Auditing the extract for the
 * initial import showed it overstates "licensed contractors" by roughly 2x:
 *
 *   266,312  rows in the extract
 *  -125,355  rows with no licence number at all
 *  - 22,602  rows registered out of state (GA, TX, AL, NC, ...)
 *   ~126,571 rows with both a licence number and an expiration date
 *
 * The defensible figure for "active Florida contractor licences" is therefore
 * closer to 126,000. Changing public copy is Jim's call, not a build decision,
 * so the number here is deliberately left at the audited-but-unchanged value.
 * When he rules, edit this one constant.
 * ---------------------------------------------------------------------------
 */

/** Rows in the current DBPR extract. See the caveat above before changing. */
export const CONTRACTOR_COUNT = 266312;

/** Florida counties. Fixed by geography; reference_counties seeds all 67. */
export const COUNTY_COUNT = 67;

/**
 * License types shown in the /types index.
 *
 * DISPUTED, HELD FOR JIM — same pattern as CONTRACTOR_COUNT above. Build Brief
 * §04 and the mockups say 29; the Seed Data document says "License Types —
 * real DBPR taxonomy (26 active types)". Not resolved by guessing: the
 * authoritative count is the distinct Occupation Code values in the DBPR
 * extract, available once it is imported.
 *
 * 29 ships in the meantime because that is what the mockups render.
 *
 * This is now the second brief/seed figure the source data may contradict.
 * Both live here so there is one place to correct when the extract settles
 * them.
 */
export const LICENSE_TYPE_COUNT = 29;

/** "266,312" — the display form used in body copy. */
export const contractorCountLabel = () =>
  CONTRACTOR_COUNT.toLocaleString("en-US");
