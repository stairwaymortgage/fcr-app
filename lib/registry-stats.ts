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
 * THE FRAMING IS SETTLED: THESE ARE "RECORDS", NEVER "ACTIVE LICENCES".
 *
 * Resolved 2026-07-30, replacing the hold that previously sat here. The earlier
 * note estimated ~126,571 "active" licences from the raw extract; measured
 * against the imported table that arithmetic does not survive, and the honest
 * description of what the directory contains is every record DBPR publishes.
 *
 * Any copy that pairs CONTRACTOR_COUNT with the word "active" is a factual
 * error, not a wording preference. See the constant's own docblock for the full
 * set of measured figures and the one number that would justify "active"
 * (119,330, and only via a live query).
 * ---------------------------------------------------------------------------
 */

/**
 * Contractor RECORDS in the registry — the verified row count of the
 * contractors table, not a count of active licences.
 *
 * RESOLVED 2026-07-30. This was held pending a decision on public framing; the
 * ruling is that the site describes these as "records", which is what they are.
 * Every surface that renders this number must use records/total wording. None
 * may call it "active" — see the numbers below for why that would be false.
 *
 * 266,305, NOT 266,312. The mockups and the Build Brief say 266,312, which is
 * the row count of the DBPR extract as delivered. Seven of those rows were
 * duplicate dbpr_sync_key values, removed by the dedupe in 6611f88 before
 * upsert, so the table holds 266,305. "Total records in the registry" is a
 * claim about our table, and 266,305 is that number. Verified against the live
 * project on 2026-07-30.
 *
 * WHAT "ACTIVE" WOULD HAVE TO MEAN, all measured 2026-07-30:
 *   266,305  rows in the table                      <- this constant
 *   265,804  license_status = 'Current'             99.8% — status alone is
 *                                                   not a meaningful filter
 *   140,957  rows with a licence number
 *   122,225  rows with an expiration date
 *   119,330  'Current' AND expiration_date >= today <- the defensible
 *                                                   "active licence" figure
 *
 * Note the trap: by STATUS almost every row is 'Current', so "active-status"
 * reads as ~266k, not ~126k. The number that actually falls by half is the one
 * that requires an unexpired expiration date. If a genuine active count is ever
 * published, it is 119,330 and it needs a live query, not a constant — it goes
 * stale every day as licences expire.
 *
 * Every public surface reads from here and nowhere else, so the whole site
 * moves together on one edit. Do not "improve" one of them into a live query;
 * mixing the two is what produces two different totals on one page.
 */
export const CONTRACTOR_COUNT = 266305;

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
