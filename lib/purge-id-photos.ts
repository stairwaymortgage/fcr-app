import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ⚠ NO PROJECT IMPORTS IN THIS FILE. NOT "@/lib/claims", NOT "./claims".
 *
 * scripts/verify-id-photo-purge.mjs loads this module directly with
 * --experimental-strip-types, so that it tests the shipped code rather than a
 * copy of it. That puts two constraints on what this file may import, and the
 * obvious fixes each hit one:
 *
 *   "@/lib/claims"  — "@/" is a tsconfig path mapping the Next bundler
 *                     resolves. Plain node has never heard of it.
 *   "./claims"      — node ESM requires the file extension, so this resolves
 *                     to a file that does not exist.
 *   "./claims.ts"   — node is happy, but tsc rejects a .ts extension unless
 *                     allowImportingTsExtensions is turned on project-wide,
 *                     which is a lot of config to move one string.
 *
 * So the bucket arrives as an argument instead, and this file imports nothing
 * from the project at all — the same shape as lib/safe-next.ts and
 * lib/email-copy.ts, which are testable for exactly this reason. Callers pass
 * ID_PHOTO_BUCKET from lib/claims.ts, so there is still one definition of the
 * name; a .mjs script can import that file directly with its extension.
 *
 * A package name like @supabase/supabase-js above is fine: node resolves it
 * from node_modules, and being type-only it is erased before anything runs.
 */

/**
 * The 90-day ID photo purge.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS TYPESCRIPT AND NOT pg_cron.
 *
 * 20260801_claim_id_photos_storage.sql sketched this as a pg_cron job doing
 * `delete from storage.objects where ...`. THAT SKETCH COULD NOT HAVE WORKED.
 * Supabase puts a BEFORE DELETE trigger on storage.objects — protect_delete() —
 * which raises:
 *
 *   Direct deletion from storage tables is not allowed. Use the Storage API
 *   instead.
 *   HINT: This prevents accidental data loss from orphaned objects.
 *
 * The hint is the real reason. The row in storage.objects is only an index
 * entry; the bytes live in object storage, and removing the row would strand
 * them there with nothing left pointing at them. For a bucket holding
 * photographs of driving licences, "the record says deleted and the file is
 * still there" is the worst of the available outcomes — it converts a retention
 * promise into a false one and removes the evidence needed to notice.
 *
 * So deletion goes through the Storage API, which means a process that can hold
 * the service-role key and make HTTP calls. pg_cron could have done it via
 * pg_net, but that needs two extensions enabled (neither is today), the
 * service-role key stored in Vault, and error handling written in plpgsql
 * against an async HTTP queue. A scheduled route is one file and the key is
 * already in the environment.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * TAKES ITS CLIENT AS AN ARGUMENT, DELIBERATELY. lib/supabase/admin.ts starts
 * with `import "server-only"`, so importing it here would make this module
 * unloadable by a plain node script — and the purge is precisely the thing that
 * must be tested before it runs unattended against real ID photos. The route
 * passes the admin client; scripts/verify-id-photo-purge.mjs passes its own.
 * Same split as lib/safe-next.ts and lib/email-copy.ts.
 */

/**
 * A service-role client. Typed as the plain SupabaseClient rather than the
 * return type of createAdminClient(), so this module never has to import
 * lib/supabase/admin.ts — which carries `import "server-only"` and would make
 * the whole file unloadable by the verify script.
 */
type StorageDb = SupabaseClient;

export type PurgeResult = {
  /** Rows whose retention window has closed and still carried a path. */
  scanned: number;
  /** Objects the Storage API confirmed it removed. */
  deleted: number;
  /** Paths already absent — counted, not failed. See below. */
  alreadyGone: number;
  /** Rows whose id_photo_url was cleared. */
  cleared: number;
  /** Chunks the Storage API refused. Those rows keep their path and retry. */
  failed: number;
  errors: string[];
};

/**
 * One Storage API call per chunk rather than per object. A batch of 200 rows is
 * two calls, not two hundred, which is what keeps this inside a serverless
 * invocation.
 */
const CHUNK = 100;

/** Bounded so one run cannot exceed the function timeout. The next run resumes. */
const DEFAULT_LIMIT = 500;

export async function purgeExpiredIdPhotos(
  db: StorageDb,
  /**
   * `bucket` is required rather than defaulted. A default would be a second
   * definition of the bucket name living in a file that deletes things, and a
   * silent fallback to the wrong bucket is not a failure anyone would notice —
   * the run would report zero deletions and look like a quiet day.
   */
  options: { bucket: string; limit?: number },
): Promise<PurgeResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const bucket = options.bucket;

  const result: PurgeResult = {
    scanned: 0,
    deleted: 0,
    alreadyGone: 0,
    cleared: 0,
    failed: 0,
    errors: [],
  };

  /**
   * id_photo_expires_at is re-based to the DECISION by approve_claim() and
   * reject_claim(), so "expired" already means 90 days post-decision rather
   * than post-submission. A still-pending claim carries submission + 90 days,
   * which is the correct floor: a claim nobody has reviewed in three months
   * should not keep a photograph of someone's passport indefinitely.
   *
   * `not null` on the path is what makes this idempotent. A row cleared by an
   * earlier run is not selected again, so the batch is always real work.
   */
  const { data: rows, error } = await db
    .from("claims")
    .select("id, id_photo_url, id_photo_expires_at")
    .lt("id_photo_expires_at", new Date().toISOString())
    .not("id_photo_url", "is", null)
    .order("id_photo_expires_at", { ascending: true })
    .limit(limit);

  if (error) {
    result.errors.push(`claims query failed: ${error.message}`);
    result.failed += 1;
    return result;
  }

  const claims = (rows ?? []) as { id: string; id_photo_url: string }[];
  result.scanned = claims.length;
  if (claims.length === 0) return result;

  for (let i = 0; i < claims.length; i += CHUNK) {
    const chunk = claims.slice(i, i + CHUNK);
    const paths = chunk.map((c) => c.id_photo_url);

    /**
     * ═════════════════════════════════════════════════════════════════════════
     * BYTES FIRST, COLUMN SECOND. THE ORDER IS THE WHOLE DESIGN.
     *
     * Clearing id_photo_url before the delete succeeds would throw away the only
     * pointer to the object. The bytes would remain in the bucket forever, with
     * no row naming them and nothing to retry — an undeletable photograph of
     * someone's ID, invisible to every query we could write.
     *
     * This way round, a failure between the two steps leaves the row still
     * carrying its path, so the next run selects it again and re-attempts. The
     * Storage API is idempotent about missing objects, so the retry is safe.
     * ═════════════════════════════════════════════════════════════════════════
     */
    const { data: removed, error: removeError } = await db.storage
      .from(bucket)
      .remove(paths);

    if (removeError) {
      // The whole chunk keeps its paths and is retried on the next run. Not
      // fatal to the batch — a later chunk may be perfectly fine.
      result.failed += chunk.length;
      result.errors.push(`storage remove failed for ${chunk.length} object(s): ${removeError.message}`);
      continue;
    }

    /**
     * A path missing from the response was already gone — someone removed it by
     * hand, or a previous run deleted the object and then failed to clear the
     * column. Counted separately rather than treated as an error: the desired
     * end state (no object) already holds, and the row still needs clearing.
     */
    const removedNames = new Set(
      ((removed ?? []) as { name?: string }[]).map((o) => o.name).filter(Boolean) as string[],
    );
    const confirmed = paths.filter((p) => removedNames.has(p)).length;
    result.deleted += confirmed;
    result.alreadyGone += paths.length - confirmed;

    /**
     * BOTH COLUMNS, ONE STATEMENT. claims_photo_present_unless_purged rejects
     * either on its own, which is deliberate: a null path with no purge date
     * would be a claim that appears never to have had a photo, and a purge date
     * beside a live path would say we destroyed something we still hold.
     */
    const { error: clearError } = await db
      .from("claims")
      .update({ id_photo_url: null, id_photo_purged_at: new Date().toISOString() })
      .in("id", chunk.map((c) => c.id));

    if (clearError) {
      /**
       * The objects are gone but the rows still name them. Harmless and
       * self-correcting: the next run re-selects these rows, the Storage API
       * reports the objects as already absent, and the clear is retried.
       */
      result.errors.push(`clearing id_photo_url failed for ${chunk.length} row(s): ${clearError.message}`);
      continue;
    }

    result.cleared += chunk.length;
  }

  return result;
}
