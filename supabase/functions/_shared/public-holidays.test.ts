// deno-lint-ignore-file no-import-prefix -- Edge test imports use the repository's pinned lockfile.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  addBusinessDays,
  calculateBusinessDeadline,
  fetchPublicHolidays,
  filterHolidaysForSubdivision,
  type PublicHoliday,
} from "./public-holidays.ts";

// Public v4 response model: https://nagerholidays.com/api. These are synthetic
// rows, not live provider data. Interpretation of holiday types is unchanged.
function syntheticHoliday(): PublicHoliday {
  return {
    date: "2026-03-09",
    name: "Synthetic public holiday",
    countryCode: "AU",
    nationalHoliday: false,
    subdivisionCodes: ["AU-VIC"],
    holidayTypes: ["Public"],
  };
}

function holidayResponse(body: unknown): typeof fetch {
  return (input) => {
    assertEquals(
      String(input),
      "https://date.nager.at/api/v4/Holidays/AU/2026",
    );
    return Promise.resolve(Response.json(body));
  };
}

Deno.test("holiday client preserves the documented national and regional response variants", async () => {
  const rows: PublicHoliday[] = [
    { ...syntheticHoliday(), nationalHoliday: true, subdivisionCodes: null },
    syntheticHoliday(),
    {
      ...syntheticHoliday(),
      subdivisionCodes: [],
      holidayTypes: ["Bank", "School", "Authorities", "Optional", "Observance"],
    },
  ];
  assertEquals(
    await fetchPublicHolidays(2026, " au ", holidayResponse(rows)),
    rows,
  );
  assertEquals(await fetchPublicHolidays(2026, "AU", holidayResponse([])), []);
});

const malformedHolidayRows: Array<[string, (row: PublicHoliday) => unknown]> = [
  ["null row", () => null],
  ["array row", () => []],
  ["numeric date", (row) => ({ ...row, date: 20260309 })],
  ["impossible date", (row) => ({ ...row, date: "2026-02-30" })],
  ["different requested year", (row) => ({ ...row, date: "2027-03-09" })],
  ["different requested country", (row) => ({ ...row, countryCode: "NZ" })],
  ["numeric country", (row) => ({ ...row, countryCode: 61 })],
  ["missing name", (row) => {
    const { name: _name, ...rest } = row;
    return rest;
  }],
  ["object name", (row) => ({ ...row, name: { text: "Synthetic holiday" } })],
  ["blank name", (row) => ({ ...row, name: "   " })],
  ["truthy national flag", (row) => ({ ...row, nationalHoliday: "false" })],
  ["numeric national flag", (row) => ({ ...row, nationalHoliday: 1 })],
  ["missing national flag", (row) => {
    const { nationalHoliday: _national, ...rest } = row;
    return rest;
  }],
  ["string subdivisions", (row) => ({ ...row, subdivisionCodes: "AU-VIC" })],
  [
    "mixed subdivisions",
    (row) => ({ ...row, subdivisionCodes: ["AU-VIC", 2] }),
  ],
  [
    "wrong-country subdivision",
    (row) => ({ ...row, subdivisionCodes: ["NZ-AUK"] }),
  ],
  ["missing subdivisions", (row) => {
    const { subdivisionCodes: _subdivisions, ...rest } = row;
    return rest;
  }],
  ["string holiday types", (row) => ({ ...row, holidayTypes: "Public" })],
  [
    "mixed holiday types",
    (row) => ({ ...row, holidayTypes: ["Public", false] }),
  ],
  [
    "unknown holiday type",
    (row) => ({ ...row, holidayTypes: ["SyntheticUnknown"] }),
  ],
  ["missing holiday types", (row) => {
    const { holidayTypes: _types, ...rest } = row;
    return rest;
  }],
];

for (const [reason, mutate] of malformedHolidayRows) {
  Deno.test(
    "holiday client rejects " + reason + " before publishing provider rows",
    async () => {
      await assertRejects(() =>
        fetchPublicHolidays(
          2026,
          "AU",
          holidayResponse([mutate(syntheticHoliday())]),
        )
      );
    },
  );
}

Deno.test("holiday client does not reinterpret a truthy regional flag as a national closure", async () => {
  await assertRejects(() =>
    calculateBusinessDeadline({
      startDate: "2026-03-06",
      businessDays: 1,
      subdivisionCode: "AU-WA",
      fetchImpl: holidayResponse([{
        ...syntheticHoliday(),
        nationalHoliday: "false",
      }]),
    })
  );
});

Deno.test("holiday client rejects a success envelope instead of treating it as the v4 row array", async () => {
  await assertRejects(() =>
    fetchPublicHolidays(
      2026,
      "AU",
      holidayResponse({ success: true, result: [syntheticHoliday()] }),
    )
  );
});

for (const mime of ["text/html", "application/jsonp", "text/plain"]) {
  Deno.test(
    "holiday client rejects a JSON-looking " + mime + " response",
    async () => {
      await assertRejects(() =>
        fetchPublicHolidays(2026, "AU", () =>
          Promise.resolve(
            new Response("[]", { headers: { "Content-Type": mime } }),
          ))
      );
    },
  );
}

Deno.test("holiday client prevents the fetch transport from following an unreviewed redirect", async () => {
  let followed = false;
  await assertRejects(() =>
    fetchPublicHolidays(2026, "AU", (_input, init) => {
      if (init?.redirect === "error") {
        return Promise.reject(new TypeError("Synthetic redirect rejected"));
      }
      followed = true;
      return Promise.resolve(Response.json([]));
    })
  );
  assertEquals(followed, false);
});

Deno.test("holiday client rejects a response that already followed a redirect", async () => {
  const response = Response.json([]);
  Object.defineProperty(response, "redirected", { value: true });
  Object.defineProperty(response, "url", {
    value: "https://unreviewed.example/holidays",
  });
  await assertRejects(() =>
    fetchPublicHolidays(2026, "AU", () => Promise.resolve(response))
  );
});

Deno.test("holiday client rejects malformed UTF-8 instead of substituting a replacement in holiday evidence", async () => {
  const before = new TextEncoder().encode(
    JSON.stringify([syntheticHoliday()]).replace(
      "Synthetic public holiday",
      "",
    ),
  );
  const index = new TextDecoder().decode(before).indexOf('"name":"') +
    '"name":"'.length;
  const bytes = new Uint8Array(before.length + 1);
  bytes.set(before.subarray(0, index));
  bytes[index] = 0xff;
  bytes.set(before.subarray(index), index + 1);
  await assertRejects(() =>
    fetchPublicHolidays(
      2026,
      "AU",
      () =>
        Promise.resolve(
          new Response(bytes, {
            headers: { "Content-Type": "application/json" },
          }),
        ),
    )
  );
});

Deno.test("holiday client accepts exactly 1 MiB and rejects one more decoded response byte", async () => {
  const maximum = 1024 * 1024;
  assertEquals(
    await fetchPublicHolidays(2026, "AU", () =>
      Promise.resolve(
        new Response("[]" + " ".repeat(maximum - 2), {
          headers: { "Content-Type": "application/json" },
        }),
      )),
    [],
  );
  await assertRejects(() =>
    fetchPublicHolidays(
      2026,
      "AU",
      () =>
        Promise.resolve(
          new Response("[]" + " ".repeat(maximum - 1), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
    )
  );
});

Deno.test("holiday client rejects an oversized declared body without reading it", async () => {
  let pulls = 0;
  let cancelled = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("[]"));
        controller.close();
      },
      cancel() {
        cancelled += 1;
      },
    }, { highWaterMark: 0 }),
    {
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(1024 * 1024 + 1),
      },
    },
  );
  await assertRejects(() =>
    fetchPublicHolidays(2026, "AU", () => Promise.resolve(response))
  );
  assertEquals(pulls, 0);
  assertEquals(cancelled, 1);
});

Deno.test("holiday client keeps a known HTTP failure distinct from an uncertain fetch", async () => {
  const known = await assertRejects(() =>
    fetchPublicHolidays(
      2026,
      "AU",
      () =>
        Promise.resolve(
          new Response("Synthetic private diagnostic", { status: 503 }),
        ),
    )
  );
  assert(known instanceof Error);
  assert("dispatchCertain" in known);
  assertEquals(known.dispatchCertain, true);
  assert(!known.message.includes("Synthetic private diagnostic"));
  const uncertain = await assertRejects(() =>
    fetchPublicHolidays(
      2026,
      "AU",
      () =>
        Promise.reject(new TypeError("Synthetic private network diagnostic")),
    )
  );
  assert(uncertain instanceof Error);
  assert("dispatchCertain" in uncertain);
  assertEquals(uncertain.dispatchCertain, false);
  assert(!uncertain.message.includes("Synthetic private network diagnostic"));
});

Deno.test("deadline cancellation before admission does not fetch holidays", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Synthetic caller cancellation"));
  const counter = { calls: 0 };
  const input = {
    startDate: "2026-03-06",
    businessDays: 1,
    signal: controller.signal,
    fetchImpl: countingHolidayFetch(counter),
  };
  await assertRejects(() => calculateBusinessDeadline(input));
  assertEquals(counter.calls, 0);
});

Deno.test("deadline cancellation reaches an already pending holiday fetch and blocks publication", async () => {
  const controller = new AbortController();
  const signals: Array<AbortSignal | null | undefined> = [];
  let resolveResponse: (response: Response) => void = () => {
    throw new Error("Synthetic fetch has not started");
  };
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const input = {
    startDate: "2026-03-06",
    businessDays: 1,
    signal: controller.signal,
    fetchImpl: ((_url, init) => {
      signals.push(init?.signal);
      return response;
    }) satisfies typeof fetch,
  };
  const pending = calculateBusinessDeadline(input);
  const observed = pending.then(
    () => ({ rejected: false }),
    () => ({ rejected: true }),
  );
  assertEquals(signals.length, 1);
  const signal = signals[0];
  assert(signal);
  controller.abort(new Error("Synthetic caller cancellation"));
  resolveResponse(Response.json([]));
  const result = await observed;
  assertEquals(result.rejected, true);
  assertEquals(signal.aborted, true);
});

Deno.test("holiday client enforces the elapsed deadline even when the timeout callback has not run", async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    await assertRejects(() =>
      fetchPublicHolidays(2026, "AU", () => {
        now += 8001;
        return Promise.resolve(Response.json([]));
      })
    );
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("deadline joins admitted holiday years and preserves an uncertain sibling over a known HTTP failure", async () => {
  let rejectPending: (reason: unknown) => void = () => { throw new Error("Synthetic year not requested"); };
  const held = new Promise<Response>((_resolve, reject) => { rejectPending = reject; });
  const years: string[] = [];
  const pending = calculateBusinessDeadline({
    startDate: "2026-12-31",
    businessDays: 1,
    fetchImpl: (input) => {
      const year = new URL(String(input)).pathname.split("/").at(-1) ?? "";
      years.push(year);
      return year === "2026" ? Promise.resolve(new Response(null, { status: 503 })) : held;
    },
  });
  let settled = false;
  const observed = pending.then(
    () => { settled = true; return null; },
    (error: unknown) => { settled = true; return error; },
  );
  // Let the known response finish while the other already-admitted year stays
  // unresolved. Release it before assertions so even a failing fixture drains.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const settledBeforeSibling = settled;
  rejectPending(new TypeError("Synthetic year response lost"));
  const error = await observed;
  assertEquals(years, ["2026", "2027"]);
  assertEquals(settledBeforeSibling, false);
  assert(error instanceof Error);
  assert("dispatchCertain" in error);
  assertEquals(error.dispatchCertain, false);
});

Deno.test("deadline retains its accepted inputs across holiday expansion awaits", async () => {
  let release: (response: Response) => void = () => { throw new Error("Synthetic first year not requested"); };
  const held = new Promise<Response>((resolve) => { release = resolve; });
  const requested: string[] = [];
  const input = {
    startDate: "2026-12-30", businessDays: 1, countryCode: "AU", subdivisionCode: "AU-VIC",
    fetchImpl: ((url) => {
      const path = new URL(String(url)).pathname;
      requested.push(path);
      return path.endsWith("/2026") ? held : Promise.resolve(Response.json([]));
    }) satisfies typeof fetch,
  };
  const pending = calculateBusinessDeadline(input);
  input.startDate = "2020-01-01";
  input.businessDays = 42;
  input.countryCode = "NZ";
  input.subdivisionCode = "NZ-AUK";
  release(Response.json([{ ...syntheticHoliday(), date: "2026-12-31" }]));
  const result = await pending;
  assertEquals(result.deadline, "2027-01-01");
  assertEquals(result.holidaysConsidered, [{ ...syntheticHoliday(), date: "2026-12-31" }]);
  assertEquals(requested, ["/api/v4/Holidays/AU/2026", "/api/v4/Holidays/AU/2027"]);
});

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
