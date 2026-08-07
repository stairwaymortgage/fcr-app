import { cache } from "react";

import {
  getCityBySlug as getCityBySlugUncached,
  getCountyBySlug as getCountyBySlugUncached,
  getTypeByCode as getTypeByCodeUncached,
} from "@/lib/browse";

/**
 * Per-request memoised wrappers around the three slug lookups.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A SEPARATE FILE AND NOT THREE cache() CALLS IN lib/browse.ts.
 *
 * generateMetadata and the page body of /county/[slug] both call
 * getCountyBySlug with the same slug, so an unwrapped call costs two identical
 * queries on every request. React's cache() dedupes them within one render pass.
 * The obvious home for that is lib/browse.ts itself.
 *
 * It cannot live there, because lib/browse.ts is loaded at RUNTIME by
 * scripts/verify-test-row-isolation.mjs under `node --experimental-strip-types`,
 * and react is CommonJS: `import { cache } from "react"` fails there with
 * "Named export 'cache' not found", and the namespace form
 * (`import * as React`) yields an object whose `cache` is undefined. Either way
 * the whole suite dies on import — and that suite is what proves synthetic rows
 * stay out of the cached listings.
 *
 * So the react dependency is isolated here. lib/browse.ts stays free of it and
 * stays node-loadable; routes import from this file and get the memoisation.
 *
 * SAME SPLIT AS lib/email.ts / lib/email-copy.ts, and for the same reason: the
 * part that must be exercisable offline is kept clear of the dependency that
 * makes it unloadable. That precedent is why this is a file rather than a
 * workaround inlined into browse.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ ROUTES SHOULD IMPORT THESE THREE FROM HERE. Importing them from
 * lib/browse.ts is not wrong — it just silently pays for the duplicate query.
 * Everything else in browse.ts is called once per render and is imported from
 * there directly.
 *
 * cache() keys on the argument list, and the first argument is a Supabase
 * client. That is fine because each render builds exactly one client and passes
 * the same reference to both call sites; a page that built two clients would get
 * two cache entries and simply not benefit, rather than return a wrong result.
 */

export const getCountyBySlug = cache(getCountyBySlugUncached);
export const getCityBySlug = cache(getCityBySlugUncached);
export const getTypeByCode = cache(getTypeByCodeUncached);
