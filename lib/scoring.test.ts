// Unit tests for the scoring model. Run with `npm test` (node:test + Node's
// built-in TypeScript stripping — no test framework dependency).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HALF_LIFE_DAYS,
  INACTIVE_DECAY,
  aggregateRisk,
  combineScores,
  confidenceOf,
  decayOf,
  domainOf,
  rawTier,
  scoreOutbreak,
  tierFor,
  trendBetween,
  type ScorableOutbreak,
  type ScorableReport,
} from "./scoring.ts";

const NOW = new Date("2026-09-01T00:00:00Z");
const MS_PER_DAY = 86_400_000;

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * MS_PER_DAY).toISOString();
}

function report(over: Partial<ScorableReport> = {}): ScorableReport {
  return {
    url: "https://example.com/a",
    source_tier: 2,
    published_at: daysAgo(1),
    ...over,
  };
}

function outbreak(over: Partial<ScorableOutbreak> = {}): ScorableOutbreak {
  return {
    severity: 3,
    last_reported_at: daysAgo(0),
    reports: [report({ source_tier: 1, url: "https://fda.gov/x" })],
    ...over,
  };
}

// ── domain extraction ────────────────────────────────────────────────────────

test("domainOf strips subdomains and www to the registrable domain", () => {
  assert.equal(domainOf("https://www.cnn.com/2026/story"), "cnn.com");
  assert.equal(domainOf("https://rss.cnn.com/x"), "cnn.com");
  assert.equal(domainOf("https://foodsafetynews.com/a"), "foodsafetynews.com");
  assert.equal(domainOf("not a url"), "not a url");
});

// ── confidence ───────────────────────────────────────────────────────────────

test("confidence: any tier-1 report is full confidence", () => {
  assert.equal(confidenceOf([report({ source_tier: 1, url: "https://fda.gov/a" })]), 1);
  assert.equal(
    confidenceOf([
      report({ source_tier: 3, url: "https://blog.example.com/a" }),
      report({ source_tier: 1, url: "https://cdc.gov/b" }),
    ]),
    1,
  );
});

test("confidence: two independent non-official domains corroborate to 0.85", () => {
  assert.equal(
    confidenceOf([
      report({ source_tier: 2, url: "https://foodsafetynews.com/a" }),
      report({ source_tier: 3, url: "https://localpaper.example/b" }),
    ]),
    0.85,
  );
});

test("confidence: the same outlet twice is not corroboration", () => {
  assert.equal(
    confidenceOf([
      report({ source_tier: 2, url: "https://www.cnn.com/a" }),
      report({ source_tier: 2, url: "https://cnn.com/b" }),
    ]),
    0.7,
  );
});

test("confidence: single tier-2 is 0.7, single tier-3 is 0.4", () => {
  assert.equal(confidenceOf([report({ source_tier: 2 })]), 0.7);
  assert.equal(confidenceOf([report({ source_tier: 3 })]), 0.4);
});

test("confidence: an outbreak with no reports scores zero", () => {
  assert.equal(confidenceOf([]), 0);
});

// ── decay ────────────────────────────────────────────────────────────────────

test("decay halves every 30 days and is 1 on the day of reporting", () => {
  assert.equal(decayOf(daysAgo(0), NOW), 1);
  assert.ok(Math.abs(decayOf(daysAgo(HALF_LIFE_DAYS), NOW) - 0.5) < 1e-9);
  assert.ok(Math.abs(decayOf(daysAgo(60), NOW) - 0.25) < 1e-9);
});

test("decay never exceeds 1, even for a report dated in the future", () => {
  assert.equal(decayOf(new Date(NOW.getTime() + 5 * MS_PER_DAY), NOW), 1);
});

test("an outbreak quiet for ~4+ months falls below the active threshold", () => {
  const quiet = scoreOutbreak(outbreak({ last_reported_at: daysAgo(140) }), NOW);
  assert.ok(quiet.decay < INACTIVE_DECAY);
  assert.equal(quiet.active, false);

  const fresh = scoreOutbreak(outbreak({ last_reported_at: daysAgo(120) }), NOW);
  assert.ok(fresh.decay >= INACTIVE_DECAY);
  assert.equal(fresh.active, true);
});

// ── per-outbreak score ───────────────────────────────────────────────────────

test("S = (severity / 3) × C × D", () => {
  const scored = scoreOutbreak(
    outbreak({
      severity: 2,
      last_reported_at: daysAgo(HALF_LIFE_DAYS),
      reports: [report({ source_tier: 2, url: "https://foodsafetynews.com/a" })],
    }),
    NOW,
  );
  // (2/3) × 0.7 × 0.5
  assert.ok(Math.abs(scored.score - (2 / 3) * 0.7 * 0.5) < 1e-9);
});

test("a fresh severity-3 official recall scores 1.0 — the model's ceiling", () => {
  assert.equal(scoreOutbreak(outbreak(), NOW).score, 1);
});

// ── compounding ──────────────────────────────────────────────────────────────

test("concurrent outbreaks compound rather than the worst one winning", () => {
  assert.ok(Math.abs(combineScores([0.5, 0.5]) - 0.75) < 1e-9);
  assert.ok(combineScores([0.3, 0.3]) > 0.3);
  assert.equal(combineScores([]), 0);
  assert.equal(combineScores([1, 0.4]), 1);
});

// ── tier mapping ─────────────────────────────────────────────────────────────

test("tier boundaries match the published table", () => {
  assert.equal(rawTier(0.7), "very-high");
  assert.equal(rawTier(0.69), "high");
  assert.equal(rawTier(0.4), "high");
  assert.equal(rawTier(0.39), "moderate");
  assert.equal(rawTier(0.2), "moderate");
  assert.equal(rawTier(0.19), "low");
  assert.equal(rawTier(0.07), "low");
  assert.equal(rawTier(0.069), "very-low");
  assert.equal(rawTier(0), "very-low");
});

// ── trust cap ────────────────────────────────────────────────────────────────

test("trust cap: only weakly-sourced outbreaks cannot exceed Moderate", () => {
  assert.equal(tierFor(0.95, [0.4, 0.4]), "moderate");
  assert.equal(tierFor(0.95, [0.4]), "moderate");
});

test("trust cap does not push a low rating up", () => {
  assert.equal(tierFor(0.1, [0.4]), "low");
  assert.equal(tierFor(0, [0.4]), "very-low");
});

test("one better-sourced outbreak lifts the cap", () => {
  assert.equal(tierFor(0.95, [0.4, 0.7]), "very-high");
  assert.equal(tierFor(0.95, [1]), "very-high");
});

test("an item with no active outbreaks is Very Low, not capped", () => {
  assert.equal(tierFor(0, []), "very-low");
});

test("the cap applies end to end: a rumor-only food stays at Moderate", () => {
  const rumors = [1, 2, 3].map((i) => ({
    outbreak: outbreak({
      severity: 3,
      last_reported_at: daysAgo(0),
      reports: [report({ source_tier: 3, url: `https://blog${i}.example/a` })],
    }),
  }));
  const risk = aggregateRisk(rumors, NOW);
  assert.ok(risk.r > 0.7, "raw R clears the Very High threshold");
  assert.equal(risk.tier, "moderate", "but weak sourcing caps it");
});

// ── aggregate & trend ────────────────────────────────────────────────────────

test("dormant outbreaks are excluded from the aggregate", () => {
  const risk = aggregateRisk(
    [{ outbreak: outbreak({ last_reported_at: daysAgo(200) }) }],
    NOW,
  );
  assert.equal(risk.activeCount, 0);
  assert.equal(risk.r, 0);
  assert.equal(risk.tier, "very-low");
});

test("trend rises when a quiet outbreak gets fresh reporting this week", () => {
  const risk = aggregateRisk(
    [
      {
        outbreak: outbreak({
          severity: 3,
          last_reported_at: daysAgo(1),
          reports: [
            report({ source_tier: 2, url: "https://foodsafetynews.com/old", published_at: daysAgo(45) }),
            report({ source_tier: 2, url: "https://foodsafetynews.com/new", published_at: daysAgo(1) }),
          ],
        }),
      },
    ],
    NOW,
  );
  assert.equal(risk.trend, "rising");
});

test("trend falls as an outbreak goes quiet", () => {
  const risk = aggregateRisk(
    [
      {
        outbreak: outbreak({
          severity: 3,
          last_reported_at: daysAgo(40),
          reports: [report({ source_tier: 1, url: "https://fda.gov/a", published_at: daysAgo(40) })],
        }),
      },
    ],
    NOW,
  );
  assert.equal(risk.trend, "falling");
});

test("a brand-new outbreak with no prior week of reporting reads as rising", () => {
  const risk = aggregateRisk(
    [
      {
        outbreak: outbreak({
          last_reported_at: daysAgo(2),
          reports: [report({ source_tier: 1, url: "https://fda.gov/a", published_at: daysAgo(2) })],
        }),
      },
    ],
    NOW,
  );
  assert.equal(risk.trend, "rising");
});

test("trendBetween: tier movement outranks the relative-change test", () => {
  assert.equal(trendBetween(0.41, 0.39, "high", "moderate"), "rising");
  assert.equal(trendBetween(0.39, 0.41, "moderate", "high"), "falling");
  assert.equal(trendBetween(0.5, 0.49, "high", "high"), "steady");
  assert.equal(trendBetween(0.5, 0.2, "high", "high"), "rising");
  assert.equal(trendBetween(0.2, 0.5, "high", "high"), "falling");
  assert.equal(trendBetween(0, 0, "very-low", "very-low"), "steady");
});

// ── §7 chain weighting ───────────────────────────────────────────────────────

test("chain weights scale a contribution without changing its confidence", () => {
  const o = outbreak({ severity: 3, last_reported_at: daysAgo(0) });

  const direct = aggregateRisk([{ outbreak: o, weight: 1 }], NOW);
  const supplier = aggregateRisk([{ outbreak: o, weight: 0.8 }], NOW);
  const ingredient = aggregateRisk([{ outbreak: o, weight: 0.3 }], NOW);

  assert.equal(direct.r, 1);
  assert.ok(Math.abs(supplier.r - 0.8) < 1e-9);
  assert.ok(Math.abs(ingredient.r - 0.3) < 1e-9);
  assert.equal(supplier.tier, "very-high");
  assert.equal(ingredient.tier, "moderate");
});
