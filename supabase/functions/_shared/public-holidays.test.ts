import {
  addBusinessDays,
  calculateBusinessDeadline,
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
  const result = addBusinessDays("2026-03-06", 2, new Set(["2026-03-09"]));
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

function countingHolidayFetch(counter: { calls: number }): typeof fetch {
  return (_input, _init) => {
    counter.calls += 1;
    return Promise.resolve(
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

function weekdayHolidays(year: number): PublicHoliday[] {
  const values: PublicHoliday[] = [];
  const cursor = new Date(`${year}-01-01T00:00:00Z`);
  while (cursor.getUTCFullYear() === year) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      values.push({
        date: cursor.toISOString().slice(0, 10),
        name: "Synthetic closure",
        countryCode: "AU",
        nationalHoliday: true,
        subdivisionCodes: null,
        holidayTypes: ["Public"],
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return values;
}

Deno.test(
  "calculateBusinessDeadline rejects invalid day counts before holiday fan-out",
  async () => {
    for (const businessDays of [-1, 3661, 4000]) {
      const counter = { calls: 0 };
      let rejected = false;
      try {
        await calculateBusinessDeadline({
          startDate: "2026-03-06",
          businessDays,
          fetchImpl: countingHolidayFetch(counter),
        });
      } catch {
        rejected = true;
      }
      if (!rejected) {
        throw new Error(`Expected ${businessDays} days to be rejected.`);
      }
      if (counter.calls !== 0) {
        throw new Error(
          `Invalid ${businessDays}-day request started ${counter.calls} fetches.`,
        );
      }
    }
  },
);

Deno.test(
  "calculateBusinessDeadline rejects an unsupported year span before fetching",
  async () => {
    const counter = { calls: 0 };
    let rejected = false;
    try {
      await calculateBusinessDeadline({
        startDate: "2199-01-01",
        businessDays: 3660,
        fetchImpl: countingHolidayFetch(counter),
      });
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(
        "Expected an unsupported holiday year span to be rejected.",
      );
    }
    if (counter.calls !== 0) {
      throw new Error(
        `Unsupported year span started ${counter.calls} fetches.`,
      );
    }
  },
);

Deno.test(
  "calculateBusinessDeadline accepts a supported terminal year without speculative overflow",
  async () => {
    const counter = { calls: 0 };
    const result = await calculateBusinessDeadline({
      startDate: "2200-01-01",
      businessDays: 1,
      fetchImpl: countingHolidayFetch(counter),
    });

    if (!result.deadline.startsWith("2200-")) {
      throw new Error(`Expected a 2200 deadline, received ${result.deadline}.`);
    }
    if (counter.calls !== 1) {
      throw new Error(
        `Expected one terminal-year fetch, received ${counter.calls}.`,
      );
    }
  },
);

Deno.test(
  "calculateBusinessDeadline fetches every year reached after holiday expansion",
  async () => {
    const fetchedYears: number[] = [];
    const fetchImpl: typeof fetch = (input) => {
      const year = Number(new URL(String(input)).pathname.split("/").pop());
      fetchedYears.push(year);
      const body = year === 2026 || year === 2027 ? weekdayHolidays(year) : [];
      return Promise.resolve(Response.json(body));
    };
    const result = await calculateBusinessDeadline({
      startDate: "2026-01-01",
      businessDays: 250,
      fetchImpl,
    });
    const terminalYear = Number(result.deadline.slice(0, 4));

    if (!fetchedYears.includes(terminalYear)) {
      throw new Error(
        `Deadline reached unfetched year ${terminalYear}; fetched ${
          fetchedYears.join(",")
        }.`,
      );
    }
  },
);

Deno.test(
  "calculateBusinessDeadline preserves the supported maximum with bounded fan-out",
  async () => {
    const counter = { calls: 0 };
    const result = await calculateBusinessDeadline({
      startDate: "2026-01-01",
      businessDays: 3660,
      fetchImpl: countingHolidayFetch(counter),
    });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(result.deadline)) {
      throw new Error(`Unexpected deadline: ${result.deadline}`);
    }
    if (counter.calls !== 15) {
      throw new Error(
        `Expected 15 exact-range holiday fetches, received ${counter.calls}.`,
      );
    }
  },
);
