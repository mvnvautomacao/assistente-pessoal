import { test } from "node:test";
import assert from "node:assert/strict";
import { singleDayRange, lastNDaysRange } from "../../src/expenses/reportText";

test("singleDayRange cobre exatamente um dia (start inclusivo, end exclusivo)", () => {
  const range = singleDayRange("2026-08-25", "hoje");
  assert.equal(range.start, "2026-08-25");
  assert.equal(range.end, "2026-08-26");
  assert.equal(range.label, "hoje");
});

test("singleDayRange atravessa corretamente a virada de mes e de ano", () => {
  assert.equal(singleDayRange("2026-01-31", "x").end, "2026-02-01");
  assert.equal(singleDayRange("2026-12-31", "x").end, "2027-01-01");
});

test("lastNDaysRange inclui hoje e cobre N dias", () => {
  const range = lastNDaysRange(7);
  const startDate = new Date(range.start);
  const endDate = new Date(range.end);
  const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  assert.equal(diffDays, 7);
});
