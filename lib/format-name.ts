/**
 * Display formatting for DBPR names — ONE implementation, used everywhere.
 *
 * WHY THIS FILE EXISTS. There were two: formatBusinessName in
 * lib/contractor-profile.ts and titleCase in lib/browse.ts. They had drifted —
 * "SMITH & SONS CO." rendered as "Smith & Sons CO." on a profile and
 * "Smith & Sons Co." on a browse card, because only one of the two lists
 * included "Co". Same class of bug as the contractor slug and the /type slug:
 * one transform, several copies, silently disagreeing.
 *
 * DBPR stores names uppercase, so every display surface has to case them.
 */

/**
 * Tokens that are genuinely uppercase abbreviations and must stay that way.
 *
 * NOT Inc / Corp / Co / Ltd. Those are abbreviated words and take title case —
 * "Inc.", "Corp.", "Co." Uppercasing them was the bug that rendered Aceca's
 * profile heading as "Aceca Construction, INC."
 *
 * PA (professional association) and PL / PLLC (professional limited company)
 * are Florida entity suffixes and are genuinely initialisms, so they stay up.
 */
const UPPERCASE_TOKENS = new Set([
  "LLC",
  "L.L.C.",
  "PLLC",
  "PA",
  "P.A.",
  "PL",
  "P.L.",
  "LP",
  "LLP",
  "USA",
  "HVAC",
  "II",
  "III",
  "IV",
  // State and country abbreviations that appear inside business names —
  // "FL DEPARTMENT OF ENVIRONMENTAL PROTECTION" rendered as "Fl Department".
  "FL",
  "US",
  "U.S.",
]);

/** Words that stay lowercase inside a name, unless they lead it. */
const LOWERCASE_TOKENS = new Set(["of", "and", "the", "for", "at", "in", "on"]);

/**
 * "ACECA CONSTRUCTION, INC." -> "Aceca Construction, Inc."
 * "ACERO ROOFING LLC"        -> "Acero Roofing LLC"
 * "SMITH & SONS CO."         -> "Smith & Sons Co."
 *
 * Tokenised on whitespace so a token can be compared against the sets above.
 * Trailing punctuation is split off before the comparison and restored after,
 * so "INC." matches the same rule as "INC".
 */
export function businessName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      // Separate the core token from surrounding punctuation: "INC.," -> "INC" + ".,"
      //
      // The tail is measured from what REMAINS after the lead, not from the
      // whole word. Measuring both against the original made them overlap on a
      // punctuation-only token: "&" matched as lead AND as tail, core came out
      // empty, and the rebuilt token was "&&".
      const lead = word.match(/^[^A-Za-z0-9]*/)?.[0] ?? "";
      const rest = word.slice(lead.length);
      const tail = rest.match(/[^A-Za-z0-9.]*$/)?.[0] ?? "";
      let core = rest.slice(0, rest.length - tail.length);

      // A token like "L.L.C." keeps its dots; "INC." does not, so strip a single
      // trailing period and put it back at the end.
      let trailingDot = "";
      if (core.endsWith(".") && !UPPERCASE_TOKENS.has(core.toUpperCase())) {
        trailingDot = ".";
        core = core.slice(0, -1);
      }

      const upper = core.toUpperCase();
      let cased: string;

      if (UPPERCASE_TOKENS.has(upper)) {
        cased = upper;
      } else if (index > 0 && LOWERCASE_TOKENS.has(core.toLowerCase())) {
        cased = core.toLowerCase();
      } else {
        cased = core
          .toLowerCase()
          // Capitalise after a letter boundary so "O'BRIEN" and "SMITH-JONES"
          // become "O'Brien" and "Smith-Jones", not "O'brien" / "Smith-jones".
          .replace(/(^|[^a-z0-9])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
      }

      return lead + cased + trailingDot + tail;
    })
    .join(" ");
}

/**
 * "ACERO, CRISTIAN F" -> "Cristian F. Acero"
 *
 * DBPR stores individuals surname-first. Only a value containing a comma is
 * treated as a personal name — that is the DBPR convention, and business names
 * with commas ("ACECA CONSTRUCTION, INC.") are excluded by the two-part check.
 */
export function personName(raw: string): string {
  const parts = raw.split(",");
  if (parts.length !== 2) return businessName(raw);

  const [last, first] = parts.map((p) => p.trim());
  // A bare middle initial gets its period: "CRISTIAN F" -> "Cristian F."
  const given = businessName(first).replace(/\b([A-Z])\b(?!\.)/g, "$1.");
  return `${given} ${businessName(last)}`;
}

/**
 * End a sentence with a name without doubling its full stop.
 *
 * "ACECA CONSTRUCTION, INC." already ends in a period in the DBPR data, so
 * `sent to ${name}.` produced "sent to Aceca Construction, Inc.." on the
 * inquiry confirmation — the money page. The period comes from the data, not
 * from the formatter, so stripping it in the formatter would be wrong: the name
 * itself is correct. It is only sentence-final punctuation that has to yield.
 */
export function endSentence(name: string): string {
  return /[.!?]$/.test(name) ? name : `${name}.`;
}
