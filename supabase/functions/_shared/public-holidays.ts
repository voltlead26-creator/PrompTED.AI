export interface PublicHoliday {
  date: string;
  name: string;
  countryCode: string;
  nationalHoliday: boolean;
  subdivisionCodes: string[] | null;
  holidayTypes: string[];
}

const NAGER_BASE_URL = "https://date.nager.at/api/v4/Holidays";

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must use YYYY-MM-DD format.");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Date is invalid.");
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function filterHolidaysForSubdivision(
  holidays: PublicHoliday[],
  subdivisionCode?: string,
): PublicHoliday[] {
  const subdivision = subdivisionCode?.trim().toUpperCase();
  return holidays.filter((holiday) => {
    if (holiday.nationalHoliday || !holiday.subdivisionCodes?.length) return true;
    return Boolean(subdivision && holiday.subdivisionCodes.includes(subdivision));
  });
}

export function addBusinessDays(
  startDate: string,
  businessDays: number,
  holidayDates: Set<string>,
): string {
  assertIsoDate(startDate);
  if (!Number.isInteger(businessDays) || businessDays < 0 || businessDays > 3660) {
    throw new Error("businessDays must be an integer between 0 and 3660.");
  }

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
): Promise<PublicHoliday[]> {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new Error("year must be between 1900 and 2200.");
  }
  const country = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("countryCode must be a two-letter ISO code.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(`${NAGER_BASE_URL}/${country}/${year}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Holiday provider returned HTTP ${response.status}.`);
    }
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error("Holiday provider returned an invalid response.");
    return body as PublicHoliday[];
  } finally {
    clearTimeout(timeout);
  }
}

export async function calculateBusinessDeadline(input: {
  startDate: string;
  businessDays: number;
  countryCode?: string;
  subdivisionCode?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  deadline: string;
  holidaysConsidered: PublicHoliday[];
}> {
  assertIsoDate(input.startDate);
  const startYear = Number(input.startDate.slice(0, 4));
  const approximateEndYear = startYear + Math.ceil(input.businessDays / 250);
  const years = Array.from(
    { length: approximateEndYear - startYear + 1 },
    (_, index) => startYear + index,
  );
  const fetched = await Promise.all(
    years.map((year) =>
      fetchPublicHolidays(year, input.countryCode ?? "AU", input.fetchImpl ?? fetch)
    ),
  );
  const relevant = filterHolidaysForSubdivision(
    fetched.flat(),
    input.subdivisionCode,
  );
  const deadline = addBusinessDays(
    input.startDate,
    input.businessDays,
    new Set(relevant.map((holiday) => holiday.date)),
  );
  return {
    deadline,
    holidaysConsidered: relevant.filter((holiday) =>
      holiday.date > input.startDate && holiday.date <= deadline
    ),
  };
}
