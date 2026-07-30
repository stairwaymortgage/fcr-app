import Link from "next/link";

import { FOCUS_RING_PAPER } from "@/lib/focus";

/**
 * Breadcrumb + title + lede + optional stat row.
 * Source: the .page-hero block shared by counties_index, cities_index and
 * license_types_index.
 */

export interface Crumb {
  href?: string;
  label: string;
}

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center text-xs tracking-[-0.005em] text-gray-700">
        {crumbs.map((crumb, i) => (
          <li key={crumb.label} className="flex items-center">
            {crumb.href ? (
              <Link
                href={crumb.href}
                className={`hover:text-navy hover:underline ${FOCUS_RING_PAPER}`}
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium text-ink" aria-current="page">
                {crumb.label}
              </span>
            )}
            {i < crumbs.length - 1 && (
              <span aria-hidden="true" className="mx-2.5 text-gray-500">
                ›
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function PageHero({
  crumbs,
  title,
  emphasis,
  lede,
  stats,
}: {
  crumbs: Crumb[];
  title: string;
  /** Rendered italic at the end of the h1, per the §03 heading pattern. */
  emphasis: string;
  lede: React.ReactNode;
  stats?: { value: string; label: string; gold?: boolean }[];
}) {
  return (
    <section className="border-b border-gray-200 bg-gradient-to-b from-paper to-[#faf6ed] px-8 pb-10 pt-9">
      <div className="mx-auto max-w-shell">
        <Breadcrumb crumbs={crumbs} />

        <h1 className="mb-3.5 font-serif text-[42px] font-semibold leading-[1.08] tracking-[-0.025em] text-navy max-[900px]:text-[32px]">
          {title} <em className="italic">{emphasis}</em>
        </h1>

        <p className="max-w-[720px] text-[17px] leading-[1.55] text-gray-700">
          {lede}
        </p>

        {stats && stats.length > 0 && (
          <dl className="mt-8 grid grid-cols-4 border-y border-gray-200 max-[900px]:grid-cols-2">
            {stats.map(({ value, label, gold }) => (
              <div
                key={label}
                className="border-r border-gray-200 px-5 py-4 last:border-r-0"
              >
                <dd
                  className={`font-serif text-[26px] font-semibold leading-[1.1] ${
                    gold ? "text-gold" : "text-navy"
                  }`}
                >
                  {value}
                </dd>
                <dt className="mt-1 font-mono text-label uppercase tracking-label text-gray-500">
                  {label}
                </dt>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
