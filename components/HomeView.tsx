"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import TierBadge from "./TierBadge";
import {
  CATEGORY_LABELS,
  DEFAULT_STATE,
  FILTER_CATEGORIES,
  FOODS,
  US_STATES,
  foodMatchesQuery,
} from "@/lib/config";
import { TREND_ARROWS } from "@/lib/scoring";
import type { Category, ListItem } from "@/lib/types";

const STORAGE_KEY = "fit.state";

type Tab = "groceries" | "restaurants";

const FOODS_BY_SLUG = new Map(FOODS.map((f) => [f.slug, f]));

const SOURCE_LABELS: Record<number, string> = {
  1: "Official",
  2: "News",
  3: "Unverified",
};

const SIGNAL_LABELS: Record<string, string> = {
  direct: "Named",
  supplier: "Supplier",
  ingredient: "Ingredient",
};

/**
 * The small uppercase row tag. On groceries it names the strongest source backing the
 * rating; on restaurants it names how the signal reached the chain, so an elevated
 * rating driven by ingredient exposure cannot be misread as an accusation.
 */
function RowTag({ item }: { item: ListItem }) {
  const label =
    item.topSignal !== null
      ? SIGNAL_LABELS[item.topSignal]
      : item.sourceTier !== null
        ? SOURCE_LABELS[item.sourceTier]
        : null;
  if (!label) return null;

  const official = item.topSignal === null && item.sourceTier === 1;
  return (
    <span
      className={`shrink-0 rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wider ${
        official
          ? "border-sky-300 bg-sky-50 text-sky-800"
          : "border-stone-300 bg-white text-stone-500"
      }`}
    >
      {label}
    </span>
  );
}

/**
 * Home (DESIGN.md §9.1). The server renders the default state so the list is there on
 * first paint; search and category filtering run locally, and only a state change —
 * which needs the relevance rules in `lib/` — goes back to the API.
 */
export default function HomeView({
  initialFoods,
  initialChains,
}: {
  initialFoods: ListItem[];
  initialChains: ListItem[];
}) {
  const [tab, setTab] = useState<Tab>("groceries");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [state, setState] = useState(DEFAULT_STATE);

  const [foods, setFoods] = useState(initialFoods);
  const [chains, setChains] = useState(initialChains);
  const [loading, setLoading] = useState(false);

  // The chosen state is remembered per device; there are no accounts (§11).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && stored !== DEFAULT_STATE) setState(stored);
    } catch {
      // Private mode or storage disabled — the default state is fine.
    }
  }, []);

  useEffect(() => {
    if (state === DEFAULT_STATE) {
      setFoods(initialFoods);
      setChains(initialChains);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetch(`/api/foods?state=${state}`).then((r) => r.json()),
      fetch(`/api/chains?state=${state}`).then((r) => r.json()),
    ])
      .then(([f, c]) => {
        if (cancelled) return;
        setFoods(f);
        setChains(c);
      })
      .catch(() => {
        // Leave the previous list on screen rather than blanking the page.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [state, initialFoods, initialChains]);

  function chooseState(next: string) {
    setState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is survivable.
    }
  }

  const items = tab === "groceries" ? foods : chains;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();

    return items.filter((item) => {
      if (tab === "groceries" && category !== "all" && item.category !== category) {
        return false;
      }
      if (!needle) return true;

      if (tab === "groceries") {
        const food = FOODS_BY_SLUG.get(item.slug);
        return food
          ? foodMatchesQuery(food, needle)
          : item.name.toLowerCase().includes(needle);
      }
      return item.name.toLowerCase().includes(needle);
    });
  }, [items, tab, category, q]);

  const ranked = filtered.filter((i) => i.activeOutbreakCount > 0);
  const quiet = filtered.filter((i) => i.activeOutbreakCount === 0);

  const stateLabel = state === "ALL" ? "All states" : state;
  const href = tab === "groceries" ? "/food" : "/chain";

  return (
    <div className="px-4 pt-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-bold tracking-tight">Is My Food Safe?</h1>
        <label className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="sr-only sm:not-sr-only">State</span>
          <select
            value={state}
            onChange={(e) => chooseState(e.target.value)}
            className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-800"
            aria-label="Your state"
          >
            <option value="ALL">All states</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="sticky top-0 z-10 -mx-4 mt-3 bg-stone-50/95 px-4 pb-2 pt-2 backdrop-blur">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a food… eggs, romaine, ground beef"
          aria-label="Search"
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none"
        />

        <div
          role="tablist"
          className="mt-2 flex gap-1 rounded-lg bg-stone-200 p-1 text-sm font-medium"
        >
          {(["groceries", "restaurants"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 capitalize transition ${
                tab === t ? "bg-white text-stone-900 shadow-sm" : "text-stone-600"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "groceries" && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {(["all", ...FILTER_CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c as Category | "all")}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  category === c
                    ? "border-stone-800 bg-stone-800 text-white"
                    : "border-stone-300 bg-white text-stone-600"
                }`}
              >
                {c === "all" ? "All" : CATEGORY_LABELS[c as Category]}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <p className="py-2 text-xs text-stone-400">Updating for {stateLabel}…</p>
      )}

      {ranked.length === 0 && quiet.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">
          {q.trim()
            ? `No active outbreaks found for “${q.trim()}” — that usually means good news.`
            : "Nothing to show for this filter."}
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-stone-200">
          {ranked.map((item) => (
            <li key={item.slug}>
              <Link
                href={`${href}/${item.slug}`}
                className="flex items-start gap-3 py-3 active:bg-stone-100"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold">{item.name}</span>
                    <span
                      className="text-stone-400"
                      aria-label={`Trend: ${item.trend}`}
                      title={`Trend: ${item.trend}`}
                    >
                      {TREND_ARROWS[item.trend]}
                    </span>
                  </div>
                  {item.latestHeadline && (
                    // The marker sits outside the truncated span, so a long headline
                    // shortens instead of swallowing it.
                    <p className="mt-0.5 flex items-baseline gap-1 text-xs text-stone-500">
                      <span className="truncate">{item.latestHeadline}</span>
                      {item.namedInState && (
                        <span className="shrink-0 whitespace-nowrap text-stone-400">
                          · in {state}
                        </span>
                      )}
                    </p>
                  )}
                  {(item.sourceTier !== null || item.topSignal !== null) && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <RowTag item={item} />
                    </div>
                  )}
                </div>
                <TierBadge tier={item.tier} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {quiet.length > 0 && (
        <details className="mt-6 rounded-lg border border-stone-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-stone-700">
            Everything else — Very Low{" "}
            <span className="font-normal text-stone-400">({quiet.length})</span>
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-stone-500">
            {quiet.map((item, i) => (
              <span key={item.slug}>
                {i > 0 && " · "}
                <Link href={`${href}/${item.slug}`} className="hover:underline">
                  {item.name}
                </Link>
              </span>
            ))}
          </p>
        </details>
      )}
    </div>
  );
}
