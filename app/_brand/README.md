# Brand assets

## `fraunces-italic-600.woff`

A single static instance of **Fraunces** — italic, weight 600, optical size axis
flattened — used only by `app/opengraph-image.tsx` and `app/icon.tsx`.

### Why a committed font file exists at all

The rest of the site loads Fraunces through `next/font/google`, which downloads
it at build time and emits **WOFF2**. `ImageResponse` renders through satori,
and **satori cannot parse WOFF2** — it accepts TTF, OTF and WOFF only. There is
no Fraunces file in `node_modules` to reuse either; `next/font` writes its
output to `.next/static/media` under content-hashed names that change every
build.

The alternatives were worse:

- **Fetch the font at build time** from `fonts.gstatic.com` — reintroduces the
  network dependency `next/font` was chosen to remove, and breaks an offline or
  network-restricted build.
- **Use satori's bundled default font** (Noto Sans) — the wordmark is the brand,
  and rendering it in a sans-serif makes the social card look like a different
  company's.

50 KB, fetched once, deterministic thereafter.

### Licence

Fraunces is licensed under the **SIL Open Font License, Version 1.1**, which
permits redistribution — including bundling in a repository — provided the
licence travels with it and the font is not sold on its own.

- Upstream: https://github.com/google/fonts/tree/main/ofl/fraunces
- Licence text: https://github.com/google/fonts/blob/main/ofl/fraunces/OFL.txt
- Copyright 2019 The Fraunces Project Authors
  (https://github.com/undercasetype/Fraunces)

This instance was retrieved from the Google Fonts CSS API on 2026-08-05:

```
https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,600
```

### Do not import this from a page

It exists for image generation only. Page typography comes from
`next/font/google` in `app/layout.tsx`, which is self-hosted, preloaded and
metric-adjusted. Loading this file in a page would ship the same typeface twice.
