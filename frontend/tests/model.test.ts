import { test } from "node:test";
import assert from "node:assert/strict";
import {
  period,
  stamp,
  pointInfo,
  readFilters,
  defaults,
  query,
  validRange,
  disambiguate,
  chartCeiling,
} from "../src/lib/model";
test("month and year use Beijing calendar boundaries including leap year", () => {
  assert.deepEqual(period("month", stamp("2024-02-29T12:00")), {
    from: "2024-02-01T00:00",
    to: "2024-03-01T00:00",
  });
  const p = period("year", stamp("2024-02-29T12:00"));
  assert.equal((stamp(p.to) - stamp(p.from)) / 86400000, 366);
  assert.deepEqual(period("month", stamp("2026-12-12T12:00")), {
    from: "2026-12-01T00:00",
    to: "2027-01-01T00:00",
  });
});
test("URL overrides preferences and legacy date end remains inclusive", () => {
  const f = readFilters(
    "?from=2026-09-01&to=2026-09-12&chart_type=bar&app_mode=separate",
    { ...defaults, chart_type: "line" },
  );
  assert.equal(f.to, "2026-09-13T00:00");
  assert.equal(f.from, "2026-09-01T00:00");
  assert.equal(f.chart_type, "bar");
  assert.equal(f.app_mode, "separate");
  assert.deepEqual(readFilters("?" + query(f), defaults), f);
});
test("range validation rejects reverse, oversized and subminute queries", () => {
  assert.equal(validRange("2026-09-12T12:00", "2026-09-12T12:01"), true);
  for (const [a, b] of [
    ["2026-09-12T12:01", "2026-09-12T12:00"],
    ["2024-01-01T00:00", "2025-01-02T00:00"],
    ["2026-09-12T12:00:30", "2026-09-12T12:01"],
  ])
    assert.equal(validRange(a, b), false);
});
test("calendar distinguishes missing, zero observed, partial, and future", () => {
  const p = {
      time: "2026-09-12T00:00:00+08:00",
      upload: 0,
      download: 0,
      coverage: 0,
      duration: 86400,
    },
    from = "2026-09-12T00:00",
    to = "2026-09-13T00:00",
    now = stamp("2026-09-12T12:00");
  assert.equal(pointInfo(p, from, to, now).missing, true);
  assert.equal(
    pointInfo({ ...p, coverage: 43200 }, from, to, now).missing,
    false,
  );
  assert.equal(
    pointInfo({ ...p, coverage: 60, download: 5 }, from, to, now).partial,
    true,
  );
  assert.equal(pointInfo(p, from, to, stamp("2026-09-11T23:59")).future, true);
});
test("heat thresholds preserve exact boundaries", () => {
  const p = {
    time: "2026-09-12T00:00:00+08:00",
    upload: 0,
    download: 0,
    coverage: 60,
    duration: 60,
  };
  for (const [download, level] of [
    [0, 0],
    [1, 1],
    [10 * 1024 ** 2 - 1, 1],
    [10 * 1024 ** 2, 2],
    [100 * 1024 ** 2, 3],
    [1024 ** 3, 4],
  ])
    assert.equal(
      pointInfo(
        { ...p, download },
        "2026-09-12T00:00",
        "2026-09-12T00:01",
        stamp("2026-09-13T00:00"),
      ).level,
      level,
    );
});
test("duplicate labels are disambiguated by identity", () => {
  const rows = disambiguate([
    { id: "one", name: "Chrome" },
    { id: "two", name: "Chrome" },
    { id: "three", name: "Codex" },
  ]);
  assert.equal(rows[0].label, "Chrome · one");
  assert.equal(rows[1].label, "Chrome · two");
  assert.equal(rows[2].label, "Codex");
});

test("chart axis uses readable binary units", () => {
  assert.equal(chartCeiling(18 * 1024 ** 2), 20 * 1024 ** 2);
  assert.ok(chartCeiling(1025) >= 1025);
});
