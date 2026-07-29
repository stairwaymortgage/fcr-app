/**
 * DBPR initial import — parser + loader.
 *
 * Replaces the transform in _handoff/09_dbpr_ingestion/sync_dbpr.ts, whose
 * documented column layout matches no file we have. Written against the
 * OFFICIAL layout published at
 * https://www2.myfloridalicense.com/construction-industry/public-records/
 * and verified field-by-field against the real 266,312-row extract.
 *
 *   node scripts/import-dbpr.mjs --count-only     collision audit, no DB
 *   node scripts/import-dbpr.mjs --preview 20     transform preview, no DB
 *   node scripts/import-dbpr.mjs --limit 20       insert first 20 rows
 *   node scripts/import-dbpr.mjs                  full import
 *
 * Never prints credential values.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const CSV_PATH = "_handoff/07_source_data/CONSTRUCTIONLICENSE_1.csv";
const BATCH_SIZE = 1000;

// ==========================================================
// OFFICIAL DBPR FIELD POSITIONS (0-based)
// ==========================================================
// 0  Board Number            constant '06' (CILB) — not a county code
// 1  Occupation Code         license type, e.g. CGC
// 2  Licensee Name           "LAST, FIRST M"
// 3  Doing Business as Name  DBA, or the literal 'INDIVIDUAL'
// 4  Class Code              sub-type, e.g. B / GLZ
// 5  Address Line 1
// 6  Address Line 2          suite / apt
// 7  Address Line 3          DIRTY: holds 'FL', 'FLORIDA', city names
// 8  City
// 9  State
// 10 Zip
// 11 County Code             DBPR scheme = reference code + 10
// 12 License Number          BARE, zero-padded, e.g. 0015061
// 13 Primary Status          C | P | S
// 14 Secondary Status        A | I | (blank)
// 15 Original Licensure Date MM/DD/YYYY
// 16 Effective Date          MM/DD/YYYY — no target column
// 17 Expiration Date         MM/DD/YYYY
// 18 Blank
// 19 Renewal Period          empty throughout this extract
// 20 Alternate Lic#          PREFIXED, e.g. CBC015061 — the public identifier
// 21 (unpublished)           empty throughout this extract
const F = {
  type: 1, name: 2, dba: 3, addr1: 5, addr2: 6, city: 8, state: 9, zip: 10,
  county: 11, licBare: 12, statusPrimary: 13, statusSecondary: 14,
  dateOriginal: 15, dateExpiration: 17, licPrefixed: 20,
};

// Source: https://www2.myfloridalicense.com/about-us/understanding-dbpr-codes/
const PRIMARY_STATUS = { C: "Current", P: "Probation", S: "Suspended" };
const SECONDARY_STATUS = { A: "Active", I: "Inactive" };

const clean = (s) => (s ?? "").trim();
const norm = (s) => clean(s).replace(/\s+/g, " ").toUpperCase();

/** MM/DD/YYYY -> YYYY-MM-DD. Null for anything else. */
function parseDate(s) {
  const v = clean(s);
  if (v.length !== 10 || v[2] !== "/" || v[5] !== "/") return null;
  const [mm, dd, yyyy] = [v.slice(0, 2), v.slice(3, 5), v.slice(6, 10)];
  if (!/^\d{2}$/.test(mm) || !/^\d{2}$/.test(dd) || !/^\d{4}$/.test(yyyy)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * DBPR county code -> reference_counties.county_code, by subtracting 10.
 * Verified against all 67 codes present in the extract (11=Alachua ..
 * 77=Washington). Anything outside 11-77 is an out-of-state registrant
 * (701=AL, 710=GA, 733=NC, 744=TX, 99=mixed) and gets NULL rather than a
 * fabricated Florida county.
 */
function translateCounty(raw) {
  const v = clean(raw);
  if (!/^\d{2}$/.test(v)) return null;
  const n = Number(v);
  if (n < 11 || n > 77) return null;
  return String(n - 10).padStart(2, "0");
}

/** Immutable across weekly extracts — see db/migrations/2026-07-29. */
const baseKey = (r) =>
  `${norm(r[F.type])}|${norm(r[F.licPrefixed])}|${norm(r[F.name])}|${norm(r[F.dateOriginal])}`;

function transform(r, collidingBases) {
  const dba = clean(r[F.dba]);
  const isBusiness = dba !== "" && dba.toUpperCase() !== "INDIVIDUAL";

  const base = baseKey(r);
  const key = collidingBases.has(base)
    ? `${base}#${createHash("sha1").update(r.join("|")).digest("hex").slice(0, 10)}`
    : base;

  // Address lines 1 and 2 only. Line 3 is dropped: 1,544 rows, and it holds
  // 'FL' / 'FLORIDA' / city names rather than street data.
  const address = [clean(r[F.addr1]), clean(r[F.addr2])].filter(Boolean).join(", ");

  return {
    dbpr_sync_key: key,
    license_number: clean(r[F.licPrefixed]) || null,
    license_number_raw: clean(r[F.licBare]) || null,
    license_type: clean(r[F.type]),
    business_name: isBusiness ? dba : null,
    qualifying_agent_name: clean(r[F.name]),
    is_business: isBusiness,
    address_line: address || null,
    city: clean(r[F.city]) || null,
    county_code: translateCounty(r[F.county]),
    state: clean(r[F.state]) || "FL",
    zip: clean(r[F.zip]) || null,
    license_status: PRIMARY_STATUS[clean(r[F.statusPrimary])] ?? null,
    license_status_secondary: SECONDARY_STATUS[clean(r[F.statusSecondary])] ?? null,
    original_license_date: parseDate(r[F.dateOriginal]),
    expiration_date: parseDate(r[F.dateExpiration]),
    disciplinary_codes: [], // this extract publishes none
  };
}

// ==========================================================

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : null; };

console.log(`reading ${CSV_PATH}`);
const rows = parse(readFileSync(CSV_PATH), {
  columns: false, skip_empty_lines: true, relax_column_count: true, bom: true,
});
console.log(`parsed ${rows.length.toLocaleString("en-US")} rows\n`);

// Pass 1 — find base keys that collide, so pass 2 can disambiguate them.
const seen = new Map();
for (const r of rows) { const b = baseKey(r); seen.set(b, (seen.get(b) ?? 0) + 1); }
const collidingBases = new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));

const parsed = rows.map((r) => transform(r, collidingBases));

// Audit BEFORE dedupe, so the collision count is still reported.
const keys = new Map();
for (const rec of parsed) keys.set(rec.dbpr_sync_key, (keys.get(rec.dbpr_sync_key) ?? 0) + 1);
const collisions = [...keys.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0);

/**
 * DEDUPE BY KEY BEFORE LOADING — not optional.
 *
 * Postgres rejects an INSERT ... ON CONFLICT DO UPDATE whose VALUES list
 * contains the same conflict key twice: "ON CONFLICT DO UPDATE command cannot
 * affect row a second time". A single upsert batch is one such statement, so
 * two byte-identical source rows landing in the same batch abort it.
 *
 * The first full run failed exactly this way at batch 57000. Measuring the 7
 * collisions was not the same as removing them.
 *
 * First occurrence wins; the duplicates are byte-identical, so which one
 * survives is immaterial.
 */
const byKey = new Map();
for (const rec of parsed) if (!byKey.has(rec.dbpr_sync_key)) byKey.set(rec.dbpr_sync_key, rec);
const records = [...byKey.values()];
const dropped = parsed.length - records.length;

const stats = {
  rowsParsed: parsed.length,
  distinctKeys: keys.size,
  keyCollisions: collisions,
  rowsDroppedAsDuplicate: dropped,
  rowsToLoad: records.length,
  nullLicenseNumber: records.filter((r) => !r.license_number).length,
  nullCity: records.filter((r) => !r.city).length,
  nullCounty: records.filter((r) => !r.county_code).length,
  nullStatus: records.filter((r) => !r.license_status).length,
  nullOriginalDate: records.filter((r) => !r.original_license_date).length,
  nullExpiration: records.filter((r) => !r.expiration_date).length,
  isBusinessTrue: records.filter((r) => r.is_business).length,
};
console.log("TRANSFORM AUDIT");
for (const [k, v] of Object.entries(stats)) {
  console.log(`  ${k.padEnd(20)} ${typeof v === "number" ? v.toLocaleString("en-US") : v}`);
}
console.log();

if (flag("--count-only")) process.exit(0);

if (flag("--preview")) {
  const n = value("--preview") ?? 20;
  console.log(JSON.stringify(records.slice(0, n), null, 2));
  process.exit(0);
}

// ---- DB write path ----
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const limit = value("--limit");
let toLoad = records;
if (limit) {
  toLoad = records.slice(0, limit);
  // The dry run must include the Aceca verification row.
  const ACECA = "CGC1520921";
  if (!toLoad.some((r) => r.license_number === ACECA)) {
    const extra = records.find((r) => r.license_number === ACECA);
    if (extra) { toLoad = [...toLoad, extra]; console.log(`added ${ACECA} as verification row ${toLoad.length}\n`); }
  }
}

console.log(`upserting ${toLoad.length.toLocaleString("en-US")} rows in batches of ${BATCH_SIZE}`);
const started = Date.now();
let done = 0;
for (let i = 0; i < toLoad.length; i += BATCH_SIZE) {
  const batch = toLoad.slice(i, i + BATCH_SIZE);
  const { error } = await db
    .from("contractors")
    .upsert(batch.map((r) => ({ ...r, last_dbpr_sync_at: new Date().toISOString() })),
            { onConflict: "dbpr_sync_key", ignoreDuplicates: false });
  if (error) { console.error(`\nBATCH ${i} FAILED: ${error.message}`); process.exit(1); }
  done += batch.length;
  if ((i / BATCH_SIZE) % 10 === 0 || done === toLoad.length) {
    console.log(`  ${done.toLocaleString("en-US")}/${toLoad.length.toLocaleString("en-US")}`);
  }
}
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
