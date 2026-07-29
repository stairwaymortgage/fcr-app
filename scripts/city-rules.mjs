/**
 * Read-only. Proposes title-casing + slug rules and tests them against the
 * REAL distinct city names in the imported data, then compares contractor
 * floors. Writes nothing. No credential output.
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

// ---------------------------------------------------------------
// TITLE CASE
// Casing only. It never rewrites a word — FT MYERS becomes Ft Myers,
// not Fort Myers. Expanding abbreviations is the separate normalisation
// task and is deliberately not done here.
// ---------------------------------------------------------------
const LOWER = new Set(["de", "la", "las", "los", "del", "of", "the", "at", "on", "in", "by"]);

function titleCase(raw) {
  // Tokenise on spaces AND hyphens, keeping the separators, so particle
  // lowering applies inside hyphenated names too:
  //   HOWEY-IN-THE-HILLS -> Howey-in-the-Hills   (not Howey-In-The-Hills)
  //   OPA-LOCKA          -> Opa-Locka
  const parts = raw.trim().replace(/\s+/g, " ").toLowerCase().split(/([ -])/);
  let wordIndex = 0;
  return parts
    .map((p) => {
      if (p === " " || p === "-") return p;
      const out = wordIndex > 0 && LOWER.has(p) ? p : capWord(p);
      wordIndex++;
      return out;
    })
    .join("");
}

function capWord(w) {
  if (!w) return w;
  // O'BRIEN -> O'Brien
  if (/^o'[a-z]/.test(w)) return "O'" + w[2].toUpperCase() + w.slice(3);
  // MCINTOSH -> McIntosh (only when what follows looks like a name stem)
  if (/^mc[a-z]{2,}/.test(w)) return "Mc" + w[2].toUpperCase() + w.slice(3);
  // ST. / ST -> St. / St   (casing only; not expanded to Saint)
  // handled by the generic path below, which preserves the period
  return w[0].toUpperCase() + w.slice(1);
}

// ---------------------------------------------------------------
// SLUG
// ---------------------------------------------------------------
const slugify = (raw) =>
  raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ---------------------------------------------------------------
const rows = [];
let from = 0;
for (;;) {
  const { data, error } = await db
    .from("contractors")
    .select("city,county_code")
    .order("dbpr_sync_key")
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data.length) break;
  rows.push(...data);
  from += data.length;
  if (data.length < 1000) break;
}

const byName = new Map(); // NAME -> Map(county -> n)
for (const r of rows) {
  const c = (r.city ?? "").trim();
  if (!c || !r.county_code) continue;
  if (!byName.has(c)) byName.set(c, new Map());
  const m = byName.get(c);
  m.set(r.county_code, (m.get(r.county_code) ?? 0) + 1);
}
const totalOf = (n) => [...byName.get(n).values()].reduce((a, b) => a + b, 0);
const names = [...byName.keys()];

console.log(`distinct city names: ${names.length}\n`);

// ---- (a) hard cases, drawn from the real data ----
console.log("=== TITLE CASE ON REAL HARD CASES ===");
const patterns = [
  ["ST. / ST prefix", /^ST[. ]/i],
  ["FT abbreviation", /^FT[. ,]/i],
  ["directional prefix", /^[NSEW][. ] /i],
  ["Mc name", /^MC[A-Z]/],
  ["apostrophe", /'/],
  ["hyphen", /-/],
  ["particle (DE/LA)", /\b(DE|LA|LAS|LOS)\b/i],
  ["contains period", /\./],
  ["contains digit", /\d/],
];
for (const [label, re] of patterns) {
  const hits = names.filter((n) => re.test(n)).sort((a, b) => totalOf(b) - totalOf(a)).slice(0, 5);
  if (!hits.length) continue;
  console.log(`\n  ${label}`);
  for (const h of hits) {
    console.log(`    ${JSON.stringify(h).padEnd(28)} -> ${JSON.stringify(titleCase(h)).padEnd(28)} slug ${slugify(titleCase(h))}`);
  }
}

// ---- (b) floor comparison ----
console.log("\n\n=== CONTRACTOR FLOOR COMPARISON ===");
for (const floor of [1, 3, 5]) {
  const kept = names.filter((n) => totalOf(n) >= floor);
  console.log(`  floor >= ${floor}:  keeps ${kept.length.toLocaleString("en-US")}  drops ${(names.length - kept.length).toLocaleString("en-US")}`);
}

const dropped3 = names.filter((n) => totalOf(n) < 3).sort((a, b) => totalOf(b) - totalOf(a));
const between = names.filter((n) => totalOf(n) >= 3 && totalOf(n) < 5).sort((a, b) => totalOf(b) - totalOf(a));

console.log(`\n  --- DROPPED by >=3 (${dropped3.length}) — sample of 24, largest first ---`);
console.log("      " + dropped3.slice(0, 24).map((n) => `${n}(${totalOf(n)})`).join("  "));

console.log(`\n  --- IN THE GAP: kept by >=3, dropped by >=5 (${between.length}) — sample of 24 ---`);
console.log("      " + between.slice(0, 24).map((n) => `${n}(${totalOf(n)})`).join("  "));

// Known real small Florida towns — do they survive each floor?
console.log("\n  --- REAL SMALL TOWNS: survival check ---");
const probes = ["BRISTOL", "HOSFORD", "MAYO", "DAY", "JASPER", "JENNINGS", "WHITE SPRINGS",
  "MOORE HAVEN", "LAMONT", "SOPCHOPPY", "PANACEA", "WEWAHITCHKA", "ALTHA", "GRACEVILLE",
  "RAIFORD", "WORTHINGTON SPRINGS", "BROOKER", "LAWTEY"];
console.log(`      ${"town".padEnd(22)} ${"n".padStart(4)}  >=3  >=5`);
for (const p of probes) {
  if (!byName.has(p)) { console.log(`      ${p.padEnd(22)} ${"—".padStart(4)}   —    —   (absent)`); continue; }
  const t = totalOf(p);
  console.log(`      ${p.padEnd(22)} ${String(t).padStart(4)}  ${t >= 3 ? "keep" : "DROP"} ${t >= 5 ? "keep" : "DROP"}`);
}

// ---- (c) slug uniqueness after floor ----
console.log("\n\n=== SLUG UNIQUENESS AFTER FLOOR ===");
for (const floor of [3, 5]) {
  const kept = names.filter((n) => totalOf(n) >= floor);
  const slugs = new Map();
  for (const n of kept) {
    const s = slugify(titleCase(n));
    if (!slugs.has(s)) slugs.set(s, []);
    slugs.get(s).push(n);
  }
  const dups = [...slugs].filter(([, v]) => v.length > 1);
  console.log(`  floor >= ${floor}:  ${kept.length} names -> ${slugs.size} slugs, ${dups.length} collisions`);
  for (const [s, v] of dups.slice(0, 8)) console.log(`      ${s}  <-  ${v.map((x) => `${x}(${totalOf(x)})`).join(", ")}`);
  const unsafe = [...slugs.keys()].filter((s) => !/^[a-z0-9-]+$/.test(s) || s.startsWith("-") || s.endsWith("-"));
  console.log(`      URL-unsafe slugs: ${unsafe.length}${unsafe.length ? " -> " + unsafe.slice(0, 5).join(", ") : ""}`);
}
