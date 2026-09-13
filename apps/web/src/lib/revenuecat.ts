import type { Offering, Package, Purchases, SubscriptionOption } from "@revenuecat/purchases-js";

import { captureOwnerDispatch, withOwnerDispatchSignal, type OwnerDispatchLease } from "./browser-principal-state";

export type RevenueCatBoundaryCode =
  | "OFFER_INVALID"
  | "BILLING_NOT_CONFIGURED"
  | "BILLING_UNAVAILABLE"
  | "BILLING_BUSY"
  | "BILLING_TIMEOUT"
  | "BILLING_CONFIGURATION_CHANGED";

const MESSAGES: Record<RevenueCatBoundaryCode, string> = {
  OFFER_INVALID: "TED couldn't verify the Business subscription terms. Please try again later.",
  BILLING_NOT_CONFIGURED: "Business checkout is not configured yet.",
  BILLING_UNAVAILABLE: "TED couldn't load the Business subscription. Please try again.",
  BILLING_BUSY: "A subscription request is still finishing. Please try again shortly.",
  BILLING_TIMEOUT: "The subscription request timed out. Please try again shortly.",
  BILLING_CONFIGURATION_CHANGED: "Billing settings changed. Reload this page before trying again.",
};

export class RevenueCatBoundaryError extends Error {
  constructor(readonly code: RevenueCatBoundaryCode) {
    super(MESSAGES[code]);
    this.name = "RevenueCatBoundaryError";
  }
}

export interface BusinessOffer {
  readonly rcPackage: Package;
  readonly purchaseOption: SubscriptionOption;
  readonly priceId: string;
  readonly optionId: string;
  readonly priceMicros: 50000000;
  readonly currency: "USD";
  readonly period: "P1M";
  readonly priceString: string;
}

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.trim().length > 0) && value.length <= max &&
    ![...value].some(character => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    });
}

function identifier(value: unknown): value is string {
  return text(value, 200) && !/\s/.test(value);
}

function optionalCheckoutUrl(value: unknown): boolean {
  // Retained SDK metadata only; this adapter never follows checkout URLs.
  return value === undefined || value === null || text(value, 2048);
}

function price(value: unknown, micros: number): boolean {
  return record(value) && keys(value, ["amount", "amountMicros", "currency", "formattedPrice"]) &&
    value.currency === "USD" && value.amountMicros === micros && value.amount === micros / 10000 &&
    text(value.formattedPrice, 200);
}

/** Pinned to the direct getOfferings mapper in purchases-js 1.60.1. */
function approvedOffering(value: unknown): value is Offering {
  if (!record(value) || value.identifier !== "business" || !text(value.serverDescription, 4096, true) ||
    !(value.metadata === null || record(value.metadata)) || typeof value.hasPaywall !== "boolean" ||
    !optionalCheckoutUrl(value.webCheckoutURL) ||
    !Array.isArray(value.availablePackages) || value.availablePackages.length !== 1 ||
    !record(value.packagesById) || !keys(value.packagesById, ["$rc_monthly"]) ||
    !["lifetime", "annual", "sixMonth", "threeMonth", "twoMonth", "weekly"].every(key => value[key] === null)) return false;
  const pkg = value.availablePackages[0];
  if (!record(pkg) || pkg !== value.packagesById.$rc_monthly || pkg !== value.monthly ||
    pkg.identifier !== "$rc_monthly" || pkg.packageType !== "$rc_monthly" || !optionalCheckoutUrl(pkg.webCheckoutURL) ||
    !record(pkg.webBillingProduct) || pkg.rcBillingProduct !== pkg.webBillingProduct) return false;
  const product = pkg.webBillingProduct;
  if (product.identifier !== "prompted.business.monthly" || product.productType !== "subscription" ||
    !text(product.title, 500) || product.displayName !== product.title ||
    !(product.description === null || text(product.description, 4096, true)) ||
    product.presentedOfferingIdentifier !== "business" || !record(product.presentedOfferingContext) ||
    product.presentedOfferingContext.offeringIdentifier !== "business" ||
    product.presentedOfferingContext.placementIdentifier !== null || product.presentedOfferingContext.targetingContext !== null ||
    product.normalPeriodDuration !== "P1M" || product.defaultNonSubscriptionOption !== null ||
    product.freeTrialPhase !== null || product.introPricePhase !== null || product.discountPhase !== null ||
    !record(product.subscriptionOptions) || Object.keys(product.subscriptionOptions).length !== 1 ||
    !record(product.defaultSubscriptionOption)) return false;
  const option = product.defaultSubscriptionOption;
  if (!keys(option, ["id", "priceId", "base", "trial", "introPrice", "discount"]) ||
    !identifier(option.id) || !identifier(option.priceId) ||
    !keys(product.subscriptionOptions, [option.id]) || product.subscriptionOptions[option.id] !== option ||
    product.defaultPurchaseOption !== option || option.trial !== null || option.introPrice !== null ||
    option.discount !== null || !record(option.base)) return false;
  const base = option.base;
  if (!keys(base, ["periodDuration", "period", "cycleCount", "price", "pricePerWeek", "pricePerMonth", "pricePerYear"]) ||
    base.periodDuration !== "P1M" || base.cycleCount !== 0 || !record(base.period) ||
    !keys(base.period, ["number", "unit"]) || base.period.number !== 1 || base.period.unit !== "month" ||
    product.period !== base.period || product.price !== base.price || product.currentPrice !== base.price ||
    !price(base.price, 50000000) || !price(base.pricePerWeek, 11500000) ||
    !price(base.pricePerMonth, 50000000) || !price(base.pricePerYear, 600000000)) return false;
  return true;
}

/** Validates a directly fetched, named Business offering without cloning SDK references. */
export function validateBusinessOffering(raw: unknown): BusinessOffer {
  try {
    if (!approvedOffering(raw)) throw new RevenueCatBoundaryError("OFFER_INVALID");
    const rcPackage = raw.availablePackages[0];
    const purchaseOption = rcPackage?.webBillingProduct.defaultSubscriptionOption;
    if (!rcPackage || !purchaseOption) throw new RevenueCatBoundaryError("OFFER_INVALID");
    return { rcPackage, purchaseOption, priceId: purchaseOption.priceId, optionId: purchaseOption.id,
      priceMicros: 50000000, currency: "USD", period: "P1M", priceString: "US$50.00" };
  } catch {
    // Do not expose malformed provider properties or accessor exceptions to the UI.
    throw new RevenueCatBoundaryError("OFFER_INVALID");
  }
}

let sdk: { instance: Purchases; apiKey: string } | undefined;
let activeRead: { lease: OwnerDispatchLease; apiKey: string; promise: Promise<BusinessOffer>; expired: boolean } | undefined;

async function readBusinessOffer(lease: OwnerDispatchLease, apiKey: string): Promise<BusinessOffer> {
  try {
    lease.assertCurrent();
    if (!sdk) {
      const { Purchases } = await import("@revenuecat/purchases-js");
      lease.assertCurrent();
      // Do not adopt a global instance whose key and owner this coordinator never bound.
      if (Purchases.isConfigured()) throw new RevenueCatBoundaryError("BILLING_UNAVAILABLE");
      const instance = Purchases.configure({ apiKey, appUserId: lease.expectedUserId,
        flags: { autoCollectUTMAsMetadata: false, collectAnalyticsEvents: false } });
      sdk = { instance, apiKey };
    } else if (sdk.apiKey !== apiKey) {
      throw new RevenueCatBoundaryError("BILLING_CONFIGURATION_CHANGED");
    } else if (sdk.instance.getAppUserId() !== lease.expectedUserId) {
      // Discovery is serialized. This may only run after the earlier SDK read settles.
      // Never reuse this as payment cancellation: there is no purchase dispatch here.
      await sdk.instance.changeUser(lease.expectedUserId);
      lease.assertCurrent();
    }
    lease.assertCurrent();
    const instance = sdk.instance;
    if (instance.getAppUserId() !== lease.expectedUserId) throw new RevenueCatBoundaryError("BILLING_UNAVAILABLE");
    const raw: unknown = await instance.getOfferings({ offeringIdentifier: "business", currency: "USD" });
    lease.assertCurrent();
    if (instance.getAppUserId() !== lease.expectedUserId) throw new RevenueCatBoundaryError("BILLING_UNAVAILABLE");
    if (!record(raw) || !record(raw.all) || !keys(raw.all, ["business"]) ||
      (raw.current !== null && raw.current !== raw.all.business)) throw new RevenueCatBoundaryError("OFFER_INVALID");
    return validateBusinessOffering(raw.all.business);
  } catch (error) {
    lease.assertCurrent();
    if (error instanceof RevenueCatBoundaryError) throw error;
    throw new RevenueCatBoundaryError("BILLING_UNAVAILABLE");
  }
}

/**
 * Discovery only. No entitlement grant or purchase is possible through this module.
 * A future purchase path needs a durable reservation, exact receipt recovery and
 * deletion fencing before it can share this coordinator's SDK lifetime.
 */
export async function loadBusinessOffering(userId: string): Promise<BusinessOffer> {
  const principal = captureOwnerDispatch(userId);
  const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_WEB_KEY;
  if (typeof window === "undefined" || !text(apiKey, 512) || /\s/.test(apiKey)) {
    throw new RevenueCatBoundaryError("BILLING_NOT_CONFIGURED");
  }
  if (sdk && sdk.apiKey !== apiKey) throw new RevenueCatBoundaryError("BILLING_CONFIGURATION_CHANGED");
  if (activeRead) {
    if (activeRead.apiKey !== apiKey) throw new RevenueCatBoundaryError("BILLING_CONFIGURATION_CHANGED");
    if (!activeRead.expired && activeRead.lease.expectedUserId === principal.expectedUserId &&
      activeRead.lease.principalEpoch === principal.principalEpoch) return activeRead.promise;
    throw new RevenueCatBoundaryError("BILLING_BUSY");
  }
  const lifetime = new AbortController();
  const lease = withOwnerDispatchSignal(principal, lifetime.signal);
  const request = readBusinessOffer(lease, apiKey);
  const current = { lease, apiKey, promise: request, expired: false };
  current.promise = new Promise<BusinessOffer>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); lease.signal.removeEventListener("abort", abort); };
    const abort = () => {
      cleanup();
      try { lease.assertCurrent(); } catch (error) { reject(error); }
    };
    const timer = setTimeout(() => {
      current.expired = true;
      // Retire the dispatch lease too: a late import/identity response must not
      // start another SDK request after the displayed read has timed out.
      lifetime.abort(new RevenueCatBoundaryError("BILLING_TIMEOUT"));
    }, 30000);
    lease.signal.addEventListener("abort", abort, { once: true });
    if (lease.signal.aborted) abort();
    // Timeout or principal retirement rejects presentation only. The underlying
    // SDK request still owns the coordinator until it settles; late results are
    // handled and cannot repurpose an in-flight SDK or become a fresh offer.
    request.then(value => {
      cleanup(); if (activeRead === current) activeRead = undefined;
      try { lease.assertCurrent(); resolve(value); } catch (error) { reject(error); }
      finally { lifetime.abort(); }
    }, error => {
      cleanup(); if (activeRead === current) activeRead = undefined; reject(error); lifetime.abort();
    });
  });
  activeRead = current;
  return current.promise;
}
