/**
 * The Fraunces instance used by the three generated images.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE IMAGE ROUTES RUN ON THE EDGE RUNTIME, AND THAT IS NOT A PREFERENCE.
 *
 * `next/og` ships two builds. The Node one (index.node.js) resolves its WASM
 * assets through fileURLToPath(), which throws `TypeError: Invalid URL` on
 * Windows during prerender — so `npx next build` fails on a Windows machine for
 * all three images while, presumably, succeeding on Vercel's Linux builders.
 * A build that only works on some developers' machines is not a build.
 *
 * The edge bundle does not take that path, and it is what Next's own
 * documentation uses for OG images. Setting `runtime = "edge"` in each image
 * route fixes the Windows build and matches the documented pattern.
 *
 * ⚠ WHICH IS WHY THIS IS fetch(), NOT readFileSync. There is no `fs` on the
 * edge runtime. `new URL(…, import.meta.url)` is rewritten by webpack into an
 * asset reference the edge runtime can fetch, so the font is bundled with the
 * route rather than read from a filesystem that is not there.
 *
 * The two constraints are linked: Node runtime needs readFileSync and breaks on
 * Windows; edge runtime fixes Windows and requires fetch. Changing one means
 * changing the other.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `_brand` is a private folder — App Router excludes underscore-prefixed
 * directories from routing, so nothing here is publicly reachable.
 */
export async function frauncesItalic(): Promise<ArrayBuffer> {
  return fetch(new URL("./fraunces-italic-600.woff", import.meta.url)).then((res) =>
    res.arrayBuffer(),
  );
}
