import { pathogenLabel } from "@/lib/config";
import { SEVERITY_LABELS } from "@/lib/scoring";
import type { ScoredOutbreak, SourceTier } from "@/lib/types";

const SOURCE_LABELS: Record<SourceTier, string> = {
  1: "Official",
  2: "News",
  3: "Unverified",
};

const SOURCE_STYLES: Record<SourceTier, string> = {
  1: "bg-stone-800 text-white",
  2: "bg-stone-200 text-stone-700",
  3: "bg-stone-100 text-stone-500 border border-stone-300",
};

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function OutbreakCard({
  outbreak,
  muted = false,
}: {
  outbreak: ScoredOutbreak;
  muted?: boolean;
}) {
  const severity = SEVERITY_LABELS[outbreak.severity] ?? "Reported event";

  return (
    <article
      className={`rounded-lg border p-3 ${
        muted ? "border-stone-200 bg-stone-50" : "border-stone-200 bg-white"
      }`}
    >
      <h3 className="text-sm font-semibold leading-snug">{outbreak.title}</h3>

      <p className="mt-1 text-sm leading-relaxed text-stone-600">{outbreak.summary}</p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="font-medium text-stone-500">Pathogen</dt>
        <dd>{pathogenLabel(outbreak.pathogen)}</dd>

        {outbreak.brands.length > 0 && (
          <>
            <dt className="font-medium text-stone-500">Brands</dt>
            <dd>{outbreak.brands.join(", ")}</dd>
          </>
        )}

        <dt className="font-medium text-stone-500">Where</dt>
        <dd>
          {outbreak.states.length === 0 ? "Nationwide" : outbreak.states.join(", ")}
        </dd>

        <dt className="font-medium text-stone-500">Severity</dt>
        <dd>{severity}</dd>

        <dt className="font-medium text-stone-500">Reported</dt>
        <dd>
          {formatDate(outbreak.first_reported_at)} — last update{" "}
          {formatDate(outbreak.last_reported_at)}
        </dd>
      </dl>

      {outbreak.reports.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-stone-100 pt-3">
          {outbreak.reports.map((report) => (
            <li key={report.id} className="flex items-start gap-2 text-xs">
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  SOURCE_STYLES[report.source_tier]
                }`}
              >
                {SOURCE_LABELS[report.source_tier]}
              </span>
              <a
                href={report.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 text-stone-700 underline decoration-stone-300 underline-offset-2"
              >
                {report.headline}
                <span className="text-stone-400">
                  {" "}
                  — {report.source_name}, {formatDate(report.published_at)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
