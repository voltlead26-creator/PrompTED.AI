import {
  addBusinessDays,
  filterHolidaysForSubdivision,
  type PublicHoliday,
} from "./public-holidays.ts";

const holidays: PublicHoliday[] = [
  {
    date: "2026-01-01",
    name: "New Year's Day",
    countryCode: "AU",
    nationalHoliday: true,
    subdivisionCodes: null,
    holidayTypes: ["Public"],
  },
  {
    date: "2026-03-09",
    name: "Labour Day",
    countryCode: "AU",
    nationalHoliday: false,
    subdivisionCodes: ["AU-VIC"],
    holidayTypes: ["Public"],
  },
  {
    date: "2026-03-02",
    name: "Labour Day",
    countryCode: "AU",
    nationalHoliday: false,
    subdivisionCodes: ["AU-WA"],
    holidayTypes: ["Public"],
  },
];

Deno.test("filterHolidaysForSubdivision keeps national and matching state holidays", () => {
  const result = filterHolidaysForSubdivision(holidays, "AU-VIC");
  const dates = result.map((holiday) => holiday.date);
  if (dates.join(",") !== "2026-01-01,2026-03-09") {
    throw new Error(`Unexpected holidays: ${dates.join(",")}`);
  }
});

Deno.test("addBusinessDays skips weekends and public holidays", () => {
  const result = addBusinessDays(
    "2026-03-06",
    2,
    new Set(["2026-03-09"]),
  );
  if (result !== "2026-03-11") {
    throw new Error(`Unexpected deadline: ${result}`);
  }
});

Deno.test("addBusinessDays rejects negative day counts", () => {
  let rejected = false;
  try {
    addBusinessDays("2026-03-06", -1, new Set());
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expected negative day count to be rejected.");
});
