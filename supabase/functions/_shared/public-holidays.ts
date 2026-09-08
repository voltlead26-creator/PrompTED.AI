import {
  ExternalJsonError,
  fetchBoundedExternalJson,
} from "./bounded-external-json.ts";

export interface PublicHoliday {
  date: string;
  name: string;
  countryCode: string;
  nationalHoliday: boolean;
  subdivisionCodes: string[] | null;
  holidayTypes: string[];
}

export class HolidayDispatchError extends Error {
  constructor(message: string, readonly dispatchCertain: boolean) {
    super(message);
  }
}

export class HolidayInputError extends Error {}

/** Internal lookup seam: callers wrap each accepted year in the existing egress ledger. */
export type HolidayYearLookup = (
  year: number,
  countryCode: string,
  signal?: AbortSignal,
) => Promise<PublicHoliday[]>;

const NAGER_BASE_URL = "https://date.nager.at/api/v4/Holidays";
const MIN_HOLIDAY_YEAR = 1900;
const MAX_HOLIDAY_YEAR = 2200;
const MAX_BUSINESS_DAYS = 3660;
const MAX_HOLIDAY_FETCH_YEARS = 20;
const MAX_HOLIDAY_RESPONSE_BYTES = 1024 * 1024;
const MAX_HOLIDAY_ROWS = 1000;
const HOLIDAY_TYPES = new Set([
  "Public", "Bank", "School", "Authorities", "Optional", "Observance",
]);

function normaliseCountryCode(value: string): string {
  if (typeof value !== "string") {
    throw new HolidayInputError("countryCode must be a two-letter ISO code.");
  }
  const country = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new HolidayInputError("countryCode must be a two-letter ISO code.");
  }
  return country;
}

function validateHolidayResponse(
  body: unknown,
  country: string,
  year: number,
): PublicHoliday[] {
  const invalid = () => new Error("Holiday provider returned an invalid response.");
  if (!Array.isArray(body) || body.length > MAX_HOLIDAY_ROWS) throw invalid();
  return body.map((value): PublicHoliday => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw invalid();
    }
    const row = value as Record<string, unknown>;
    if (
      typeof row.date !== "string" || !row.date.startsWith(`${year}-`) ||
      typeof row.name !== "string" || !row.name.trim() || row.name.length > 2000 ||
      row.countryCode !== country || typeof row.nationalHoliday !== "boolean" ||
      !Array.isArray(row.holidayTypes) || row.holidayTypes.length > HOLIDAY_TYPES.size ||
      !row.holidayTypes.every((type) => typeof type === "string" && HOLIDAY_TYPES.has(type))
    ) throw invalid();
    assertIsoDate(row.date);
    const subdivisions = row.subdivisionCodes;
    if (
      subdivisions !== null &&
      (!Array.isArray(subdivisions) || subdivisions.length > 512 ||
        !subdivisions.every((code) => typeof code === "string" &&
          code.startsWith(`${country}-`) && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(code)))
    ) throw invalid();
    // Publish only validated v4 fields. Do not coerce flags, replace names,
    // reinterpret holiday categories, or manufacture jurisdiction evidence.
    return {
      date: row.date,
      name: row.name,
      countryCode: country,
      nationalHoliday: row.nationalHoliday,
      subdivisionCodes: subdivisions === null ? null : [...subdivisions],
      holidayTypes: [...row.holidayTypes],
    };
  });
}

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HolidayInputError("Date must use YYYY-MM-DD format.");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new HolidayInputError("Date is invalid.");
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function assertBusinessDays(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_BUSINESS_DAYS
  ) {
    throw new HolidayInputError(
      `businessDays must be an integer between 0 and ${MAX_BUSINESS_DAYS}.`,
    );
  }
}

function assertHolidayYear(year: number): void {
  if (
    !Number.isInteger(year) || year < MIN_HOLIDAY_YEAR ||
    year > MAX_HOLIDAY_YEAR
  ) {
    throw new HolidayInputError(
      `year must be between ${MIN_HOLIDAY_YEAR} and ${MAX_HOLIDAY_YEAR}.`,
    );
  }
}

export function filterHolidaysForSubdivision(
  holidays: PublicHoliday[],
  subdivisionCode?: string,
): PublicHoliday[] {
  const subdivision = subdivisionCode?.trim().toUpperCase();
  return holidays.filter((holiday) => {
    if (holiday.nationalHoliday || !holiday.subdivisionCodes?.length) {
      return true;
    }
    return Boolean(
      subdivision && holiday.subdivisionCodes.includes(subdivision),
    );
  });
}

export function addBusinessDays(
  startDate: string,
  businessDays: number,
  holidayDates: Set<string>,
): string {
  assertIsoDate(startDate);
  assertBusinessDays(businessDays);

  const cursor = new Date(`${startDate}T00:00:00Z`);
  let remaining = businessDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    const date = formatDate(cursor);
    if (day === 0 || day === 6 || holidayDates.has(date)) continue;
    remaining -= 1;
  }
  return formatDate(cursor);
}

export async function fetchPublicHolidays(
  year: number,
  countryCode = "AU",
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PublicHoliday[]> {
  const url = buildPublicHolidaysUrl(year, countryCode);
  const country = normaliseCountryCode(countryCode);

  try {
    return await fetchBoundedExternalJson({
      url,
      maximumBytes: MAX_HOLIDAY_RESPONSE_BYTES,
      timeoutMs: 8000,
      fetchImpl,
      signal,
      validate: (body) => validateHolidayResponse(body, country, year),
    });
  } catch (error) {
    if (error instanceof ExternalJsonError) {
      throw new HolidayDispatchError(
        error.failure === "http_error"
          ? `Holiday provider returned HTTP ${error.httpStatus}.`
          : error.dispatchCertain
          ? "Holiday provider returned an invalid or interrupted response."
          : "Holiday provider request outcome is uncertain.",
        error.dispatchCertain,
      );
    }
    throw error;
  }
}

export function buildPublicHolidaysUrl(year: number, countryCode = "AU"): string {
  assertHolidayYear(year);
  return `${NAGER_BASE_URL}/${normaliseCountryCode(countryCode)}/${year}`;
}

export async function calculateBusinessDeadline(input: {
  startDate: string;
  businessDays: number;
  countryCode?: string;
  subdivisionCode?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  lookupHolidays?: HolidayYearLookup;
}): Promise<{
  deadline: string;
  holidaysConsidered: PublicHoliday[];
}> {
  const { startDate, businessDays, subdivisionCode, signal } = input;
  const country = normaliseCountryCode(input.countryCode === undefined ? "AU" : input.countryCode);
  const fetchImpl = input.fetchImpl ?? fetch;
  const lookupHolidays: HolidayYearLookup = input.lookupHolidays ?? ((year, countryCode, signal) =>
    fetchPublicHolidays(year, countryCode, fetchImpl, signal));
  signal?.throwIfAborted();
  assertIsoDate(startDate);
  assertBusinessDays(businessDays);
  if (subdivisionCode !== undefined && typeof subdivisionCode !== "string") {
    throw new HolidayInputError("subdivisionCode must be a string.");
  }
  const startYear = Number(startDate.slice(0, 4));
  assertHolidayYear(startYear);
  const weekendOnlyDeadline = addBusinessDays(
    startDate,
    businessDays,
    new Set(),
  );
  const initialEndYear = Number(weekendOnlyDeadline.slice(0, 4));
  assertHolidayYear(initialEndYear);

  const fetchedByYear = new Map<number, PublicHoliday[]>();
  let fetchedThrough = startYear - 1;
  const fetchThrough = async (targetYear: number): Promise<void> => {
    signal?.throwIfAborted();
    assertHolidayYear(targetYear);
    if (targetYear <= fetchedThrough) return;
    const totalYearCount = targetYear - startYear + 1;
    if (totalYearCount > MAX_HOLIDAY_FETCH_YEARS) {
      throw new HolidayInputError(
        `Deadline calculation exceeds the ${MAX_HOLIDAY_FETCH_YEARS}-year holiday lookup limit.`,
      );
    }
    const years = Array.from(
      { length: targetYear - fetchedThrough },
      (_, index) => fetchedThrough + index + 1,
    );
    const fetched = await Promise.allSettled(
      years.map((year) =>
        lookupHolidays(
          year,
          country,
          signal,
        )
      ),
    );
    // Join every bounded sibling before reporting failure. A known bad response
    // must not conceal another year's uncertain dispatch or leave it running.
    for (const result of fetched) {
      if (result.status === "rejected" &&
        result.reason instanceof HolidayDispatchError && !result.reason.dispatchCertain) {
        throw result.reason;
      }
    }
    for (const result of fetched) {
      if (result.status === "rejected") throw result.reason;
    }
    signal?.throwIfAborted();
    years.forEach((year, index) => {
      const result = fetched[index];
      if (result.status === "fulfilled") fetchedByYear.set(year, result.value);
    });
    fetchedThrough = targetYear;
  };

  await fetchThrough(initialEndYear);
  while (true) {
    signal?.throwIfAborted();
    const relevant = filterHolidaysForSubdivision(
      [...fetchedByYear.values()].flat(),
      subdivisionCode,
    );
    const deadline = addBusinessDays(
      startDate,
      businessDays,
      new Set(relevant.map((holiday) => holiday.date)),
    );
    const terminalYear = Number(deadline.slice(0, 4));
    assertHolidayYear(terminalYear);
    if (terminalYear > fetchedThrough) {
      await fetchThrough(terminalYear);
      continue;
    }
    signal?.throwIfAborted();
    return {
      deadline,
      holidaysConsidered: relevant.filter(
        (holiday) => holiday.date > startDate && holiday.date <= deadline,
      ),
    };
  }
}
