/**
 * Derive reference_cities from the imported contractors table.
 *
 *   node scripts/derive-cities.mjs --dry    build + report, no writes
 *   node scripts/derive-cities.mjs          build + upsert
 *
 * Six steps, as approved:
 *   1. group contractors by city where city AND county_code are both present
 *   2. drop names with fewer than MIN_CONTRACTORS
 *   3. title-case -> slugify -> merge slug collisions (sum counts, keep the
 *      highest-count source spelling)
 *   4. county_code = modal county of the merged group
 *   5. latitude / longitude stay NULL — DBPR publishes no coordinates
 *   6. upsert on city_slug
 *
 * Never prints credential values.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const MIN_CONTRACTORS = 5;

// ---------------------------------------------------------------
// Title case. CASING ONLY — it never rewrites a word, so "FT MYERS"
// becomes "Ft Myers", not "Fort Myers". Expanding abbreviations is a
// separate normalisation task with SEO consequences.
// ---------------------------------------------------------------
const LOWER = new Set(["de", "la", "las", "los", "del", "of", "the", "at", "on", "in", "by"]);

function capWord(w) {
  if (!w) return w;
  if (/^o'[a-z]/.test(w)) return "O'" + w[2].toUpperCase() + w.slice(3); // O'Brien
  if (/^mc[a-z]{2,}/.test(w)) return "Mc" + w[2].toUpperCase() + w.slice(3); // McIntosh
  return w[0].toUpperCase() + w.slice(1); // periods survive: "st." -> "St."
}

/** Tokenises on spaces AND hyphens so particles lower inside hyphenated
 *  names too: HOWEY-IN-THE-HILLS -> Howey-in-the-Hills.
 *
 *  Also repairs a period that is not followed by a space: "ST.PETE BEACH"
 *  renders "St.pete Beach" otherwise, because the whole run is one token. This
 *  is a spacing repair inside a single spelling, NOT a merge or a choice
 *  between spellings — the same class of fix as the hyphen-particle rule.
 *  Four spellings in the data need it (ST.PETE BEACH, ST.PETERSBURG,
 *  ST.AUGUSTINE, ST.CLOUD); only the first currently wins its group, so the
 *  other three are latent until a future sync shifts the counts. */
function titleCase(raw) {
  const repaired = raw.replace(/\.(?=[A-Za-z])/g, ". ");
  const parts = repaired.trim().replace(/\s+/g, " ").toLowerCase().split(/([ -])/);
  let i = 0;
  return parts
    .map((p) => {
      if (p === " " || p === "-") return p;
      const out = i > 0 && LOWER.has(p) ? p : capWord(p);
      i++;
      return out;
    })
    .join("");
}

const slugify = (raw) =>
  raw.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ---------------------------------------------------------------
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// STEP 1 — group by source spelling
process.stdout.write("paging contractors");
const byName = new Map(); // "CITY" -> { total, counties: Map(cc -> n) }
let from = 0;
for (;;) {
  const { data, error } = await db
    .from("contractors").select("city,county_code")
    .order("dbpr_sync_key").range(from, from + 999);
  if (error) { console.error("\n" + error.message); process.exit(1); }
  if (!data.length) break;
  for (const r of data) {
    const city = (r.city ?? "").trim();
    if (!city || !r.county_code) continue;
    if (!byName.has(city)) byName.set(city, { total: 0, counties: new Map() });
    const e = byName.get(city);
    e.total++;
    e.counties.set(r.county_code, (e.counties.get(r.county_code) ?? 0) + 1);
  }
  from += data.length;
  if (from % 50000 === 0) process.stdout.write(".");
  if (data.length < 1000) break;
}
console.log(` ${from.toLocaleString("en-US")} rows`);
console.log(`\nstep 1  distinct source spellings (city + county present)  ${byName.size.toLocaleString("en-US")}`);

// STEP 2 — floor
const kept = [...byName].filter(([, e]) => e.total >= MIN_CONTRACTORS);
console.log(`step 2  after floor >= ${MIN_CONTRACTORS}                                  ${kept.length.toLocaleString("en-US")}  (dropped ${(byName.size - kept.length).toLocaleString("en-US")})`);

// STEP 3 + 4 — slug, merge collisions, modal county of the merged group
const bySlug = new Map();
for (const [raw, e] of kept) {
  const slug = slugify(titleCase(raw));
  if (!bySlug.has(slug)) bySlug.set(slug, { spellings: [], counties: new Map(), total: 0 });
  const g = bySlug.get(slug);
  g.spellings.push([raw, e.total]);
  g.total += e.total;
  for (const [cc, n] of e.counties) g.counties.set(cc, (g.counties.get(cc) ?? 0) + n);
}
const merged = [...bySlug].filter(([, g]) => g.spellings.length > 1);
console.log(`step 3  distinct slugs                                  ${bySlug.size.toLocaleString("en-US")}  (${merged.length} slug-collision groups merged)`);

const records = [...bySlug].map(([slug, g]) => {
  const winner = g.spellings.slice().sort((a, b) => b[1] - a[1])[0][0];
  const modal = [...g.counties].sort((a, b) => b[1] - a[1])[0][0];
  return {
    city_slug: slug,
    city_name: titleCase(winner),
    city_name_raw: winner,
    county_code: modal,
    latitude: null,
    longitude: null,
    contractor_count: g.total,
  };
});
console.log(`step 4  modal county assigned`);
console.log(`step 5  latitude / longitude NULL (DBPR publishes no coordinates)`);
console.log(`\nrows to insert  ${records.length.toLocaleString("en-US")}`);
console.log(`contractors covered  ${records.reduce((a, r) => a + r.contractor_count, 0).toLocaleString("en-US")}`);

console.log(`\n=== THE ${merged.length} MERGED SLUG GROUPS ===`);
for (const [slug, g] of merged.sort((a, b) => b[1].total - a[1].total)) {
  const rec = records.find((r) => r.city_slug === slug);
  const parts = g.spellings.sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}(${n.toLocaleString("en-US")})`);
  console.log(`  ${slug}`);
  console.log(`      ${parts.join(" + ")}`);
  console.log(`      -> "${rec.city_name}"  raw "${rec.city_name_raw}"  county ${rec.county_code}  total ${rec.contractor_count.toLocaleString("en-US")}`);
}

if (process.argv.includes("--dry")) { console.log("\n--dry: nothing written"); process.exit(0); }

// STEP 6 — upsert
console.log(`\nupserting ${records.length} rows`);
for (let i = 0; i < records.length; i += 500) {
  const { error } = await db.from("reference_cities")
    .upsert(records.slice(i, i + 500), { onConflict: "city_slug", ignoreDuplicates: false });
  if (error) { console.error(`batch ${i} FAILED: ${error.message}`); process.exit(1); }
}
console.log("done");
