/**
 * Read-only analysis of city data in the imported contractors table.
 * Answers the pre-insert questions. Writes nothing. No credential output.
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

// PostgREST cannot express DISTINCT / GROUP BY, so page the two columns out
// and aggregate here.
const rows = [];
let from = 0;
const PAGE = 1000;
process.stdout.write("paging contractors");
for (;;) {
  const { data, error } = await db
    .from("contractors")
    .select("city,county_code,state")
    .order("dbpr_sync_key", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) { console.error("\n" + error.message); process.exit(1); }
  if (!data.length) break;
  rows.push(...data);
  from += data.length;
  if (from % 50000 === 0) process.stdout.write(".");
  if (data.length < PAGE) break;
}
console.log(` ${rows.length.toLocaleString("en-US")} rows\n`);

const pair = new Map();      // "CITY|cc" -> count
const cityOnly = new Map();  // "CITY"    -> Set(cc)
let nullCity = 0, nullCounty = 0, nullBoth = 0, outOfState = 0;

for (const r of rows) {
  const city = (r.city ?? "").trim();
  const cc = r.county_code;
  if (!city && !cc) nullBoth++;
  if (!city) { nullCity++; continue; }
  if (!cc) { nullCounty++; if ((r.state ?? "FL") !== "FL") outOfState++; continue; }
  const k = `${city}|${cc}`;
  pair.set(k, (pair.get(k) ?? 0) + 1);
  if (!cityOnly.has(city)) cityOnly.set(city, new Set());
  cityOnly.get(city).add(cc);
}

console.log("=== INSERTABLE UNIVERSE (city AND county_code both present) ===");
console.log(`  distinct (city, county) pairs   ${pair.size.toLocaleString("en-US")}`);
console.log(`  distinct city names             ${cityOnly.size.toLocaleString("en-US")}`);
console.log(`  contractors covered            ${[...pair.values()].reduce((a, b) => a + b, 0).toLocaleString("en-US")}`);

console.log("\n=== EXCLUDED ===");
console.log(`  rows with no city               ${nullCity.toLocaleString("en-US")}`);
console.log(`  rows with city but no county    ${nullCounty.toLocaleString("en-US")}  (of which non-FL state: ${outOfState.toLocaleString("en-US")})`);
console.log(`  rows with neither               ${nullBoth.toLocaleString("en-US")}`);

// Same city name in more than one county — the slug-collision case.
const multi = [...cityOnly].filter(([, s]) => s.size > 1);
console.log(`\n=== SLUG COLLISION RISK (city_slug is the PK) ===`);
console.log(`  city names spanning >1 county   ${multi.length.toLocaleString("en-US")}`);
for (const [name, counties] of multi.sort((a, b) => b[1].size - a[1].size).slice(0, 12)) {
  const detail = [...counties].sort().map((cc) => `${cc}:${pair.get(`${name}|${cc}`)}`).join(" ");
  console.log(`    ${name.padEnd(24)} ${counties.size} counties  ${detail}`);
}

// Long tail: how many pairs are tiny?
const counts = [...pair.values()].sort((a, b) => a - b);
const atMost = (n) => counts.filter((c) => c <= n).length;
console.log(`\n=== PAIR SIZE DISTRIBUTION ===`);
console.log(`  pairs with 1 contractor         ${atMost(1).toLocaleString("en-US")}`);
console.log(`  pairs with <=2                  ${atMost(2).toLocaleString("en-US")}`);
console.log(`  pairs with <=5                  ${atMost(5).toLocaleString("en-US")}`);
console.log(`  largest pair                    ${counts[counts.length - 1].toLocaleString("en-US")}`);

// Abbreviation / spelling variants worth flagging.
console.log(`\n=== SPELLING VARIANTS (same county, likely same place) ===`);
const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")
  .replace(/^N(?=[A-Z])/, "NORTH").replace(/^S(?=[A-Z])/, "SOUTH")
  .replace(/^E(?=[A-Z])/, "EAST").replace(/^W(?=[A-Z])/, "WEST")
  .replace(/^ST(?=[A-Z])/, "SAINT").replace(/^FT(?=[A-Z])/, "FORT");
const groups = new Map();
for (const [k, n] of pair) {
  const [city, cc] = k.split("|");
  const g = `${norm(city)}|${cc}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push([city, n]);
}
const variantGroups = [...groups.values()].filter((v) => v.length > 1);
console.log(`  groups with >1 spelling         ${variantGroups.length.toLocaleString("en-US")}`);
for (const g of variantGroups.sort((a, b) =>
  b.reduce((s, [, n]) => s + n, 0) - a.reduce((s, [, n]) => s + n, 0)).slice(0, 10)) {
  console.log(`    ${g.map(([c, n]) => `${c} (${n})`).join("  |  ")}`);
}

// Counties present in the data vs the reference table (FK check).
const { data: refCounties } = await db.from("reference_counties").select("county_code");
const known = new Set(refCounties.map((c) => c.county_code));
const used = new Set([...pair.keys()].map((k) => k.split("|")[1]));
const unknown = [...used].filter((c) => !known.has(c));
console.log(`\n=== FK CHECK vs reference_counties ===`);
console.log(`  county codes used by cities     ${used.size}`);
console.log(`  codes NOT in reference_counties ${unknown.length}${unknown.length ? " -> " + unknown.join(", ") : ""}`);
