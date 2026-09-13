import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PackageType,
  PeriodUnit,
  ProductType,
  type Offering,
  type Package,
  type Period,
  type Price,
  type PricingPhase,
  type Product,
  type SubscriptionOption,
} from "@revenuecat/purchases-js";
import {
  RevenueCatBoundaryError,
  validateBusinessOffering,
} from "./revenuecat";

// These two properties are emitted by the pinned 1.60.1 mapper, although its
// public declarations exclude them. Both must be checked before showing terms.
type UndiscountedOption = SubscriptionOption & { readonly discount: null };
type UndiscountedProduct = Product & { readonly discountPhase: null };

export function makeBusinessOffering(): Offering {
  const price = {
    amount: 5000,
    amountMicros: 50_000_000,
    currency: "USD",
    formattedPrice: "$50.00",
  } satisfies Price;
  const period = { number: 1, unit: PeriodUnit.Month } satisfies Period;
  const base = {
    periodDuration: "P1M",
    period,
    price,
    cycleCount: 0,
    // The pinned mapper floors its approximated rates to currency precision.
    pricePerWeek: {
      amount: 1150,
      amountMicros: 11_500_000,
      currency: "USD",
      formattedPrice: "$11.50",
    },
    pricePerMonth: { ...price },
    pricePerYear: {
      amount: 60_000,
      amountMicros: 600_000_000,
      currency: "USD",
      formattedPrice: "$600.00",
    },
  } satisfies PricingPhase;
  const option = {
    id: "monthly-standard-option",
    priceId: "price-synthetic-usd-monthly",
    base,
    trial: null,
    introPrice: null,
    discount: null,
  } satisfies UndiscountedOption;
  const product = {
    identifier: "prompted.business.monthly",
    displayName: "PrompTED Business",
    title: "PrompTED Business",
    description: "Monthly Business subscription",
    productType: ProductType.Subscription,
    currentPrice: price,
    normalPeriodDuration: "P1M",
    presentedOfferingIdentifier: "business",
    presentedOfferingContext: {
      offeringIdentifier: "business",
      targetingContext: null,
      placementIdentifier: null,
    },
    defaultPurchaseOption: option,
    defaultSubscriptionOption: option,
    subscriptionOptions: { [option.id]: option },
    defaultNonSubscriptionOption: null,
    price,
    period,
    freeTrialPhase: null,
    introPricePhase: null,
    discountPhase: null,
  } satisfies UndiscountedProduct;
  const rcPackage = {
    identifier: "$rc_monthly",
    rcBillingProduct: product,
    webBillingProduct: product,
    packageType: PackageType.Monthly,
  } satisfies Package;
  return {
    identifier: "business",
    serverDescription: "Business monthly",
    metadata: null,
    packagesById: { $rc_monthly: rcPackage },
    availablePackages: [rcPackage],
    lifetime: null,
    annual: null,
    sixMonth: null,
    threeMonth: null,
    twoMonth: null,
    monthly: rcPackage,
    weekly: null,
    hasPaywall: false,
  } satisfies Offering;
}

function productOf(offering: Offering): Product {
  return offering.availablePackages[0]!.webBillingProduct;
}

function optionOf(offering: Offering): SubscriptionOption {
  const option = productOf(offering).defaultSubscriptionOption;
  if (!option) throw new Error("The test fixture requires a subscription option.");
  return option;
}

function expectInvalidOffering(raw: unknown): void {
  let failure: unknown;
  try {
    validateBusinessOffering(raw);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(RevenueCatBoundaryError);
  expect(failure).toMatchObject({ code: "OFFER_INVALID" });
}

describe("validateBusinessOffering", () => {
  it("retains the exact mapped package and option while exposing only approved Business terms", () => {
    const offering = makeBusinessOffering();
    const rcPackage = offering.availablePackages[0]!;
    const purchaseOption = optionOf(offering);
    const result = validateBusinessOffering(offering);

    expect(result).toEqual({
      rcPackage,
      purchaseOption,
      priceId: "price-synthetic-usd-monthly",
      optionId: "monthly-standard-option",
      priceMicros: 50_000_000,
      currency: "USD",
      period: "P1M",
      priceString: "US$50.00",
    });
    expect(result.rcPackage).toBe(rcPackage);
    expect(result.purchaseOption).toBe(purchaseOption);
    expect(result.rcPackage).toBe(offering.packagesById.$rc_monthly);
    expect(result.rcPackage).toBe(offering.monthly);
    expect(result.purchaseOption).toBe(
      productOf(offering).subscriptionOptions[result.optionId],
    );
  });

  it.each([42, {}, []])("rejects malformed optional SDK checkout URL fields (%j)", value => {
    const offering = makeBusinessOffering();
    Object.assign(offering, { webCheckoutURL: value });
    expectInvalidOffering(offering);
    const packageOffering = makeBusinessOffering();
    Object.assign(packageOffering.monthly!, { webCheckoutURL: value });
    expectInvalidOffering(packageOffering);
  });

  it("accepts frozen SDK objects without rebuilding or mutating them", () => {
    const offering = makeBusinessOffering();
    const product = productOf(offering);
    const option = optionOf(offering);
    Object.freeze(option.base.price);
    Object.freeze(option.base.period);
    Object.freeze(option.base);
    Object.freeze(option);
    Object.freeze(product.subscriptionOptions);
    Object.freeze(product.presentedOfferingContext);
    Object.freeze(product);
    Object.freeze(offering.monthly);
    Object.freeze(offering.availablePackages);
    Object.freeze(offering.packagesById);
    Object.freeze(offering);

    const result = validateBusinessOffering(offering);
    expect(result.rcPackage).toBe(offering.monthly);
    expect(result.purchaseOption).toBe(option);
  });

  it("derives truthful USD wording from numeric terms rather than the SDK formatted string", () => {
    const offering = makeBusinessOffering();
    Object.assign(productOf(offering).price, { formattedPrice: "$0.01" });

    const result = validateBusinessOffering(offering);
    expect(result.priceString).toBe("US$50.00");
    expect(result.priceMicros).toBe(50_000_000);
    expect(result.rcPackage.webBillingProduct.price.formattedPrice).toBe("$0.01");
  });

  it("preserves bounded opaque option and price identities without prefix or plan inference", () => {
    const offering = makeBusinessOffering();
    const product = productOf(offering);
    const option = optionOf(offering);
    Object.assign(option, { id: "Opaque.Option:7", priceId: "Opaque.Price_8" });
    Object.assign(product, { subscriptionOptions: { [option.id]: option } });

    const result = validateBusinessOffering(offering);
    expect(result.optionId).toBe("Opaque.Option:7");
    expect(result.priceId).toBe("Opaque.Price_8");
    expect(result.purchaseOption).toBe(option);
  });

  it("allows additive offering metadata and the pinned mapper's non-purchase UI fields", () => {
    const offering = makeBusinessOffering();
    Object.assign(offering, {
      metadata: { campaign: "autumn", nested: { future: [1, true, null] } },
      paywallComponents: null,
      uiConfig: { branding: { futureProperty: true } },
    });

    expect(validateBusinessOffering(offering).rcPackage).toBe(offering.monthly);
  });

  for (const raw of [undefined, null, [], "business", 42, true, {}]) {
    it(`rejects the malformed selected offering ${JSON.stringify(raw)}`, () => {
      expectInvalidOffering(raw);
    });
  }

  const invalidOfferingMutations: Array<{
    name: string;
    change: (offering: Offering) => void;
  }> = [
    { name: "a different offering", change: (o) => Object.assign(o, { identifier: "default" }) },
    { name: "case-folded offering identity", change: (o) => Object.assign(o, { identifier: "Business" }) },
    { name: "missing package array", change: (o) => Object.assign(o, { availablePackages: undefined }) },
    { name: "an empty package array", change: (o) => Object.assign(o, { availablePackages: [] }) },
    { name: "a duplicated package even when the reference is identical", change: (o) => Object.assign(o, { availablePackages: [o.monthly, o.monthly] }) },
    { name: "missing package dictionary", change: (o) => Object.assign(o, { packagesById: null }) },
    { name: "an array in place of the package dictionary", change: (o) => Object.assign(o, { packagesById: [o.monthly] }) },
    { name: "the wrong package dictionary key", change: (o) => Object.assign(o, { packagesById: { monthly: o.monthly } }) },
    { name: "an additional package dictionary alias", change: (o) => Object.assign(o, { packagesById: { ...o.packagesById, another: o.monthly } }) },
    { name: "a cloned package dictionary value", change: (o) => Object.assign(o, { packagesById: { $rc_monthly: { ...o.monthly } } }) },
    { name: "missing monthly convenience package", change: (o) => Object.assign(o, { monthly: null }) },
    { name: "a cloned monthly convenience package", change: (o) => Object.assign(o, { monthly: { ...o.monthly } }) },
    { name: "a contradictory annual convenience package", change: (o) => Object.assign(o, { annual: o.monthly }) },
    { name: "an inherited monthly dictionary entry", change: (o) => Object.assign(o, { packagesById: Object.create({ $rc_monthly: o.monthly }) }) },
    { name: "an unknown package type", change: (o) => Object.assign(o.monthly!, { packageType: "MONTHLY" }) },
    { name: "a nonmonthly package", change: (o) => Object.assign(o.monthly!, { packageType: PackageType.Annual }) },
    { name: "a different package identifier", change: (o) => Object.assign(o.monthly!, { identifier: "monthly" }) },
    { name: "a cloned deprecated product alias", change: (o) => Object.assign(o.monthly!, { rcBillingProduct: { ...productOf(o) } }) },
    { name: "a missing primary product", change: (o) => Object.assign(o.monthly!, { webBillingProduct: null }) },
    { name: "a product name that merely contains business", change: (o) => Object.assign(productOf(o), { identifier: "other.business.monthly" }) },
    { name: "another PrompTED plan", change: (o) => Object.assign(productOf(o), { identifier: "prompted.pro.monthly" }) },
    { name: "a consumable product", change: (o) => Object.assign(productOf(o), { productType: ProductType.Consumable }) },
    { name: "an unknown product type", change: (o) => Object.assign(productOf(o), { productType: "SUBSCRIPTION" }) },
    { name: "a different deprecated offering context", change: (o) => Object.assign(productOf(o), { presentedOfferingIdentifier: "default" }) },
    { name: "a different offering context", change: (o) => Object.assign(productOf(o).presentedOfferingContext, { offeringIdentifier: "default" }) },
    { name: "a placement-selected product", change: (o) => Object.assign(productOf(o).presentedOfferingContext, { placementIdentifier: "pricing" }) },
    { name: "a targeted product", change: (o) => Object.assign(productOf(o).presentedOfferingContext, { targetingContext: { ruleId: "rule", revision: 1 } }) },
    { name: "a missing context", change: (o) => Object.assign(productOf(o), { presentedOfferingContext: null }) },
    { name: "missing subscription options", change: (o) => Object.assign(productOf(o), { subscriptionOptions: null }) },
    { name: "no subscription option", change: (o) => Object.assign(productOf(o), { subscriptionOptions: {} }) },
    { name: "another available option", change: (o) => Object.assign(productOf(o), { subscriptionOptions: { ...productOf(o).subscriptionOptions, another: { ...optionOf(o), id: "another" } } }) },
    { name: "an option dictionary key that disagrees with its id", change: (o) => Object.assign(productOf(o), { subscriptionOptions: { wrong: optionOf(o) } }) },
    { name: "an option dictionary clone", change: (o) => Object.assign(productOf(o), { subscriptionOptions: { [optionOf(o).id]: { ...optionOf(o) } } }) },
    { name: "missing default subscription option", change: (o) => Object.assign(productOf(o), { defaultSubscriptionOption: null }) },
    { name: "a different default purchase option", change: (o) => Object.assign(productOf(o), { defaultPurchaseOption: { ...optionOf(o) } }) },
    { name: "a non-subscription default", change: (o) => Object.assign(productOf(o), { defaultNonSubscriptionOption: { id: "other", priceId: "other", basePrice: productOf(o).price } }) },
    { name: "a cloned product price", change: (o) => Object.assign(productOf(o), { price: { ...productOf(o).price } }) },
    { name: "a contradictory deprecated price", change: (o) => Object.assign(productOf(o), { currentPrice: { ...productOf(o).price, amountMicros: 40_000_000 } }) },
    { name: "a cloned product period", change: (o) => Object.assign(productOf(o), { period: { ...productOf(o).period } }) },
    { name: "a different product period duration", change: (o) => Object.assign(productOf(o), { normalPeriodDuration: "P1Y" }) },
    { name: "missing base phase", change: (o) => Object.assign(optionOf(o), { base: null }) },
    { name: "missing base price", change: (o) => Object.assign(optionOf(o).base, { price: null }) },
    { name: "a nonmonthly base duration", change: (o) => Object.assign(optionOf(o).base, { periodDuration: "P30D" }) },
    { name: "a malformed base period", change: (o) => Object.assign(optionOf(o).base.period!, { number: "1" }) },
    { name: "a multi-month base period", change: (o) => Object.assign(optionOf(o).base.period!, { number: 2 }) },
    { name: "a daily base period", change: (o) => Object.assign(optionOf(o).base.period!, { unit: PeriodUnit.Day }) },
    { name: "a finite base phase", change: (o) => Object.assign(optionOf(o).base, { cycleCount: 1 }) },
    { name: "a fractional phase count", change: (o) => Object.assign(optionOf(o).base, { cycleCount: 0.5 }) },
    { name: "a string phase count", change: (o) => Object.assign(optionOf(o).base, { cycleCount: "0" }) },
    { name: "an unknown option phase", change: (o) => Object.assign(optionOf(o), { promotionalPhase: { amountMicros: 1 } }) },
    { name: "an unknown phase term", change: (o) => Object.assign(optionOf(o).base, { billingMode: "prepaid" }) },
    { name: "an unknown price term", change: (o) => Object.assign(productOf(o).price, { discountAmountMicros: 1 }) },
    { name: "an unknown period term", change: (o) => Object.assign(optionOf(o).base.period!, { trialDays: 7 }) },
  ];

  for (const { name, change } of invalidOfferingMutations) {
    it(`rejects ${name} without guessing a replacement offer`, () => {
      const offering = makeBusinessOffering();
      change(offering);
      expectInvalidOffering(offering);
    });
  }

  for (const field of ["id", "priceId"]) {
    for (const value of [undefined, null, 42, "", " padded ", "with space", "line\n", "control\u0000", "a".repeat(201)]) {
      it(`rejects an invalid ${field}: ${JSON.stringify(value)}`, () => {
        const offering = makeBusinessOffering();
        const option = optionOf(offering);
        Object.assign(option, { [field]: value });
        if (field === "id" && typeof value === "string") {
          Object.assign(productOf(offering), { subscriptionOptions: { [value]: option } });
        }
        expectInvalidOffering(offering);
      });
    }
  }

  for (const value of [undefined, null, "50000000", 0, 40_000_000, 50_000_000.1, NaN, Infinity]) {
    it(`rejects unapproved or malformed micros ${String(value)}`, () => {
      const offering = makeBusinessOffering();
      Object.assign(productOf(offering).price, { amountMicros: value });
      expectInvalidOffering(offering);
    });
  }

  for (const value of [undefined, null, "5000", 50, 4999, NaN, Infinity]) {
    it(`rejects contradictory legacy cents ${String(value)}`, () => {
      const offering = makeBusinessOffering();
      Object.assign(productOf(offering).price, { amount: value });
      expectInvalidOffering(offering);
    });
  }

  for (const value of [undefined, null, 50, "$", "AUD", "usd", " USD "]) {
    it(`rejects a missing or nonexact USD currency ${JSON.stringify(value)}`, () => {
      const offering = makeBusinessOffering();
      Object.assign(productOf(offering).price, { currency: value });
      expectInvalidOffering(offering);
    });
  }

  for (const value of [undefined, null, 50, "", "a".repeat(201)]) {
    it(`rejects a malformed bounded formatted price ${JSON.stringify(value)}`, () => {
      const offering = makeBusinessOffering();
      Object.assign(productOf(offering).price, { formattedPrice: value });
      expectInvalidOffering(offering);
    });
  }

  for (const field of ["trial", "introPrice", "discount"]) {
    for (const value of [undefined, {}, false, "none"]) {
      it(`requires explicit absence of option ${field}: ${JSON.stringify(value)}`, () => {
        const offering = makeBusinessOffering();
        Object.assign(optionOf(offering), { [field]: value });
        expectInvalidOffering(offering);
      });
    }
  }

  for (const field of ["freeTrialPhase", "introPricePhase", "discountPhase"]) {
    for (const value of [undefined, {}, false, "none"]) {
      it(`requires explicit absence of product ${field}: ${JSON.stringify(value)}`, () => {
        const offering = makeBusinessOffering();
        Object.assign(productOf(offering), { [field]: value });
        expectInvalidOffering(offering);
      });
    }
  }

  it("rejects a coherent discounted option even while every base price remains USD50", () => {
    const offering = makeBusinessOffering();
    const discount = {
      timeWindow: null,
      price: { amount: 2500, amountMicros: 25_000_000, currency: "USD", formattedPrice: "$25.00" },
      durationMode: "forever",
      name: "Synthetic half-price discount",
      periodDuration: "P1M",
      period: { number: 1, unit: PeriodUnit.Month },
      cycleCount: 0,
      discountType: "percentage",
      percentage: 50,
      fixedAmount: null,
    };
    Object.assign(optionOf(offering), { discount });
    Object.assign(productOf(offering), { discountPhase: discount });

    expect(productOf(offering).price.amountMicros).toBe(50_000_000);
    expectInvalidOffering(offering);
  });

  it("rejects a coherent free trial even when the recurring phase matches approved terms", () => {
    const offering = makeBusinessOffering();
    const trial = {
      periodDuration: "P7D",
      period: { number: 7, unit: PeriodUnit.Day },
      price: null,
      cycleCount: 1,
      pricePerWeek: null,
      pricePerMonth: null,
      pricePerYear: null,
    } satisfies PricingPhase;
    Object.assign(optionOf(offering), { trial });
    Object.assign(productOf(offering), { freeTrialPhase: trial });

    expect(productOf(offering).price.amountMicros).toBe(50_000_000);
    expectInvalidOffering(offering);
  });

  it("rejects a coherent introductory price even when the recurring phase remains USD50", () => {
    const offering = makeBusinessOffering();
    const introPrice = {
      periodDuration: "P1M",
      period: { number: 1, unit: PeriodUnit.Month },
      price: { amount: 2500, amountMicros: 25_000_000, currency: "USD", formattedPrice: "$25.00" },
      cycleCount: 1,
      pricePerWeek: { amount: 575, amountMicros: 5_750_000, currency: "USD", formattedPrice: "$5.75" },
      pricePerMonth: { amount: 2500, amountMicros: 25_000_000, currency: "USD", formattedPrice: "$25.00" },
      pricePerYear: { amount: 30_000, amountMicros: 300_000_000, currency: "USD", formattedPrice: "$300.00" },
    } satisfies PricingPhase;
    Object.assign(optionOf(offering), { introPrice });
    Object.assign(productOf(offering), { introPricePhase: introPrice });

    expect(productOf(offering).price.amountMicros).toBe(50_000_000);
    expectInvalidOffering(offering);
  });
});

describe("owner-scoped Business discovery", () => {
  const ownerA = "c55e7601-4d38-4aae-9e99-951d0dc09eba";
  const ownerB = "bfe85687-40c0-481b-9f93-c0dd958937ce";
  let adapter: typeof import("./revenuecat");
  let principal: typeof import("./browser-principal-state");
  let currentSdkOwner: string;
  let offering: ReturnType<typeof makeBusinessOffering>;
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const getOfferings = vi.fn();
  const changeUser = vi.fn();
  const getAppUserId = vi.fn();
  const purchase = vi.fn();
  const close = vi.fn();
  const instance = { getOfferings, changeUser, getAppUserId, purchase, close };
  const configure = vi.fn();
  const isConfigured = vi.fn();
  const moduleLoaded = vi.fn();
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const deferOfferRead = () => {
    const read = deferred<unknown>();
    const started = deferred<void>();
    getOfferings.mockImplementationOnce(() => { started.resolve(); return read.promise; });
    return { ...read, started: started.promise };
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_REVENUECAT_WEB_KEY", "rcb_sb_synthetic_public_test_key");
    currentSdkOwner = ownerA;
    offering = makeBusinessOffering();
    getOfferings.mockImplementation(async () => ({ all: { business: offering }, current: null }));
    getAppUserId.mockImplementation(() => currentSdkOwner);
    changeUser.mockImplementation(async (owner: string) => { currentSdkOwner = owner; return {}; });
    configure.mockImplementation((config: { appUserId: string }) => {
      currentSdkOwner = config.appUserId;
      return instance;
    });
    isConfigured.mockReturnValue(false);
    vi.doMock("@revenuecat/purchases-js", () => {
      moduleLoaded();
      return { Purchases: { configure, isConfigured } };
    });
    principal = await import("./browser-principal-state");
    principal.recordBrowserPrincipal(ownerA);
    adapter = await import("./revenuecat");
  });

  afterEach(() => {
    expect(purchase).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.doUnmock("@revenuecat/purchases-js");
  });

  it("loads the exact non-current named USD offering using the real configured instance", async () => {
    const result = await adapter.loadBusinessOffering(ownerA);
    expect(configure).toHaveBeenCalledExactlyOnceWith({
      apiKey: "rcb_sb_synthetic_public_test_key", appUserId: ownerA,
      flags: { autoCollectUTMAsMetadata: false, collectAnalyticsEvents: false },
    });
    expect(getOfferings).toHaveBeenCalledExactlyOnceWith({ offeringIdentifier: "business", currency: "USD" });
    expect(result.rcPackage).toBe(offering.monthly);
    expect(result.purchaseOption).toBe(offering.monthly?.webBillingProduct.defaultSubscriptionOption);
    expect(result.priceString).toBe("US$50.00");
  });

  it.each([undefined, "", " ", " key ", "key\n", "x".repeat(513)])(
    "rejects unusable configuration before SDK import (%j)", async key => {
      vi.stubEnv("NEXT_PUBLIC_REVENUECAT_WEB_KEY", key);
      await expect(adapter.loadBusinessOffering(ownerA)).rejects.toMatchObject({ code: "BILLING_NOT_CONFIGURED" });
      expect(moduleLoaded).not.toHaveBeenCalled();
      expect(configure).not.toHaveBeenCalled();
    },
  );

  it("requires the exact active principal before SDK import", async () => {
    await expect(adapter.loadBusinessOffering(ownerB)).rejects.toMatchObject({ code: "OWNER_DISPATCH_STALE" });
    expect(moduleLoaded).not.toHaveBeenCalled();
  });

  it("rejects a batched A-B-A change while the lazy import is pending", async () => {
    const pending = adapter.loadBusinessOffering(ownerA);
    const rejected = expect(pending).rejects.toMatchObject({ code: "OWNER_DISPATCH_STALE" });
    principal.recordBrowserPrincipal(ownerB);
    principal.recordBrowserPrincipal(ownerA);
    await rejected;
    await flush();
    expect(configure).not.toHaveBeenCalled();
    expect(getOfferings).not.toHaveBeenCalled();
  });

  it("shares an in-flight read only with the same owner and epoch", async () => {
    const read = deferOfferRead();
    const first = adapter.loadBusinessOffering(ownerA);
    const second = adapter.loadBusinessOffering(ownerA);
    await read.started;
    expect(getOfferings).toHaveBeenCalledTimes(1);
    read.resolve({ all: { business: offering }, current: null });
    expect((await first).rcPackage).toBe((await second).rcPackage);
    await adapter.loadBusinessOffering(ownerA);
    expect(configure).toHaveBeenCalledTimes(1);
    expect(getOfferings).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)("rejects stale read %s and does not repurpose the SDK while it is pending", async mode => {
    const read = deferOfferRead();
    const first = adapter.loadBusinessOffering(ownerA);
    const retired = expect(first).rejects.toMatchObject({ code: "OWNER_DISPATCH_STALE" });
    await read.started;
    principal.recordBrowserPrincipal(ownerB);
    await retired;
    await expect(adapter.loadBusinessOffering(ownerB)).rejects.toMatchObject({ code: "BILLING_BUSY" });
    expect(changeUser).not.toHaveBeenCalled();
    if (mode === "resolve") read.resolve({ all: { business: offering }, current: null });
    else read.reject(new Error("private provider diagnostics"));
    await flush();
    await adapter.loadBusinessOffering(ownerB);
    expect(changeUser).toHaveBeenCalledExactlyOnceWith(ownerB);
    expect(configure).toHaveBeenCalledTimes(1);
  });

  it("does not reuse an earlier same-owner epoch's offer after A-B-A", async () => {
    const read = deferOfferRead();
    const first = adapter.loadBusinessOffering(ownerA);
    const retired = expect(first).rejects.toMatchObject({ code: "OWNER_DISPATCH_STALE" });
    await read.started;
    principal.recordBrowserPrincipal(ownerB);
    principal.recordBrowserPrincipal(ownerA);
    await retired;
    await expect(adapter.loadBusinessOffering(ownerA)).rejects.toMatchObject({ code: "BILLING_BUSY" });
    read.resolve({ all: { business: offering }, current: null });
    await flush();
    const freshOffering = makeBusinessOffering();
    getOfferings.mockResolvedValueOnce({ all: { business: freshOffering }, current: null });
    expect((await adapter.loadBusinessOffering(ownerA)).rcPackage).toBe(freshOffering.monthly);
    expect(getOfferings).toHaveBeenCalledTimes(2);
  });

  it("reports a read timeout but keeps the SDK occupied until its original request settles", async () => {
    vi.useFakeTimers();
    const read = deferOfferRead();
    const first = adapter.loadBusinessOffering(ownerA);
    const timedOut = expect(first).rejects.toMatchObject({ code: "BILLING_TIMEOUT" });
    await read.started;
    await vi.advanceTimersByTimeAsync(30000);
    await timedOut;
    await expect(adapter.loadBusinessOffering(ownerA)).rejects.toMatchObject({ code: "BILLING_BUSY" });
    expect(getOfferings).toHaveBeenCalledTimes(1);
    read.reject(new Error("late private failure"));
    await flush();
    await adapter.loadBusinessOffering(ownerA);
    expect(getOfferings).toHaveBeenCalledTimes(2);
  });

  it("does not configure or read after a timed-out lazy import finally resolves", async () => {
    vi.useFakeTimers();
    const started = deferred<void>();
    const imported = deferred<{ Purchases: { configure: typeof configure; isConfigured: typeof isConfigured } }>();
    vi.doMock("@revenuecat/purchases-js", () => { started.resolve(); return imported.promise; });
    const pending = adapter.loadBusinessOffering(ownerA);
    const timedOut = expect(pending).rejects.toMatchObject({ code: "BILLING_TIMEOUT" });
    await started.promise;
    await vi.advanceTimersByTimeAsync(30000);
    await timedOut;
    vi.useRealTimers();
    imported.resolve({ Purchases: { configure, isConfigured } });
    await vi.dynamicImportSettled();
    await flush();
    expect(configure).not.toHaveBeenCalled();
    expect(getOfferings).not.toHaveBeenCalled();
  });

  it("does not start another read when changeUser finishes after the read timeout", async () => {
    await adapter.loadBusinessOffering(ownerA);
    principal.recordBrowserPrincipal(ownerB);
    vi.useFakeTimers();
    const started = deferred<void>();
    const changed = deferred<unknown>();
    changeUser.mockImplementationOnce(() => { started.resolve(); return changed.promise; });
    const pending = adapter.loadBusinessOffering(ownerB);
    const timedOut = expect(pending).rejects.toMatchObject({ code: "BILLING_TIMEOUT" });
    await started.promise;
    await vi.advanceTimersByTimeAsync(30000);
    await timedOut;
    currentSdkOwner = ownerB;
    changed.resolve({});
    await flush();
    expect(getOfferings).toHaveBeenCalledTimes(1);
  });

  it("rejects a key change without reconfiguring an existing SDK", async () => {
    await adapter.loadBusinessOffering(ownerA);
    vi.stubEnv("NEXT_PUBLIC_REVENUECAT_WEB_KEY", "rcb_sb_different_synthetic_key");
    await expect(adapter.loadBusinessOffering(ownerA)).rejects.toMatchObject({ code: "BILLING_CONFIGURATION_CHANGED" });
    expect(configure).toHaveBeenCalledTimes(1);
    expect(getOfferings).toHaveBeenCalledTimes(1);
  });

  it("does not adopt another module's unbound shared instance", async () => {
    isConfigured.mockReturnValue(true);
    await expect(adapter.loadBusinessOffering(ownerA)).rejects.toMatchObject({ code: "BILLING_UNAVAILABLE" });
    expect(configure).not.toHaveBeenCalled();
    expect(getOfferings).not.toHaveBeenCalled();
  });

  it("checks the SDK's actual owner before and after the read", async () => {
    getAppUserId.mockReturnValue(ownerB);
    await expect(adapter.loadBusinessOffering(ownerA)).rejects.toMatchObject({ code: "BILLING_UNAVAILABLE" });
    expect(getOfferings).not.toHaveBeenCalled();
    getAppUserId.mockImplementation(() => currentSdkOwner);
    getOfferings.mockImplementationOnce(async () => {
      currentSdkOwner = ownerB;
      return { all: { business: offering }, current: null };
    });
    await expect(adapter.loadBusinessOffering(ownerA)).rejects.toMatchObject({ code: "BILLING_UNAVAILABLE" });
  });

  it("does not dispatch an offer read after the principal retires during changeUser", async () => {
    await adapter.loadBusinessOffering(ownerA);
    principal.recordBrowserPrincipal(ownerB);
    const changed = deferred<unknown>();
    changeUser.mockReturnValueOnce(changed.promise);
    const pending = adapter.loadBusinessOffering(ownerB);
    const retired = expect(pending).rejects.toMatchObject({ code: "OWNER_DISPATCH_STALE" });
    await flush();
    principal.recordBrowserPrincipal(ownerA);
    principal.recordBrowserPrincipal(ownerB);
    await retired;
    changed.resolve({});
    await flush();
    expect(getOfferings).toHaveBeenCalledTimes(1);
  });

  it.each([null, [], {}, { all: { business: null }, current: null },
    { all: {}, current: null }])("rejects malformed offering envelopes (%j)", async envelope => {
      getOfferings.mockResolvedValueOnce(envelope);
      await expect(adapter.loadBusinessOffering(ownerA)).rejects.toMatchObject({ code: "OFFER_INVALID" });
    });

  it("rejects a contradictory current pointer or another named offering instead of falling back", async () => {
    getOfferings.mockResolvedValueOnce({ all: { business: offering }, current: makeBusinessOffering() });
    await expect(adapter.loadBusinessOffering(ownerA)).rejects.toMatchObject({ code: "OFFER_INVALID" });
    getOfferings.mockResolvedValueOnce({ all: { premium: offering }, current: offering });
    await expect(adapter.loadBusinessOffering(ownerA)).rejects.toMatchObject({ code: "OFFER_INVALID" });
  });

  it("allows the named offering to become current only by exact reference", async () => {
    getOfferings.mockResolvedValueOnce({ all: { business: offering }, current: offering });
    expect((await adapter.loadBusinessOffering(ownerA)).rcPackage).toBe(offering.monthly);
  });

  it.each(["configure", "changeUser", "read"] as const)("exposes a safe retry error after %s failure without provider details", async failure => {
    if (failure === "configure") configure.mockImplementationOnce(() => { throw new Error("private raw configure failure"); });
    if (failure === "changeUser") {
      await adapter.loadBusinessOffering(ownerA);
      principal.recordBrowserPrincipal(ownerB);
      changeUser.mockRejectedValueOnce(new Error("private raw identity failure"));
    }
    if (failure === "read") getOfferings.mockRejectedValueOnce(new Error("private raw read failure"));
    await expect(adapter.loadBusinessOffering(failure === "changeUser" ? ownerB : ownerA)).rejects.toMatchObject({
      code: "BILLING_UNAVAILABLE", message: "TED couldn't load the Business subscription. Please try again.",
    });
  });
});
