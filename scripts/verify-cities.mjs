/**
 * Post-derivation verification for reference_cities. Read-only.
 * Never prints credential values.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// --- 1. count ---
const { count } = await db
  .from("reference_cities")
  .select("*", { count: "exact", head: true });
console.log(`=== 1. count ===\n  reference_cities: ${count} rows\n`);

// Pull everything once; 710 rows is small.
const all = [];
let from = 0;
for (;;) {
  const { data, error } = await db
    .from("reference_cities")
    .select("city_slug,city_name,city_name_raw,county_code,latitude,longitude,contractor_count")
    .order("city_slug")
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data.length) break;
  all.push(...data);
  from += data.length;
  if (data.length < 1000) break;
}

const { data: counties } = await db
  .from("reference_counties")
  .select("county_code,county_name");
const cname = Object.fromEntries(counties.map((c) => [c.county_code, c.county_name]));

// --- 2. Davie ---
console.log("=== 2. Davie ===");
for (const r of all.filter((r) => /davie/i.test(r.city_name))) {
  console.log(`  slug=${r.city_slug}  name="${r.city_name}"  raw="${r.city_name_raw}"  ` +
    `county=${r.county_code} (${cname[r.county_code]})  contractors=${r.contractor_count}  ` +
    `lat=${r.latitude}  lon=${r.longitude}`);
}

// --- 3. duplicate slugs ---
const seen = new Set();
const dups = [];
for (const r of all) {
  if (seen.has(r.city_slug)) dups.push(r.city_slug);
  seen.add(r.city_slug);
}
console.log(`\n=== 3. duplicate slugs ===`);
console.log(`  rows ${all.length}   distinct slugs ${seen.size}   duplicates ${dups.length}`);

// --- 4. the six previously-defective display names ---
console.log(`\n=== 4. the six previously-defective display names, FINAL ===`);
const watch = [
  ["st-pete-beach", "FIXED by the period-space rule"],
  ["o-brien", "deferred — majority spelling kept"],
  ["port-st-lucie", "deferred — majority spelling kept"],
  ["st-augustine", "deferred — majority spelling kept"],
  ["st-james-city", "deferred — majority spelling kept"],
  ["grant-valkaria", "deferred — majority spelling kept"],
];
for (const [slug, note] of watch) {
  const r = all.find((x) => x.city_slug === slug);
  if (!r) { console.log(`  ${slug.padEnd(18)} NOT FOUND`); continue; }
  console.log(`  ${slug.padEnd(18)} "${r.city_name}"`.padEnd(56) +
    `raw "${r.city_name_raw}"`.padEnd(30) + note);
}

// --- 5. integrity ---
console.log(`\n=== 5. integrity ===`);
const known = new Set(counties.map((c) => c.county_code));
console.log(`  rows with county not in reference_counties  ${all.filter((r) => !known.has(r.county_code)).length}`);
console.log(`  rows with null city_name / raw / county      ${all.filter((r) => !r.city_name || !r.city_name_raw || !r.county_code).length}`);
console.log(`  rows with non-URL-safe slug                 ${all.filter((r) => !/^[a-z0-9-]+$/.test(r.city_slug)).length}`);
console.log(`  rows with latitude or longitude set         ${all.filter((r) => r.latitude !== null || r.longitude !== null).length}`);
console.log(`  contractor_count total                      ${all.reduce((a, r) => a + r.contractor_count, 0).toLocaleString("en-US")}`);
console.log(`  smallest contractor_count                   ${Math.min(...all.map((r) => r.contractor_count))}`);
console.log(`  distinct counties represented               ${new Set(all.map((r) => r.county_code)).size} of 67`);
