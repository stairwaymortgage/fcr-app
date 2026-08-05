import "server-only";

import vercelConfig from "@/vercel.json";

/**
 * System state — what is configured, what is scheduled, what is stored.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ CONFIGURED IS NOT CONNECTED, AND THIS MODULE ONLY KNOWS THE FIRST.
 *
 * Everything here is derived from environment variables being PRESENT and from
 * files in the repository. Nothing is probed. A RESEND_API_KEY that was revoked
 * this morning still reports "key present", because that is the true answer to
 * the question this module asks.
 *
 * The mockup's §04 shows "Connected" with live metrics — 78 Twilio messages,
 * 14.2M Cloudflare requests, $4,118 Stripe MRR. Reporting that honestly would
 * mean calling six external APIs on every page load: slow, rate-limited, and
 * capable of turning a third party's outage into a 500 on our own admin page.
 * More to the point, three of those integrations do not exist here — Stripe is
 * week 6 and the real figure is $0, Twilio is reached only inside GoHighLevel,
 * and Cloudflare is not in this codebase at all.
 *
 * So this reports presence, and the page says "configured" in those words. If
 * live health checks are ever wanted they are a different feature with a cache,
 * a timeout and a failure story — not an adjective swapped on this one.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NEVER RETURNS A VALUE. Only booleans. A settings page that renders half a
 * service-role key to help someone "check it is the right one" has published
 * the key — screenshots, screen shares, and support tickets all leak it. The
 * type makes this impossible rather than discouraged: there is no field for a
 * value to travel in.
 */

export interface ConfigItem {
  /** The env var name. Safe to display — the NAME is not the secret. */
  name: string;
  /** Present and non-empty. Never whether it is valid. */
  present: boolean;
  /** What stops working without it. */
  purpose: string;
  /**
   * False when the app degrades but still runs. Drives the tone on the page:
   * a missing optional key is a note, a missing required one is an error.
   */
  required: boolean;
}

export interface CronJob {
  path: string;
  schedule: string;
  /** Plain-English reading of the cron expression. */
  description: string;
}

/**
 * The env vars this codebase actually reads, verified by
 * `git grep -o "process\.env\.[A-Z_0-9]*"` on 2026-08-05. Nine names, and this
 * list is all nine — a settings page listing variables nothing reads would be
 * describing a different application.
 *
 * NEXT_PUBLIC_* ARE STILL LISTED, though they are visible in the browser
 * bundle by definition. Their presence is what matters here, and omitting them
 * would leave a reader wondering whether Supabase was configured at all.
 */
const CONFIG: readonly Omit<ConfigItem, "present">[] = [
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    purpose: "Every database read on every page",
    required: true,
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    purpose: "The session client — public reads and RLS-scoped writes",
    required: true,
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    purpose: "Claim review signed URLs, the ID-photo purge, lead inserts",
    required: true,
  },
  {
    name: "NEXT_PUBLIC_SITE_URL",
    purpose: "Absolute links in magic-link emails and claim decisions",
    required: true,
  },
  {
    name: "RESEND_API_KEY",
    purpose: "Claim approval and rejection emails to contractors",
    required: false,
  },
  {
    name: "EMAIL_FROM",
    purpose: "The From address on those emails",
    required: false,
  },
  {
    name: "GHL_API_TOKEN",
    purpose: "Pushing captured leads to GoHighLevel",
    required: false,
  },
  {
    name: "GHL_LOCATION_ID",
    purpose: "Which GoHighLevel location leads land in",
    required: false,
  },
  {
    name: "CRON_SECRET",
    purpose: "Authenticates Vercel's call to the ID-photo purge",
    required: false,
  },
];

/**
 * Presence, read on the server at request time.
 *
 * NOT destructured from a captured object and not evaluated at module scope:
 * process.env on Vercel is populated per-invocation, and a module-level snapshot
 * would report whatever was set when the lambda cold-started.
 */
export function configState(): ConfigItem[] {
  return CONFIG.map((item) => ({
    ...item,
    present: Boolean(process.env[item.name]?.trim()),
  }));
}

/**
 * Scheduled jobs, READ FROM vercel.json rather than restated here.
 *
 * The whole value of this row is telling you what Vercel will actually run, so
 * a hand-maintained copy would be worse than nothing — it would be authoritative
 * -looking and wrong the first time someone edited the real file. tsconfig has
 * resolveJsonModule, so this is the actual deployed config.
 */
export function cronJobs(): CronJob[] {
  const crons = (vercelConfig as { crons?: { path: string; schedule: string }[] }).crons ?? [];
  return crons.map((c) => ({ ...c, description: describeCron(c.schedule) }));
}

/**
 * Enough cron parsing for the expressions this project uses, and no more.
 *
 * Deliberately not a general parser: ranges, steps and lists are not handled
 * because nothing here uses them, and a half-correct parser that renders
 * "0 7 * * 1-5" as "every day" would be worse than declining to read it.
 * Anything unrecognised falls through to the raw expression, which is at least
 * true.
 */
function describeCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;
  const [minute, hour, dom, month, dow] = parts;

  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return schedule;
  if (month !== "*" || dom !== "*") return schedule;

  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")} UTC`;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  if (dow === "*") return `Daily at ${time}`;
  if (/^\d$/.test(dow)) return `Weekly — ${days[Number(dow)]} at ${time}`;
  return schedule;
}
