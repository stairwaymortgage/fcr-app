/**
 * Every colour utility in the source must resolve to a real token.
 *
 * Run:
 *   npm run verify:tokens
 *
 * NO NETWORK, NO ENV, NO DATABASE. It reads tailwind.config.ts and the source
 * tree, and compares two sets of strings. That is what makes it safe to put in
 * front of `next build` — unlike the verify scripts that assert live DB state,
 * this one cannot fail on data drift, only on a real dead class.
 *
 * ⚠ IT IS CHAINED INTO `build` ITSELF, NOT A `prebuild` HOOK. This repo installs
 * with pnpm, and pnpm 8+ ships `enable-pre-post-scripts=false` — a `prebuild`
 * script would simply never fire, on Vercel or locally, with no error and no
 * output. A guard that silently does not run is worse than no guard, and it is
 * the same class of bug as the one below: something that looks wired up and
 * emits nothing. `build` runs it directly so there is no lifecycle to trust.
 *
 * A failure here blocks a DEPLOY; it cannot break the live site. That is the
 * safe direction for a gate on a site with indexed pages.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS: A CLASS THAT GENERATES NO CSS LOOKS EXACTLY LIKE ONE THAT
 * WORKS.
 *
 * `hover:bg-navy-light` shipped on 16 primary buttons — every submit, both
 * conversion CTAs, the login and claim flows. The navy scale has DEFAULT and
 * deep; there is no `light`, so Tailwind emitted nothing and those buttons had
 * no hover state at all. Nothing was misrendered, no build warned, and the
 * `transition-colors` beside it transitioned nothing.
 *
 * ⚠ AND IT SPREAD. Five of the sixteen were added months after the first, by
 * copying an adjacent button. That is the whole failure mode: a dead class is
 * indistinguishable from a live one in the source, so it propagates by
 * copy-paste and is only ever found by eye.
 *
 * Tailwind cannot catch this. An unrecognised class is not an error to it — it
 * is simply a string that matches no rule, which is also what every non-Tailwind
 * className looks like. The check has to live here.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ SCOPE IS COLOURS ONLY. Spacing, font-size and tracking tokens have the same
 * hazard (`text-note`, `tracking-label` are custom) and are NOT checked, because
 * the utilities that take them share prefixes with colour utilities — `text-sm`
 * and `text-navy` are the same prefix — and telling them apart needs the same
 * family heuristic applied to a much noisier set. Colours are where the bug
 * happened and where the palette is hard-locked.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

import tailwindConfig from "../tailwind.config.ts";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "  PASS" : "  ****FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
  c ? pass++ : fail++;
};
const head = (t) => { console.log(""); console.log(t); };

/* ========================================================================== *
 * THE TOKEN SET
 * ========================================================================== */

/**
 * Flattened from the config itself, not transcribed.
 *
 * ⚠ THE CONFIG IS THE SOURCE OF TRUTH AND MUST STAY THAT WAY. A hard-coded list
 * here would be a second palette to keep in step, and it would drift the first
 * time someone adds a token — reporting a false failure on a colour that exists,
 * which is the fastest way to get a check deleted.
 *
 * `theme.colors` REPLACES Tailwind's default palette rather than extending it
 * (see the docblock at the top of tailwind.config.ts), so this really is every
 * colour available. That is what makes the check exact: there is no default
 * red-500 quietly in scope to make a wrong answer look right.
 */
function flattenColors(colors, prefix = "") {
  const out = new Set();
  for (const [key, value] of Object.entries(colors)) {
    // DEFAULT is addressed by the family name alone: navy.DEFAULT -> `bg-navy`.
    const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
    if (value && typeof value === "object") {
      for (const nested of flattenColors(value, name)) out.add(nested);
    } else {
      out.add(name);
    }
  }
  return out;
}

const cfg = tailwindConfig.default ?? tailwindConfig;
const VALID = flattenColors(cfg.theme.colors);

/**
 * The first hyphen-segment of every valid token: navy, gray, status, green…
 *
 * This is what separates "a colour utility that is wrong" from "a utility that
 * is not about colour". `text-sm` starts with `sm`, which is not a family, so it
 * is ignored; `text-navy-lightest` starts with `navy`, so it must resolve.
 *
 * ⚠ TOP-LEVEL KEYS CAN THEMSELVES CONTAIN A HYPHEN — the config has green-text,
 * green-bg, yellow-text, red-bg and so on. `bg-green-text` is therefore a
 * COMPLETE valid token, while `bg-green-500` is a family match that must fail.
 * Both are handled by checking the full name against VALID first and only then
 * falling back to the family test.
 */
const FAMILIES = new Set(Array.from(VALID).map((name) => name.split("-")[0]));

/**
 * Utility prefixes that take a colour. Longest first, so `border-l` is stripped
 * before `border` and `border-l-gold` is not misread as the token `l-gold`.
 */
const COLOR_PREFIXES = [
  "ring-offset", "border-t", "border-r", "border-b", "border-l",
  "border-x", "border-y", "placeholder", "decoration", "divide",
  "outline", "shadow", "accent", "border", "stroke", "caret",
  "from", "ring", "fill", "text", "via", "bg", "to",
].sort((a, b) => b.length - a.length);

/* ========================================================================== *
 * SCAN
 * ========================================================================== */

function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if ([".tsx", ".ts"].includes(extname(entry))) acc.push(full);
  }
  return acc;
}

/**
 * Reduce one source token to the colour name it is trying to name.
 *
 * Returns null when the token is not a colour utility at all. Handles, in order:
 *   variants   hover: / focus-visible: / max-[1000px]:  -> stripped
 *   opacity    bg-navy/10                               -> stripped
 *   arbitrary  bg-[#faf6ed]                             -> reported, not failed
 */
function colorNameOf(raw) {
  // Strip every variant: take what follows the LAST colon. Arbitrary variants
  // like max-[1000px]: contain no colon inside the bracket, so this is safe.
  const util = raw.slice(raw.lastIndexOf(":") + 1);

  for (const prefix of COLOR_PREFIXES) {
    if (!util.startsWith(`${prefix}-`)) continue;
    let rest = util.slice(prefix.length + 1);
    if (rest === "") return null;

    /**
     * Arbitrary value. Only a COLOUR one is interesting here — `text-[30px]`
     * and `border-l-[3px]` share these prefixes and are a font size and a
     * width. Reporting those drowned the real signal 293 to 0 on the first run.
     */
    if (rest.startsWith("[")) {
      const inner = rest.slice(1, rest.indexOf("]") === -1 ? undefined : rest.indexOf("]"));
      const looksLikeColour = /^(#|rgb|hsl|oklch|color\()/i.test(inner);
      return looksLikeColour ? { arbitrary: true, util } : null;
    }

    // Opacity modifier: bg-navy/10 -> navy
    const slash = rest.indexOf("/");
    if (slash !== -1) rest = rest.slice(0, slash);

    if (VALID.has(rest)) return { valid: true };
    if (FAMILIES.has(rest.split("-")[0])) return { valid: false, name: rest, util };
    return null; // not a colour utility (text-sm, bg-cover, border-dashed…)
  }
  return null;
}

/** Class-ish words: letters, digits, and the punctuation Tailwind uses. */
const WORD = /[A-Za-z0-9_@[\]#().,%-]*[A-Za-z0-9\]][A-Za-z0-9_@[\]#().,%/:-]*/g;

const files = [
  ...sourceFiles("app"),
  ...sourceFiles("components"),
  ...sourceFiles("lib"),
];

const dead = [];
const arbitrary = [];
let checked = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    for (const word of line.match(WORD) ?? []) {
      const result = colorNameOf(word);
      if (!result) continue;
      if (result.arbitrary) {
        arbitrary.push(`${file}:${i + 1}  ${result.util}`);
        continue;
      }
      checked++;
      if (!result.valid) {
        dead.push(`${file}:${i + 1}  ${result.util}  (no token "${result.name}")`);
      }
    }
  });
}

/* ========================================================================== *
 * ASSERTIONS
 * ========================================================================== */

head("── THE TOKEN SET ──────────────────────────────────────");
ok("tailwind.config.ts parsed", VALID.size > 0, `${VALID.size} colour tokens`);
ok(
  "the palette really is hard-locked (no Tailwind defaults in scope)",
  !VALID.has("red-500") && !VALID.has("blue-600") && !VALID.has("black"),
  "theme.colors replaces rather than extends",
);
// A self-test: if the matcher silently stopped recognising anything, every
// assertion below would pass vacuously.
ok("the scan recognised colour utilities", checked > 100, `${checked} checked across ${files.length} files`);
ok(
  "self-test: a known-bad class IS caught",
  colorNameOf("hover:bg-navy-light")?.valid === false,
  "hover:bg-navy-light -> no token \"navy-light\"",
);
ok(
  "self-test: a known-good class is NOT flagged",
  colorNameOf("hover:bg-navy-deep")?.valid === true,
  "hover:bg-navy-deep -> navy.deep",
);
ok(
  "self-test: a non-colour utility is ignored",
  colorNameOf("text-sm") === null && colorNameOf("bg-gradient-to-b") === null,
  "text-sm, bg-gradient-to-b",
);
ok(
  "self-test: hyphenated top-level keys resolve",
  colorNameOf("bg-green-text")?.valid === true,
  "bg-green-text -> green-text",
);
ok(
  "self-test: an opacity modifier resolves",
  colorNameOf("text-white/85")?.valid === true,
  "text-white/85 -> white",
);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRE-EXISTING VIOLATIONS, RECORDED SO THE GATE CAN BE STRICT ABOUT NEW ONES.
 *
 * This check found `text-gray-600` in 37 places on its first run. The gray scale
 * is 50/100/200/300/400/500/700 — there is no 600, and the config docblock warns
 * about exactly this ("Tailwind's default grays … do not exist"). Confirmed
 * against the compiled CSS: text-gray-500 and text-gray-700 are emitted,
 * text-gray-600 is not. Those 37 elements inherit their parent's colour instead
 * of rendering mid-gray.
 *
 * ⚠ THEY ARE NOT FIXED HERE. Repointing them is a visible change to 37 places
 * and is Jim's call, exactly as the sixteen navy buttons were. Recording the
 * count instead of fixing or ignoring them is what lets this ship green while
 * still failing on anything NEW — the standard way to introduce a linter to a
 * codebase that already violates it.
 *
 * THE NUMBER MUST ONLY EVER GO DOWN. A 38th instance fails the build, and so
 * does a different dead token. When they are repointed, delete the entry.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const KNOWN_DEAD = { "gray-600": 37 };

head("── EVERY COLOUR UTILITY RESOLVES ──────────────────────");

const byToken = new Map();
for (const entry of dead) {
  const name = entry.slice(entry.lastIndexOf('(no token "') + 11, -2);
  byToken.set(name, (byToken.get(name) ?? 0) + 1);
}

const unexpected = dead.filter((entry) => {
  const name = entry.slice(entry.lastIndexOf('(no token "') + 11, -2);
  return !(name in KNOWN_DEAD);
});
if (unexpected.length > 0) for (const entry of unexpected) console.log(`      ${entry}`);

ok(
  "no NEW colour utility names a token that does not exist",
  unexpected.length === 0,
  unexpected.length === 0
    ? `${checked} utilities checked`
    : `${unexpected.length} new dead class(es)`,
);

for (const [name, allowed] of Object.entries(KNOWN_DEAD)) {
  const found = byToken.get(name) ?? 0;
  ok(
    `known-dead "${name}" has not spread`,
    found <= allowed,
    found === allowed
      ? `${found}, unchanged — still awaiting a repoint decision`
      : found < allowed
        ? `${found}, DOWN from ${allowed} — lower KNOWN_DEAD to match`
        : `${found}, UP from ${allowed}`,
  );
}

head("── ARBITRARY VALUES (reported, not failed) ────────────");
/**
 * NOT A FAILURE, DELIBERATELY. `bg-[#faf6ed]` bypasses the palette, and the
 * design system is hard-locked — but arbitrary values are also the sanctioned
 * escape hatch for gradient stops and one-off geometry, and several are load
 * bearing today. Failing on them would make this check something to silence
 * rather than something to read.
 *
 * Listed so a growing number is visible. If it climbs, that is the signal that a
 * colour wants promoting to a token.
 */
console.log(`  ${arbitrary.length} arbitrary colour value(s) in use`);
for (const entry of arbitrary.slice(0, 10)) console.log(`      ${entry}`);
if (arbitrary.length > 10) console.log(`      … and ${arbitrary.length - 10} more`);

console.log("");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
