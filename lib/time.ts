/**
 * Relative and absolute time, for list pages.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EXTRACTED AT THE THIRD CALL SITE, NOT THE SECOND.
 *
 * This lived in lib/inquiries.ts (task 147), was copied into lib/leads.ts (155)
 * with a note saying "TWO CALLERS IS NOT THREE — if a third appears, extract
 * then, and the extraction will have three real call sites to be shaped by",
 * and /admin/contractors (156a) is the third: it renders when DBPR last synced.
 *
 * Counting the file being written is deliberate — tailwind.config.ts records
 * the same rule for the type scale, and the reason it is written down is that
 * an audit which counts only pre-existing files misses the one in your hands
 * and leaves the third copy in the tree.
 *
 * The two copies were byte-identical, so this is a move rather than a merge.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * "9 min ago" / "2 hr ago" / "Yesterday" / "3 days ago" / "May 18".
 *
 * COMPUTED AT RENDER, WHICH IS ONLY SAFE BECAUSE EVERY CALLER IS UNCACHED.
 * All three read a session and are therefore dynamic, so there is no cached
 * HTML for these strings to go stale inside. If any part of a consuming route
 * is ever made static, these freeze at build time — move the arithmetic to the
 * client then, or drop to absolute dates.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  // Calendar days apart, not 24-hour blocks: something sent at 11pm is
  // "Yesterday" at 1am, which is what a person means by the word.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const days = Math.round(
    (startOfToday.getTime() - startOfThen.getTime()) / 86_400_000,
  );

  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    // The year only when it is not this one — "May 18" for recent items,
    // "May 18, 2025" once it is old enough for the ambiguity to matter.
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Full timestamp, for detail headers and for a row's title attribute. */
export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });
}
