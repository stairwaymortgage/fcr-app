# Where the DBPR extract comes from

Settled 2026-08-05. This supersedes the conflicting URLs and env var names in
`_handoff/`, which is gitignored reference material that no deploy reads.

## The canonical URL and env var

```
DBPR_CSV_URL=https://www2.myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONLICENSE_1.csv
```

`DBPR_CSV_URL` is the name, per the authoritative spec. Anything calling it
`DBPR_EXTRACT_URL` is the older draft — see the reconciliation table below.

## Where this comes from

`_handoff/06_specifications/Florida_Contractor_Registry_DBPR_Ingestion_Script.docx`,
"Prepared for Kerry — Lead Developer, May 2026", says in its own words:

> This document is built from analyzing the actual CONSTRUCTIONLICENSE_1.csv
> file (46MB, 266,312 rows) **downloaded from the DBPR public records portal.**
>
> Source URL: `https://www2.myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONLICENSE_1.csv`
> NO HEADER ROW — column meanings are positional only
> 266,312 total rows in the May 2026 snapshot
> **Refreshed weekly by DBPR — same URL, fresh content**

That row count matches `_handoff/07_source_data/CONSTRUCTIONLICENSE_1.csv`
exactly, so the spec was written from the extract we hold.

The file itself carries no metadata to corroborate this — no header row, no
comment, no trailing record. The only internal signal is that the newest
`original_license_date` values are 05/22/2026, consistent with a May 2026
snapshot. There is no git provenance either: `_handoff/` is in `.gitignore`
(line 49) with zero tracked files, so the CSV exists only on machines somebody
copied it to.

## Which hostname is real

Three hostnames appear across the handoff. Measured with HEAD requests on
2026-08-05:

| Host | Result | Verdict |
|---|---|---|
| `www2.myfloridalicense.com` | 403, `Cf-Mitigated: challenge`, Cloudflare | **The live site.** See below. |
| `www.myfloridalicense.com` | 404 from `Microsoft-IIS/10.0` | Separate legacy server; does not serve this path |
| `myfloridalicense.com` (bare) | 302 → `www` → `/dbpr/` → `www2`, via BigIP | Redirector only; serves no files |

So `www2` is canonical and the other two are dead ends — including the bare host
baked into `sync_runs.source_url`'s `DEFAULT` in `_handoff/08_database/01_schema.sql`.
**That default is not a working file URL. Do not copy it into anything.**

## ⚠ The blocker: the URL is not fetchable by a script

`www2` sits behind a **Cloudflare managed challenge**. The response carries
`Cf-Mitigated: challenge` and a body reading "Just a moment… Enable
JavaScript". It is applied site-wide, not to this path: the site root and the
human-facing `/construction-industry/public-records/` page return the identical
403.

This is a JavaScript challenge, not a User-Agent filter, so it is not
sidestepped by setting a browser User-Agent — and it should not be. Building
something to defeat a WAF on a state government host is a bad idea on its own
terms, and it would make this product's data pipeline depend on continuing to
defeat it.

**Consequences for any automated refresh:** a plain `fetch()` gets 403 wherever
it runs — Vercel, GitHub Actions, a VPS, or a laptop. Scheduling alone does not
solve this. Whoever automates the refresh has to answer the access question
first:

1. **Ask DBPR for a supported feed.** They publish this as public records; a
   documented download endpoint, an allowlist, or an SFTP drop is a normal
   request. Slowest, and the only option that is durable by design.
2. **A human downloads it and drops it in.** What happens today. The
   `/admin/sync` queue already models exactly this: someone requests a refresh,
   someone with a browser and the repo services it.
3. **A headful browser fetch** (Playwright solving the challenge as a real
   browser would). Technically works, but it is a bot-management arms race
   running against a government site, and it breaks silently whenever
   Cloudflare's policy changes.

Option 1 is the one to pursue; option 2 is a working fallback indefinitely.

## Reconciling the handoff

Left unedited on purpose — `_handoff/` is the delivered package and rewriting it
destroys the record of what was handed over. These are the discrepancies, so
nobody has to re-derive them:

| Where | URL | Env var | Status |
|---|---|---|---|
| `06_specifications/…_DBPR_Ingestion_Script.docx` | `www2` | `DBPR_CSV_URL` | **Correct host, correct name** |
| `09_dbpr_ingestion/README.md` | `www.` | `DBPR_EXTRACT_URL` | Wrong host, superseded name |
| `09_dbpr_ingestion/sync_dbpr.ts:63` | `www.` | `DBPR_EXTRACT_URL` | Wrong host, superseded name |
| `08_database/01_schema.sql:272` | bare | — | Wrong host; live as the `source_url` DEFAULT |
| `06_specifications/Build_Brief_v1.3.docx` | bare | — | Wrong host; where the schema default came from |

`09_dbpr_ingestion/README.md` also documents a Vercel Cron architecture
(Sundays 02:00 ET, `/api/cron/dbpr-sync`, 5-minute Pro timeout) that is not
viable for two independent reasons: the importer needs more memory and time than
a serverless function has, and the source is challenge-protected. Its own
"Performance notes" anticipated the first and suggested a dedicated worker.

## What the app records today

`scripts/import-dbpr.mjs` writes `sync_runs.source_url` as
`file:_handoff/07_source_data/CONSTRUCTIONLICENSE_1.csv` — the path it actually
opened. It never stamps a URL for a fetch that did not happen. `/admin/sync`
renders whatever the row says and explains the Cloudflare constraint, so a
`--download` run recording a real URL needs no page change.
