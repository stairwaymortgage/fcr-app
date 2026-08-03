/**
 * The contract between ProfileForm and saveProfile.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FILE EXISTS BECAUSE A "use server" MODULE MAY EXPORT ONLY ASYNC
 * FUNCTIONS — AND NOTHING CATCHES A BREACH UNTIL PRODUCTION.
 *
 * EMPTY_SAVE_STATE used to live in ./actions.ts, beside the action that uses
 * it. That is a runtime error: every export of a "use server" module becomes a
 * server reference, and a plain object cannot be one. Next raises
 *
 *   A "use server" file can only export async functions, found object.
 *
 * The part worth remembering is WHEN. tsc passed. next lint passed. next build
 * passed. The check is an assertion in the server runtime, not a compile step,
 * so the first thing that noticed was a contractor pressing Save and getting
 * "Application error: a server-side exception has occurred" (digest 1753474867,
 * 2026-08-03). The page itself rendered perfectly, which made it look like a
 * bug in the save path rather than in a module declaration.
 *
 * So the types and the constant live here, in an ordinary module, and
 * ./actions.ts exports exactly one thing: an async function. Put anything that
 * is not an async function HERE, never there.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type EditableValues = {
  about: string;
  website: string;
  email: string;
  phone: string;
  serviceArea: string;
};

export type SaveState = {
  ok: boolean;
  error: string | null;
  /**
   * Echoed back ONLY on failure, so a rejected save does not empty the form.
   * Losing 1200 characters of About text to a mistyped website would be a
   * worse bug than the one the validation is catching.
   */
  values?: EditableValues;
};

export const EMPTY_SAVE_STATE: SaveState = { ok: false, error: null };
