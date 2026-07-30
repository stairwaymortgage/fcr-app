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

/**
 * Rows in the current DBPR extract. See the caveat above before changing.
 *
 * THE HOMEPAGE HERO AND AUTHORITY BAND BOTH RENDER THIS CONSTANT, DELIBERATELY.
 * Wiring either to a live `count(*)` was considered and rejected on 2026-07-30:
 * the live table holds 266,305 rows (seven fewer than this figure — the dedupe
 * on dbpr_sync_key before upsert), so a live count would publish 266,305 on the
 * front page as fact while the Header beside it still read 266,312. Worse, it
 * would silently commit the site to the overstated figure that is currently
 * awaiting Jim's ruling, by making it look measured rather than inherited.
 *
 * Every public surface therefore reads from here and nowhere else, so the whole
 * site moves together on one edit. Do not "improve" one of them into a live
 * query — mixing the two is what produces two different totals on one page.
 *
 * For reference, the four candidate figures as of the 2026-07-29 import:
 *   266,312  this constant — the extract as delivered, used by every mockup
 *   266,305  rows actually in the contractors table after dedupe
 *   265,804  rows with license_status = 'Current'
 *   122,225  rows with BOTH a licence number and an expiration date
 */
export const CONTRACTOR_COUNT = 266312;

/**
 * "Data as of …" — Header's statsTimestamp and Footer's lastSyncDate.
 *
 * A CONSTANT BECAUSE sync_runs IS EMPTY. The intended source is the newest
 * sync_runs row, but that table has zero rows: the initial import was run from
 * scripts/import-dbpr.mjs, which does not write an audit row. The weekly cron
 * will, and this constant should become that query when it does.
 *
 * The two dates available from live data are both wrong to show a visitor:
 * max(last_dbpr_sync_at) is 2026-07-29, which is when WE imported, not when
 * DBPR published; and the extract's own date, embedded in every dbpr_sync_key,
 * is 05/22/2026. The mockups say May 24, 2026, so that ships unchanged rather
 * than inventing a third date.
 */
export const DATA_AS_OF = "May 24, 2026";

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
