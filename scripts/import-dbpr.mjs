/**
 * DBPR import — parser, loader, and the writer of the sync_runs audit row.
 *
 * Replaces the transform in _handoff/09_dbpr_ingestion/sync_dbpr.ts, whose
 * documented column layout matches no file we have. Written against the
 * OFFICIAL layout published at
 * https://www2.myfloridalicense.com/construction-industry/public-records/
 * and verified field-by-field against the real 266,312-row extract.
 *
 *   node scripts/import-dbpr.mjs --count-only     collision audit, no DB
 *   node scripts/import-dbpr.mjs --preview 20     transform preview, no DB
 *   node scripts/import-dbpr.mjs --census-only    what WOULD change; reads, never writes
 *   node scripts/import-dbpr.mjs --limit 20       insert first 20 rows, NO audit row
 *   node scripts/import-dbpr.mjs --no-diff        full import, skip the change census
 *   node scripts/import-dbpr.mjs                  full import
 *
 * Never prints credential values.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS SCRIPT IS THE ONLY WRITER OF sync_runs, AND /admin/sync IS ITS ONLY
 * READER.
 *
 * Before task 157 the table had zero rows and had never had one: the initial
 * import ran from this file, which upserted 266,305 contractors and recorded
 * nothing about having done so. That is why lib/registry-stats.ts carried a
 * hard-coded "data as of" date for five weeks — there was no run to ask.
 *
 * A row is opened 'running' before the CSV is parsed and closed 'success' or
 * 'failed' on the way out, including when the parse itself throws. A run that
 * dies without closing its row leaves it 'running', and /admin/sync says so
 * rather than treating the absence of a completion as a success.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ --limit WRITES NO AUDIT ROW, DELIBERATELY. A 20-row load is not a refresh,
 * and recording it as one would (a) report 266,285 orphans, since every row the
 * subset did not touch looks abandoned, and (b) move the public "Data as of"
 * date on every page — see lib/data-as-of.ts. It still bumps last_dbpr_sync_at
 * on the rows it does touch, so --preview is the safer shape check.
 */
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const CSV_PATH = "_handoff/07_source_data/CONSTRUCTIONLICENSE_1.csv";

/**
 * ⚠ 500, REDUCED FROM 1000 ON 2026-08-06 AFTER A STATEMENT TIMEOUT AT BATCH
 * 54000 ON A FULL RUN.
 *
 * A 1000-row upsert is a single statement holding 1000 row locks and rewriting
 * every index entry for each of them; against the pooled connection Supabase
 * gives this script it was crossing the statement timeout partway through a
 * long run — not on any particular row, but as cumulative index bloat and
 * autovacuum lag made each batch dearer than the last. Halving the batch halves
 * the work inside one statement, which is the unit the timeout applies to.
 *
 * IF 500 STILL TIMES OUT, THIS IS THE KNOB — lower it before reaching for
 * anything cleverer. Doubling the batch count costs round trips, which are
 * cheap; exceeding the statement timeout costs the whole run.
 */
const BATCH_SIZE = 500;

/**
 * The touch phase batches SMALLER, and not for the same reason.
 *
 * A PATCH filters in the QUERY STRING — `?dbpr_sync_key=in.(k1,k2,…)` — so the
 * batch size here is bounded by URL length, not by statement cost. 500 keys of
 * ~25 characters is a 12KB URL, past what proxies and PostgREST will accept; at
 * 200 it is under 5KB with room to spare. This is a transport limit and has
 * nothing to do with the timeout above.
 */
const TOUCH_BATCH_SIZE = 200;

/**
 * Retry with exponential backoff — for TRANSIENT failures only.
 *
 * ⚠ THE ALLOWLIST IS THE POINT. Retrying a deterministic error is not
 * resilience, it is three identical failures and a longer wait before the same
 * message: a duplicate key (23505) will conflict every time, a missing column
 * (42703) will be missing every time. Only faults that can plausibly succeed on
 * a second attempt are retried — the statement timeout this batch size exists
 * to avoid, connection drops, and serialization failures.
 *
 * A network-level throw arrives with no `code` at all (fetch failed, socket
 * hang up), and those are retried too.
 */
const RETRYABLE = new Set([
  "57014", // statement timeout — the failure at batch 54000
  "40001", // serialization failure
  "40P01", // deadlock detected
  "53300", // too many connections
  "08000", "08003", "08006", // connection exception / does not exist / failure
  "XX000", // internal error; sometimes wraps a pooler reset
]);

async function withRetry(label, attempt) {
  const MAX_ATTEMPTS = 4;
  for (let n = 1; ; n++) {
    const error = await attempt();
    if (!error) return;

    const retryable = !error.code || RETRYABLE.has(error.code);
    if (!retryable || n === MAX_ATTEMPTS) {
      throw new Error(
        `${label} failed${error.code ? ` [${error.code}]` : ""} after ${n} attempt(s): ${error.message}`,
      );
    }

    // 1s, 2s, 4s. Long enough for a pooler to recover, short enough that a run
    // that is going to fail does not take an extra ten minutes to say so.
    const waitMs = 1000 * 2 ** (n - 1);
    console.log(
      `  ⚠ ${label}: ${error.code ?? "network"} — ${error.message}\n` +
      `    retrying in ${waitMs / 1000}s (attempt ${n + 1}/${MAX_ATTEMPTS})`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/**
 * Rows per page when reading existing keys back for the change census, and how
 * many of those pages are in flight at once.
 *
 * 1000 is PostgREST's own ceiling, so a larger number silently truncates. Six
 * concurrent pages reads 266k fingerprints in about a minute; more than that
 * starts competing with the upsert for the same connection pool.
 */
const READ_PAGE = 1000;
const READ_CONCURRENCY = 6;

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
// THE CHANGE CENSUS
// ==========================================================
//
// sync_runs wants records_inserted / records_updated / records_unchanged, and
// an upsert cannot tell you which it did — PostgREST returns no per-row verdict
// and `ON CONFLICT DO UPDATE` reports every row as written whether or not any
// value moved. So the classification has to happen BEFORE the upsert, against
// what is already in the table.
//
// Reading 266,305 whole rows back to compare them field-by-field would hold
// roughly half a gigabyte of objects in memory. Instead each existing row is
// reduced, as it arrives, to a short fingerprint of the columns this script
// writes; the row itself is discarded. That is ~30MB for the whole table.
//
//   key absent from the map      -> inserted
//   key present, same print      -> unchanged
//   key present, different print -> updated
//
// ⚠ THE FINGERPRINT COLUMN LIST MUST MATCH WHAT THE UPSERT SENDS. Add a column
// to transform() without adding it here and every row carrying that column will
// be reported 'unchanged' while its value is quietly rewritten. last_dbpr_sync_at
// is excluded on purpose — it moves on every run by design, and including it
// would make every row 'updated' forever.
const FINGERPRINT_COLUMNS = [
  "license_number", "license_number_raw", "license_type", "business_name",
  "qualifying_agent_name", "is_business", "address_line", "city", "county_code",
  "state", "zip", "license_status", "license_status_secondary",
  "original_license_date", "expiration_date", "disciplinary_codes",
];

/**
 * Same value in, same string out, for both a transformed record and a row read
 * back from PostgREST. JSON.stringify over a fixed column order rather than
 * Object.values(), because key order is not a contract and `undefined` and
 * `null` must not fingerprint differently — the DB only ever returns null.
 */
const fingerprint = (row) =>
  JSON.stringify(FINGERPRINT_COLUMNS.map((c) => row[c] ?? null));

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * Every dbpr_sync_key currently in the table, mapped to its fingerprint.
 *
 * Paged by range over an ORDERED read. Ordering is not decoration: PostgREST
 * gives no stability guarantee for an unordered range, so paging without it can
 * return the same row twice and skip another.
 */
async function loadFingerprints(db, onProgress) {
  const { count, error: countError } = await db
    .from("contractors")
    .select("dbpr_sync_key", { count: "exact", head: true });
  if (countError) throw new Error(`counting contractors: ${countError.message}`);

  const pages = [];
  for (let from = 0; from < (count ?? 0); from += READ_PAGE) pages.push(from);

  const map = new Map();
  let done = 0;
  await mapLimit(pages, READ_CONCURRENCY, async (from) => {
    const { data, error } = await db
      .from("contractors")
      .select(["dbpr_sync_key", ...FINGERPRINT_COLUMNS].join(", "))
      .order("dbpr_sync_key", { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (error) throw new Error(`reading existing rows at ${from}: ${error.message}`);
    for (const row of data) map.set(row.dbpr_sync_key, fingerprint(row));
    done += data.length;
    onProgress?.(done, count ?? 0);
  });

  return map;
}

// ==========================================================
// sync_runs — the audit row
// ==========================================================

/**
 * SOURCE IS THE LOCAL FILE, AND THE ROW SAYS SO.
 *
 * This script reads a CSV from disk. Whatever that file's ultimate origin, the
 * only thing THIS RUN can attest to is the path it opened — so that is what it
 * records. sync_runs.source_url defaults to a DBPR download URL, and stamping
 * that default would claim a network fetch that never happened.
 *
 * ⚠ WHERE THE FILE CAME FROM IS DOCUMENTED, AND AN EARLIER VERSION OF THIS
 * COMMENT WAS WRONG ABOUT IT TWICE.
 *
 * It said the extract "was handed to us and committed under
 * _handoff/07_source_data" and that its origin was an open question. Neither
 * holds up:
 *
 *   · NOT COMMITTED. _handoff/ is in .gitignore (line 49) and has zero tracked
 *     files. The CSV has no git provenance at all — it exists only on machines
 *     someone copied it to.
 *
 *   · NOT UNKNOWN. _handoff/06_specifications/…_DBPR_Ingestion_Script.docx,
 *     prepared May 2026, states it was "downloaded from the DBPR public records
 *     portal", names the source URL, and says DBPR refreshes it weekly at the
 *     same address. Its stated row count (266,312) matches this file exactly,
 *     so that document was written from this extract.
 *
 * THE CANONICAL URL, and the env var name for it when --download lands:
 *
 *     DBPR_CSV_URL=https://www2.myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONLICENSE_1.csv
 *
 * Three hostnames appear across the handoff and only www2 is live. Measured
 * 2026-08-05: the bare host redirects (BigIP → www → www2) and serves no files;
 * www.myfloridalicense.com is a separate IIS server that 404s this path; www2
 * is the current site. The DEFAULT on sync_runs.source_url uses the bare host
 * and is therefore not a working file URL — do not copy it.
 *
 * ⚠ AND THE URL IS NOT FETCHABLE BY A SCRIPT TODAY. www2 sits behind a
 * Cloudflare managed challenge — `Cf-Mitigated: challenge`, "Just a moment…",
 * JavaScript required — applied site-wide, including the root and the
 * human-facing public-records page. A plain fetch() gets 403 whether it runs
 * from here, from Vercel, or from a CI runner. That is a constraint on any
 * automated refresh, not a detail: see the note above --download.
 */
const SOURCE_URI = `file:${CSV_PATH}`;

/**
 * Claim the oldest queued refresh, or open a fresh row if nobody asked.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE QUEUE EXISTS BECAUSE THE PERSON WHO WANTS A REFRESH AND THE PERSON WHO
 * CAN RUN ONE ARE NOT THE SAME PERSON.
 *
 * /admin/sync writes status='queued' with the requester's user id; this picks
 * it up. Running the script directly still works exactly as before — an unasked
 * refresh is a perfectly good refresh — it just opens its own row.
 *
 * CLAIMED WITH A COMPARE-AND-SWAP, not a bare update. The filter repeats
 * `.eq("status", "queued")` so that if two importers start together, the second
 * one's update matches zero rows and it falls through to opening its own row
 * rather than both writing counts into the same audit record. PostgREST returns
 * the updated rows, so an empty array IS the "somebody beat me to it" signal.
 *
 * started_at is RESET here. On a queued row it held the request time (the
 * column is NOT NULL DEFAULT now()), and leaving it would make
 * completed_at - started_at report the run duration plus however long the
 * request sat waiting — a refresh queued Friday and run Monday would show a
 * three-day duration. queued_at keeps the request time; see
 * db/migrations/20260805_sync_runs_queued.sql.
 * ═══════════════════════════════════════════════════════════════════════════
 */
async function startRun(db, { sourceBytes, sourceHash }) {
  const provenance = {
    source_url: SOURCE_URI,
    source_file_size: sourceBytes,
    source_file_hash: sourceHash,
  };

  const { data: queued, error: queueError } = await db
    .from("sync_runs")
    .select("id, queued_at")
    .eq("status", "queued")
    .order("queued_at", { ascending: true, nullsFirst: false })
    .limit(1);

  /**
   * A missing 'queued' status means the migration has not been applied. That is
   * not fatal — the importer's own path never needed it — so it warns and
   * carries on rather than refusing to refresh the registry over a feature it
   * is not using.
   */
  if (queueError) {
    console.warn(`⚠ could not check the refresh queue: ${queueError.message}`);
    console.warn("  opening a fresh run instead. Has 20260805_sync_runs_queued.sql been applied?\n");
  }

  if (!queueError && queued?.length) {
    const { data: claimed, error: claimError } = await db
      .from("sync_runs")
      .update({ status: "running", started_at: new Date().toISOString(), ...provenance })
      .eq("id", queued[0].id)
      .eq("status", "queued")
      .select("id, started_at, queued_at")
      .maybeSingle();

    if (claimError) {
      throw new Error(`could not claim queued run ${queued[0].id}: ${claimError.message}`);
    }
    if (claimed) {
      const waited = claimed.queued_at
        ? Math.round((new Date(claimed.started_at) - new Date(claimed.queued_at)) / 1000)
        : null;
      console.log(
        `claimed queued refresh ${claimed.id}` +
        (waited === null ? "" : ` · requested ${waited}s ago`),
      );
      return claimed;
    }
    console.warn("⚠ the queued run was claimed by someone else — opening a fresh row\n");
  }

  const { data, error } = await db
    .from("sync_runs")
    .insert({
      status: "running",
      triggered_by: "manual",
      // triggered_by_user_id stays null on a directly-run import: a CLI run has
      // no session, and inventing one would put a name against work nobody
      // signed in to do. A row CLAIMED from the queue keeps the requester's id,
      // which is the whole point of that column.
      ...provenance,
    })
    .select("id, started_at")
    .single();
  if (error) throw new Error(`could not open sync_runs row: ${error.message}`);
  return data;
}

async function completeRun(db, id, counts) {
  const { error } = await db
    .from("sync_runs")
    .update({ status: "success", completed_at: new Date().toISOString(), ...counts })
    .eq("id", id);
  if (error) console.error(`\n⚠ run finished but sync_runs update failed: ${error.message}`);
}

/**
 * Close the row as failed. Swallows its own error and reports it — a failure to
 * record a failure must not replace the original error in the operator's face.
 */
async function failRun(db, id, err) {
  const { error } = await db
    .from("sync_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: String(err?.message ?? err).slice(0, 2000),
      error_stack: String(err?.stack ?? "").slice(0, 20000),
    })
    .eq("id", id);
  if (error) console.error(`⚠ could not record the failure: ${error.message}`);
}

// ==========================================================

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : null; };

/**
 * Read and fingerprint the source file BEFORE anything else, so that a run
 * which dies during parsing still has real provenance on its audit row. 46MB
 * through SHA-256 is a third of a second.
 */
console.log(`reading ${CSV_PATH}`);
const sourceBuffer = readFileSync(CSV_PATH);
const sourceBytes = statSync(CSV_PATH).size;
const sourceHash = createHash("sha256").update(sourceBuffer).digest("hex");
console.log(`  ${(sourceBytes / 1e6).toFixed(1)} MB · sha256 ${sourceHash.slice(0, 16)}…`);

/** Parse + transform + dedupe. Everything up to "ready to upsert". */
function prepare() {
  const rows = parse(sourceBuffer, {
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

  return records;
}

// ---- dry paths: parse, report, touch nothing ----
if (flag("--count-only")) { prepare(); process.exit(0); }

if (flag("--preview")) {
  const records = prepare();
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

/**
 * --census-only: answer "what would this refresh change?" and write nothing.
 *
 * Reads the existing fingerprints and classifies the extract against them —
 * the whole of the counting work, with the upsert and the audit row left out.
 * That makes the change census independently checkable, which matters because
 * its numbers are the ones /admin/sync reports and nobody can eyeball 266,305
 * rows to see whether they are right.
 *
 * It is also the honest way to inspect a refresh that is being held: the
 * question "how much has DBPR changed since July" is answerable without
 * committing to the load.
 */
if (flag("--census-only")) {
  const records = prepare();
  console.log("reading existing keys…");
  const existing = await loadFingerprints(db, (done, total) => {
    if (done % 50_000 < READ_PAGE) {
      console.log(`  ${done.toLocaleString("en-US")}/${total.toLocaleString("en-US")}`);
    }
  });

  let inserted = 0, updated = 0, unchanged = 0;
  for (const rec of records) {
    const before = existing.get(rec.dbpr_sync_key);
    if (before === undefined) inserted++;
    else if (before === fingerprint(rec)) unchanged++;
    else updated++;
  }
  const loadedKeys = new Set(records.map((r) => r.dbpr_sync_key));
  let orphaned = 0;
  for (const key of existing.keys()) if (!loadedKeys.has(key)) orphaned++;

  const n = (x) => x.toLocaleString("en-US");
  console.log(
    `\nCHANGE CENSUS (nothing written)\n` +
    `  in the table now  ${n(existing.size)}\n` +
    `  in the extract    ${n(records.length)}\n` +
    `  ----\n` +
    `  inserted          ${n(inserted)}\n` +
    `  updated           ${n(updated)}\n` +
    `  unchanged         ${n(unchanged)}\n` +
    `  orphaned          ${n(orphaned)}  (counted, never deleted)\n`,
  );
  // The identity that must hold, checked rather than asserted in a comment.
  const ok = inserted + updated + unchanged === records.length;
  console.log(
    ok
      ? "  inserted + updated + unchanged === extract rows ✓"
      : `  ⚠ MISMATCH: ${n(inserted + updated + unchanged)} classified vs ${n(records.length)} rows`,
  );
  process.exit(ok ? 0 : 1);
}

const limit = value("--limit");
const isPartial = Boolean(limit);

/**
 * Partial loads get no audit row — see the file docblock. The warning is loud
 * because the failure mode is silent: the load succeeds, the page shows nothing
 * new, and the reason is a flag typed forty minutes earlier.
 */
const run = isPartial ? null : await startRun(db, { sourceBytes, sourceHash });
if (run) {
  console.log(`sync_runs ${run.id} opened · started_at ${run.started_at}\n`);
} else {
  console.log("⚠ --limit: partial load, NO sync_runs row will be written\n");
}

const started = Date.now();

try {
  const records = prepare();

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

  /**
   * The census, read before a single row is written. Skippable with --no-diff,
   * in which case the three count columns stay NULL rather than being guessed —
   * /admin/sync renders "not measured" for a null and "0" for a zero, and those
   * are different claims.
   */
  let census = null;
  let orphaned = null;
  /**
   * The three work lists. Null (not empty) when there is no census to build
   * them from — --no-diff or a partial run — which the load below reads as
   * "you cannot know what changed, so write everything".
   */
  let toInsert = null;
  let toUpdate = null;
  let toTouch = null;
  if (!isPartial && !flag("--no-diff")) {
    console.log("reading existing keys for the change census…");
    const existing = await loadFingerprints(db, (done, total) => {
      if (done % 50_000 < READ_PAGE) {
        console.log(`  ${done.toLocaleString("en-US")}/${total.toLocaleString("en-US")}`);
      }
    });

    /**
     * The census now produces the WORK LISTS, not just the counts.
     *
     * Same classification as before and the same three numbers come out of it —
     * but the records are kept, partitioned, so the load below can write only
     * what actually changed and merely re-stamp the rest. On a typical weekly
     * extract the unchanged pile is the overwhelming majority, and it is the
     * one that used to be rewritten in full for no reason.
     */
    toInsert = [];
    toUpdate = [];
    toTouch = [];
    for (const rec of toLoad) {
      const before = existing.get(rec.dbpr_sync_key);
      if (before === undefined) toInsert.push(rec);
      else if (before === fingerprint(rec)) toTouch.push(rec.dbpr_sync_key);
      else toUpdate.push(rec);
    }
    census = {
      inserted: toInsert.length,
      updated: toUpdate.length,
      unchanged: toTouch.length,
    };

    /**
     * Orphans: in the table, absent from this extract. COUNTED, NEVER DELETED —
     * contractors.claimed_by_user_id cascades into claims, so removing a row
     * that DBPR merely stopped publishing would destroy the claim and its
     * evidence. /admin/sync reports the same figure from the other direction,
     * off last_dbpr_sync_at, which is the cross-check.
     */
    const loadedKeys = new Set(toLoad.map((r) => r.dbpr_sync_key));
    orphaned = 0;
    for (const key of existing.keys()) if (!loadedKeys.has(key)) orphaned++;

    console.log(
      `\nCHANGE CENSUS\n` +
      `  inserted   ${census.inserted.toLocaleString("en-US")}\n` +
      `  updated    ${census.updated.toLocaleString("en-US")}\n` +
      `  unchanged  ${census.unchanged.toLocaleString("en-US")}\n` +
      `  orphaned   ${orphaned.toLocaleString("en-US")}  (counted, never deleted)\n`,
    );
  } else if (!isPartial) {
    console.log("--no-diff: skipping the change census, counts will be recorded as NULL\n");
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * THE LOAD, IN PHASES: insert → update → touch-unchanged → complete.
   *
   * ⚠ EVERY ROW IN THE EXTRACT STILL ENDS THE RUN WITH last_dbpr_sync_at MOVED
   * FORWARD, INCLUDING THE UNCHANGED ONES. That invariant has not been relaxed;
   * only the way it is achieved has. Orphan detection is defined as a stamp
   * older than the newest successful run, so a row in the extract that finished
   * a successful run unstamped would be reported as an abandoned licence. What
   * changed is that unchanged rows get a one-column UPDATE instead of a full
   * rewrite of sixteen columns they already hold.
   *
   * WHY TOUCH-UNCHANGED RUNS LAST, AND WHY THAT ORDERING IS SAFE RATHER THAN
   * MERELY TIDY:
   *
   * The failure being designed against is a run that dies halfway. Stamp first
   * and die during the writes, and rows are stamped as of this run while still
   * holding last week's values — the timestamp claims a freshness the data does
   * not have, and nothing afterwards can tell. Stamp last and die, and some
   * rows are correct-but-unstamped, which is the recoverable direction.
   *
   * IT IS SAFE BECAUSE A FAILED RUN NEVER BECOMES THE BASELINE. lib/sync-runs.ts
   * defines an orphan against the newest SUCCESSFUL run. A crash here closes
   * sync_runs as 'failed' (see the catch block), so the baseline stays where the
   * last good run left it — and against THAT baseline every row is still stamped,
   * because that run stamped them all. The half-finished state is invisible to
   * the census rather than a lie inside it.
   *
   * AND THE RE-RUN RECONCILES. The census is recomputed from live fingerprints
   * every time, so rows written before the crash come back classified
   * 'unchanged' and land in the touch phase. Nothing needs to remember where the
   * previous attempt stopped. Re-running is always correct and never doubles
   * anything.
   * ═══════════════════════════════════════════════════════════════════════════
   */

  /**
   * ONE TIMESTAMP FOR THE WHOLE RUN, not new Date() per batch.
   *
   * The old code stamped each batch at the moment it was written, which spread
   * a long run's stamps across however many minutes it took. Orphan detection
   * compares against a run boundary, so a single value makes "stamped by this
   * run" an exact equality rather than a range that has to be reasoned about.
   */
  const runStamp = new Date().toISOString();

  /** Upsert one list in batches, with backoff. Used by both write phases. */
  async function loadPhase(label, records) {
    if (records.length === 0) {
      console.log(`${label}: nothing to do`);
      return;
    }
    console.log(
      `${label}: ${records.length.toLocaleString("en-US")} rows in batches of ${BATCH_SIZE}`,
    );
    let done = 0;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      await withRetry(`${label} batch at offset ${i}`, async () => {
        const { error } = await db
          .from("contractors")
          .upsert(
            batch.map((r) => ({ ...r, last_dbpr_sync_at: runStamp })),
            { onConflict: "dbpr_sync_key", ignoreDuplicates: false },
          );
        return error;
      });
      done += batch.length;
      if ((i / BATCH_SIZE) % 20 === 0 || done === records.length) {
        console.log(`  ${done.toLocaleString("en-US")}/${records.length.toLocaleString("en-US")}`);
      }
    }
  }

  if (toInsert === null) {
    /**
     * No census — --no-diff, or a partial run. Without one there is no way to
     * know which rows changed, so every row is written exactly as before. This
     * path is the pre-2026-08-06 behaviour, kept intact rather than approximated.
     */
    console.log(
      `no census available: upserting all ${toLoad.length.toLocaleString("en-US")} rows`,
    );
    await loadPhase("PHASE all", toLoad);
  } else {
    await loadPhase("PHASE 1 insert", toInsert);
    await loadPhase("PHASE 2 update", toUpdate);

    // ---- PHASE 3 — touch-unchanged ----
    //
    // One column, by key. This is the phase the whole restructure exists for:
    // on a quiet week it is the great majority of the table, and rewriting all
    // sixteen columns of it was most of what the run was spending its statement
    // timeout on.
    if (toTouch.length === 0) {
      console.log("PHASE 3 touch-unchanged: nothing to do");
    } else {
      console.log(
        `PHASE 3 touch-unchanged: ${toTouch.length.toLocaleString("en-US")} rows ` +
        `in batches of ${TOUCH_BATCH_SIZE}`,
      );
      let touched = 0;
      for (let i = 0; i < toTouch.length; i += TOUCH_BATCH_SIZE) {
        const keys = toTouch.slice(i, i + TOUCH_BATCH_SIZE);
        await withRetry(`touch batch at offset ${i}`, async () => {
          const { error } = await db
            .from("contractors")
            .update({ last_dbpr_sync_at: runStamp })
            .in("dbpr_sync_key", keys);
          return error;
        });
        touched += keys.length;
        if ((i / TOUCH_BATCH_SIZE) % 50 === 0 || touched === toTouch.length) {
          console.log(`  ${touched.toLocaleString("en-US")}/${toTouch.length.toLocaleString("en-US")}`);
        }
      }
    }

    /**
     * THE PHASES MUST ACCOUNT FOR EVERY ROW IN THE EXTRACT.
     *
     * A row that fell through all three would finish a SUCCESSFUL run unstamped
     * and be counted as an orphan next week — a silent, plausible-looking
     * miscount rather than a crash. Cheap to assert, so it is asserted rather
     * than reasoned about.
     */
    const accounted = toInsert.length + toUpdate.length + toTouch.length;
    if (accounted !== toLoad.length) {
      throw new Error(
        `phase accounting mismatch: ${accounted} across phases vs ${toLoad.length} in the extract`,
      );
    }
  }

  if (run) {
    await completeRun(db, run.id, {
      records_total: toLoad.length,
      records_inserted: census?.inserted ?? null,
      records_updated: census?.updated ?? null,
      records_unchanged: census?.unchanged ?? null,
      records_orphaned: orphaned,
    });
    console.log(`\nsync_runs ${run.id} closed 'success'`);
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  /**
   * The reference counts are NOT refreshed here. /counties, /cities and /types
   * read stored integers that this script has just invalidated — run
   * db/migrations/20260805_reference_counts_repair.sql next, then
   * `node scripts/verify-counts.mjs` to confirm. Automating it from here needs
   * a decision about running SQL from Node that has not been taken.
   */
  /**
   * BUST THE CACHED LISTING PAGES.
   *
   * /, /counties, /cities and /types render statically with a 24-hour
   * revalidate as of 2026-08-07. The import just moved every number on them, so
   * without this the site advertises last week's counts for up to a day after
   * the run that replaced them.
   *
   * ⚠ BEST EFFORT, AND DELIBERATELY CANNOT FAIL THE IMPORT. The data is already
   * committed and sync_runs is already closed 'success' by this point. A site
   * that is up-to-date but serving a stale page for a few hours is a far smaller
   * problem than an import reported as failed because a cache ping did not land
   * — someone would re-run a two-hour job over it.
   *
   * Skipped quietly when the two variables are absent, which is the normal state
   * for a local run against a dev database: there is no deployment to revalidate.
   */
  const revalidateBase = process.env.NEXT_PUBLIC_SITE_URL;
  const revalidateSecret = process.env.CRON_SECRET;
  if (revalidateBase && revalidateSecret) {
    const url = `${revalidateBase.replace(/\/+$/, "")}/api/revalidate-listings`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${revalidateSecret}` },
        signal: AbortSignal.timeout(15_000),
      });
      // A 404 here is the endpoint refusing the secret, not a missing route —
      // it answers 404 on a bad secret by design. Named, because "404" would
      // otherwise read as "not deployed yet".
      console.log(
        res.ok
          ? "listing pages revalidated"
          : `listing revalidation refused (HTTP ${res.status}` +
            `${res.status === 404 ? " — wrong or missing CRON_SECRET?" : ""})`,
      );
    } catch (err) {
      console.warn(`listing revalidation failed: ${String(err).slice(0, 200)}`);
    }
  } else {
    console.log(
      "listing revalidation skipped (NEXT_PUBLIC_SITE_URL / CRON_SECRET not set)",
    );
  }

  console.log(
    "\nNEXT: run db/migrations/20260805_reference_counts_repair.sql, then\n" +
    "      node scripts/verify-counts.mjs",
  );
} catch (err) {
  console.error(`\nIMPORT FAILED: ${err.message}`);
  if (run) {
    await failRun(db, run.id, err);
    console.error(`sync_runs ${run.id} closed 'failed'`);
  }
  process.exitCode = 1;
}
