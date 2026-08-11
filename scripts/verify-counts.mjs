/**
 * Reference-table count verifier — READ-ONLY. Writes nothing.
 *
 *   node scripts/verify-counts.mjs            all three tables
 *   node scripts/verify-counts.mjs --counties
 *   node scripts/verify-counts.mjs --cities
 *   node scripts/verify-counts.mjs --types
 *   node scripts/verify-counts.mjs --verbose  list every mismatching row
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MEASURES THROUGH verify_reference_counts(), NOT BY COUNTING FROM HERE.
 *
 * This script used to issue one head:true count per reference row — 67 counties
 * twice (filtered and unfiltered), 710 cities, 29 types: ~1,530 HTTP requests,
 * ten at a time, to answer one question. It now makes ONE call and does the
 * comparison locally.
 *
 * ⚠ THE REAL REASON IS NOT SPEED, IT IS AGREEMENT. The old version restated the
 * counting rules in JavaScript — the state='FL' filter on the two geographic
 * tables, its absence on licence types, the upper() match on city names. The
 * repair restated the same rules in SQL. Two independent transcriptions of the
 * same three asymmetries, and a verifier that has drifted from the repair it
 * checks reports "0 mismatched" about the wrong question. Both now read the
 * same function, so this cannot silently diverge from what the importer fixed.
 *
 * WHAT REMAINS THIS SCRIPT'S JOB: deciding what counts as a failure, and saying
 * so legibly. The function returns rows; the judgement is here.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT "CORRECT" MEANS, because the three tables do not share a rule and a
 * verifier that applied one rule to all three would manufacture failures:
 *
 *   reference_counties.contractor_count       count WHERE state = 'FL'
 *   reference_cities.contractor_count         count WHERE state = 'FL'
 *   reference_license_types.contractor_count  count with NO state filter
 *
 * The state filter on the two geographic tables is the correction made by
 * db/migrations/20260730_reference_counts.sql: 27,250 records carry an
 * out-of-state mailing address, so counting a Florida COUNTY or CITY without
 * that filter mixes states (reference_cities has a Birmingham row; 257 of its
 * 277 name matches are Birmingham, Alabama).
 *
 * Licence types take no such filter, and that difference is deliberate — see
 * db/migrations/20260805_reference_counts_repair.sql. An out-of-state CGC still
 * holds a Florida Certified General Contractor licence, and /type/[code] lists
 * them; filtering here would make the badge disagree with the rows beneath it.
 *
 * ⚠ MEASURE AGAINST THE MIGRATION'S OWN DEFINITION BEFORE CALLING SOMETHING
 * BROKEN. An earlier pass reported "42 of 67 counties disagree" by counting
 * every contractor rather than only the Florida-addressed ones. That is a
 * different question with a different answer, and it produced a bug report for
 * a table that was correct. The function returns BOTH numbers for counties and
 * this script prints both, so the distinction stays visible rather than being
 * re-derived by the next person.
 *
 * ⚠ REQUIRES db/migrations/20260810_reference_counts_rpc.sql, INCLUDING ITS
 * STATEMENT 1 — the function seq-scans 271k rows four times and service_role
 * gets PostgREST's 8s statement timeout without that ALTER ROLE.
 *
 * Never prints credential values.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const verbose = flag("--verbose");
const only = flag("--counties") || flag("--cities") || flag("--types");
const want = (n) => !only || flag(n);

const num = (x) => Number(x ?? 0).toLocaleString("en-US");

const { data, error } = await db.rpc("verify_reference_counts");

if (error) {
  console.error(`\nverify_reference_counts() failed: ${error.message}`);
  if (error.code === "PGRST202") {
    console.error("db/migrations/20260810_reference_counts_rpc.sql has not been applied.");
  } else if (error.code === "57014") {
    console.error(
      "Statement timeout. Apply STATEMENT 1 of that migration:\n" +
      "  ALTER ROLE service_role SET statement_timeout = '120s';\n" +
      "  NOTIFY pgrst, 'reload config';",
    );
  }
  process.exit(1);
}

/**
 * A missing table in the result is a failure, not an empty section.
 *
 * The function UNIONs three fixed blocks, so a table returning zero rows means
 * the reference table itself is empty — which would make every count "agree"
 * vacuously. Reporting that as a pass is exactly the class of false green this
 * script exists to prevent.
 */
const rows = data ?? [];
const byTable = (name) => rows.filter((r) => r.table_name === name);

let failures = 0;

/** Shared: stored vs live, per the table's own rule. */
const mismatched = (list) => list.filter((r) => r.stored !== Number(r.live_count));

// ----------------------------------------------------------
if (want("--counties")) {
  const list = byTable("reference_counties");
  const badFL = mismatched(list);
  // The wrong question, printed deliberately — see the header.
  const badAll = list.filter((r) => r.stored !== Number(r.live_unfiltered));

  console.log(`\nreference_counties — ${list.length} rows`);
  console.log(`  vs count WHERE state='FL'  : ${badFL.length} mismatched   <- the rule`);
  console.log(`  vs count with no filter    : ${badAll.length} mismatched   <- NOT the rule`);
  if (verbose && badFL.length) {
    for (const r of badFL) {
      console.log(
        `    ${r.key} ${String(r.label).padEnd(16)} stored ${num(r.stored)} vs FL ${num(r.live_count)}`,
      );
    }
  }
  const sumStored = list.reduce((a, r) => a + r.stored, 0);
  const sumLive = list.reduce((a, r) => a + Number(r.live_count), 0);
  console.log(`  sum stored ${num(sumStored)} · sum live(FL) ${num(sumLive)}`);
  if (list.length === 0) {
    console.log("  ⚠ no rows returned — reference_counties is empty?");
    failures++;
  }
  if (badFL.length) failures++;
}

// ----------------------------------------------------------
if (want("--cities")) {
  const list = byTable("reference_cities");
  const bad = mismatched(list);

  console.log(`\nreference_cities — ${list.length} rows`);
  console.log(`  vs count WHERE state='FL'  : ${bad.length} mismatched`);
  if (verbose && bad.length) {
    for (const r of bad.slice(0, 40)) {
      console.log(
        `    ${String(r.label).padEnd(24)} stored ${num(r.stored)} vs FL ${num(r.live_count)}`,
      );
    }
    if (bad.length > 40) console.log(`    …and ${bad.length - 40} more`);
  }
  if (list.length === 0) {
    console.log("  ⚠ no rows returned — reference_cities is empty?");
    failures++;
  }
  if (bad.length) failures++;
}

// ----------------------------------------------------------
if (want("--types")) {
  const list = byTable("reference_license_types");
  const bad = mismatched(list);
  const zero = list.filter((r) => r.stored === 0);

  console.log(`\nreference_license_types — ${list.length} rows`);
  console.log(`  stored value = 0           : ${zero.length}`);
  console.log(`  vs live count (no filter)  : ${bad.length} mismatched`);
  if (verbose) {
    for (const r of list) {
      const mark = r.stored === Number(r.live_count) ? "  " : "✗ ";
      console.log(
        `    ${mark}${String(r.key).padEnd(5)} ${String(r.label).slice(0, 32).padEnd(33)}` +
        ` stored ${num(r.stored).padStart(7)}  live ${num(r.live_count).padStart(7)}`,
      );
    }
  }
  const sumLive = list.reduce((a, r) => a + Number(r.live_count), 0);
  console.log(`  sum live ${num(sumLive)} across the codes with a reference row`);
  console.log(`  ⚠ this does NOT equal count(*) on contractors — the gap is the codes`);
  console.log(`    with no reference row (QB, FRO, …). See`);
  console.log(`    db/migrations/20260805_reference_counts_repair.sql. Not a defect.`);
  if (list.length === 0) {
    console.log("  ⚠ no rows returned — reference_license_types is empty?");
    failures++;
  }
  if (bad.length) failures++;
}

console.log(
  failures === 0
    ? "\nAll checked tables agree with the live data.\n"
    : `\n${failures} table(s) disagree — the importer's Phase 4 repairs this on every\n` +
      `run; to fix it now: SELECT * FROM repair_reference_counts();\n`,
);

process.exitCode = failures === 0 ? 0 : 1;
