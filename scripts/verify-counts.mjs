/**
 * Reference-table count verifier — READ-ONLY. Writes nothing.
 *
 *   node scripts/verify-counts.mjs            all three tables
 *   node scripts/verify-counts.mjs --counties
 *   node scripts/verify-counts.mjs --cities
 *   node scripts/verify-counts.mjs --types
 *   node scripts/verify-counts.mjs --verbose  list every mismatching row
 *
 * WHAT "CORRECT" MEANS HERE, because the three tables do not share a rule and
 * a verifier that applied one rule to all three would manufacture failures:
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
 * a table that was correct. This script prints BOTH numbers for counties so the
 * distinction stays visible rather than being re-derived by the next person.
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

const num = (x) => (x ?? 0).toLocaleString("en-US");

/** head:true counts, ten at a time. 710 cities serially is a minute of waiting. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

const countWhere = async (apply) => {
  let q = db.from("contractors").select("dbpr_sync_key", { count: "exact", head: true });
  q = apply(q);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
};

let failures = 0;

// ----------------------------------------------------------
if (want("--counties")) {
  const { data, error } = await db
    .from("reference_counties")
    .select("county_code, county_name, contractor_count")
    .order("county_code");
  if (error) throw new Error(`reference_counties: ${error.message}`);

  const rows = await mapLimit(data, 10, async (rc) => ({
    ...rc,
    fl: await countWhere((q) => q.eq("county_code", rc.county_code).eq("state", "FL")),
    all: await countWhere((q) => q.eq("county_code", rc.county_code)),
  }));

  const badFL = rows.filter((r) => r.contractor_count !== r.fl);
  const badAll = rows.filter((r) => r.contractor_count !== r.all);

  console.log(`\nreference_counties — ${data.length} rows`);
  console.log(`  vs count WHERE state='FL'  : ${badFL.length} mismatched   <- the rule`);
  console.log(`  vs count with no filter    : ${badAll.length} mismatched   <- NOT the rule`);
  if (verbose && badFL.length) {
    for (const r of badFL) {
      console.log(`    ${r.county_code} ${r.county_name.padEnd(16)} stored ${num(r.contractor_count)} vs FL ${num(r.fl)}`);
    }
  }
  const sumStored = rows.reduce((a, r) => a + r.contractor_count, 0);
  const sumLive = rows.reduce((a, r) => a + r.fl, 0);
  console.log(`  sum stored ${num(sumStored)} · sum live(FL) ${num(sumLive)}`);
  if (badFL.length) failures++;
}

// ----------------------------------------------------------
if (want("--cities")) {
  const { data, error } = await db
    .from("reference_cities")
    .select("city_slug, city_name, contractor_count");
  if (error) throw new Error(`reference_cities: ${error.message}`);

  // contractors.city is uppercase throughout the extract; city_name is title
  // case. Matched on upper() exactly as 20260730's UPDATE does.
  const rows = await mapLimit(data, 10, async (rc) => ({
    ...rc,
    fl: await countWhere((q) => q.eq("city", rc.city_name.toUpperCase()).eq("state", "FL")),
  }));

  const bad = rows.filter((r) => r.contractor_count !== r.fl);
  console.log(`\nreference_cities — ${data.length} rows`);
  console.log(`  vs count WHERE state='FL'  : ${bad.length} mismatched`);
  if (verbose && bad.length) {
    for (const r of bad.slice(0, 40)) {
      console.log(`    ${r.city_name.padEnd(24)} stored ${num(r.contractor_count)} vs FL ${num(r.fl)}`);
    }
    if (bad.length > 40) console.log(`    …and ${bad.length - 40} more`);
  }
  if (bad.length) failures++;
}

// ----------------------------------------------------------
if (want("--types")) {
  const { data, error } = await db
    .from("reference_license_types")
    .select("type_code, type_name, contractor_count")
    .order("type_code");
  if (error) throw new Error(`reference_license_types: ${error.message}`);

  const rows = await mapLimit(data, 10, async (rt) => ({
    ...rt,
    live: await countWhere((q) => q.eq("license_type", rt.type_code)),
  }));

  const bad = rows.filter((r) => r.contractor_count !== r.live);
  const zero = rows.filter((r) => r.contractor_count === 0);
  console.log(`\nreference_license_types — ${data.length} rows`);
  console.log(`  stored value = 0           : ${zero.length}`);
  console.log(`  vs live count (no filter)  : ${bad.length} mismatched`);
  if (verbose) {
    for (const r of rows) {
      const mark = r.contractor_count === r.live ? "  " : "✗ ";
      console.log(`    ${mark}${r.type_code.padEnd(5)} ${r.type_name.slice(0, 32).padEnd(33)} stored ${num(r.contractor_count).padStart(7)}  live ${num(r.live).padStart(7)}`);
    }
  }
  const sumLive = rows.reduce((a, r) => a + r.live, 0);
  const total = await countWhere((q) => q);
  console.log(`  sum live ${num(sumLive)} of ${num(total)} contractor rows`);
  console.log(`  ⚠ the gap is the codes with no reference row (QB, FRO, …) — see`);
  console.log(`    db/migrations/20260805_reference_counts_repair.sql. Not a defect.`);
  if (bad.length) failures++;
}

console.log(
  failures === 0
    ? "\nAll checked tables agree with the live data.\n"
    : `\n${failures} table(s) disagree — run db/migrations/20260805_reference_counts_repair.sql.\n`,
);
