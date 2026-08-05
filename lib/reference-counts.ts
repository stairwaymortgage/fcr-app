import type { createClient } from "@/lib/supabase/server";

/**
 * Reference-table count drift — the check that /counties and /types are not
 * quietly serving last week's figures.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS. reference_counties.contractor_count and
 * reference_license_types.contractor_count are PRE-COMPUTED integers, written
 * by db/migrations/20260805_reference_counts_repair.sql and read directly by
 * the public browse pages. The importer does not update them — it upserts
 * contractors and writes its sync_runs row, and stops.
 *
 * So every DBPR refresh invalidates them, and NOTHING enforces the repair. The
 * failure is silent by construction: /counties and /types render stale integers
 * with no visible symptom, and the only way to find out was to run
 * scripts/verify-counts.mjs by hand. That is exactly how reference_license_types
 * came to read 0 for all 29 rows for five weeks.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ THIS IS A SUM CHECK, NOT THE PER-ROW CHECK. Read the limitation below
 * before treating "in agreement" as proof.
 */

type Db = ReturnType<typeof createClient>;

export interface CountCheck {
  /** Σ of the stored contractor_count column. */
  stored: number;
  /** The same quantity counted live against contractors. */
  live: number;
  /** How many reference rows were summed. */
  rows: number;
  drifted: boolean;
}

export interface ReferenceCountReport {
  counties: CountCheck | null;
  types: CountCheck | null;
  /** True when every check that ran agrees. Null checks do not count as drift. */
  ok: boolean;
  /** A check could not be run — treated as unknown, never as "fine". */
  error: string | null;
}

/**
 * Both invariants, in four queries.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ A SUM CHECK IS NECESSARY, NOT SUFFICIENT.
 *
 * Two compensating per-row errors — Broward reading 5 too high and Duval 5 too
 * low — sum correctly and pass this. scripts/verify-counts.mjs compares all 806
 * rows INDIVIDUALLY and is the real check; this is the one cheap enough to run
 * on every page load.
 *
 * That trade is deliberate. The failure this catches is the one that actually
 * happens: a refresh lands, every count moves, and nobody re-runs the repair.
 * A compensating pair of errors is not a mode this system has — the repair
 * writes all rows from one GROUP BY or none.
 *
 * The page must therefore say "in agreement", never "correct", and point at the
 * script for the exact answer.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY SUM EQUALITY IS EXACT FOR THESE TWO TABLES:
 *
 *   counties  Every Florida-addressed contractor with a county_code belongs to
 *             exactly one county, and reference_counties holds all 67 codes
 *             the importer can produce (translateCounty yields 01-67 or null).
 *             So Σ stored must equal count(state='FL' AND county_code NOT NULL).
 *
 *   types     Σ stored must equal count(license_type IN <the reference codes>).
 *             NOT count(*) — 154,051 rows carry a code with no reference row
 *             (QB, FRO and nine others), and that gap is the open taxonomy
 *             decision, not drift. Filtering to the known codes is what makes
 *             this an equality rather than an inequality.
 *
 * CITIES ARE NOT CHECKED HERE, and that is a size limit rather than an
 * oversight. The equivalent invariant needs count(state='FL' AND city IN <710
 * names>) — a 710-value filter in a GET query string, which is a ~10KB URL on
 * every page load. reference_cities measured 0 of 710 wrong on 2026-08-05 and
 * has no writer other than the repair, so it drifts in lockstep with the other
 * two: if these two agree, cities were repaired in the same run. The script
 * checks all 710 exactly.
 */
export async function checkReferenceCounts(db: Db): Promise<ReferenceCountReport> {
  try {
    const [countyRows, typeRows] = await Promise.all([
      db.from("reference_counties").select("contractor_count"),
      db.from("reference_license_types").select("type_code, contractor_count"),
    ]);

    if (countyRows.error) throw new Error(`reference_counties: ${countyRows.error.message}`);
    if (typeRows.error) throw new Error(`reference_license_types: ${typeRows.error.message}`);

    const codes = (typeRows.data ?? []).map((r) => r.type_code as string);

    const [countyLive, typeLive] = await Promise.all([
      db
        .from("contractors")
        .select("dbpr_sync_key", { count: "exact", head: true })
        .eq("state", "FL")
        .not("county_code", "is", null),
      // 29 values — a short filter, unlike the 710 cities would be.
      codes.length
        ? db
            .from("contractors")
            .select("dbpr_sync_key", { count: "exact", head: true })
            .in("license_type", codes)
        : Promise.resolve({ count: 0, error: null }),
    ]);

    if (countyLive.error) throw new Error(`county live count: ${countyLive.error.message}`);
    if (typeLive.error) throw new Error(`type live count: ${typeLive.error.message}`);

    const sum = (rows: { contractor_count: number | null }[]) =>
      rows.reduce((total, r) => total + (r.contractor_count ?? 0), 0);

    const counties: CountCheck = {
      stored: sum(countyRows.data ?? []),
      live: countyLive.count ?? 0,
      rows: (countyRows.data ?? []).length,
      drifted: false,
    };
    counties.drifted = counties.stored !== counties.live;

    const types: CountCheck = {
      stored: sum(typeRows.data ?? []),
      live: typeLive.count ?? 0,
      rows: (typeRows.data ?? []).length,
      drifted: false,
    };
    types.drifted = types.stored !== types.live;

    return {
      counties,
      types,
      ok: !counties.drifted && !types.drifted,
      error: null,
    };
  } catch (err) {
    /**
     * An unmeasurable check is reported as unmeasurable. `ok: false` with a
     * null pair is the "we could not look" state, and the page renders it
     * differently from "we looked and they agree" — the same rule
     * lib/sync-runs.ts applies to null vs zero counts.
     */
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reference-counts] check failed", message);
    return { counties: null, types: null, ok: false, error: message };
  }
}

/** The command that fixes drift, and the one that proves it exactly. */
export const REPAIR_MIGRATION = "db/migrations/20260805_reference_counts_repair.sql";
export const VERIFY_COMMAND = "node scripts/verify-counts.mjs --verbose";
