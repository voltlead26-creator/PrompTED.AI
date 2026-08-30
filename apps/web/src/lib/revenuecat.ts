// RevenueCat web SDK integration.
// Keys are loaded from environment variables — never hardcoded.
// This module is only used client-side.

import type { Plan } from "@prompted/shared";

let _initialized = false;

/** Call once at app start (in Providers). */
export async function initRevenueCat(userId: string): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_WEB_KEY;
  if (!apiKey) return;

  try {
    // Dynamic import keeps RevenueCat out of the SSR bundle.
    const { Purchases } = await import("@revenuecat/purchases-js");
    Purchases.configure(apiKey, userId);
    _initialized = true;
  } catch {
    // RevenueCat SDK unavailable (e.g. ad blocker) — graceful degradation.
    _initialized = false;
  }
}

export interface RevenueCatOffering {
  monthly?: { productIdentifier: string; priceString: string };
  annual?: { productIdentifier: string; priceString: string };
}

export interface PlanOfferings {
  pro: RevenueCatOffering;
  premium: RevenueCatOffering;
  business: RevenueCatOffering;
}

/** Fetch current offerings from RevenueCat. Returns null if unavailable. */
export async function fetchOfferings(): Promise<PlanOfferings | null> {
  if (!_initialized) return null;

  try {
    const { Purchases } = await import("@revenuecat/purchases-js");
    const instance = Purchases.getSharedInstance();
    const raw = await instance.getOfferings();

    const extract = (entitlement: string): RevenueCatOffering => {
      const pkg = raw.current?.availablePackages ?? [];
      const monthly = pkg.find(
        (p) => p.packageType === "MONTHLY" && p.product.identifier.includes(entitlement),
      );
      const annual = pkg.find(
        (p) => p.packageType === "ANNUAL" && p.product.identifier.includes(entitlement),
      );
      return {
        monthly: monthly
          ? {
              productIdentifier: monthly.product.identifier,
              priceString: monthly.product.priceString,
            }
          : undefined,
        annual: annual
          ? {
              productIdentifier: annual.product.identifier,
              priceString: annual.product.priceString,
            }
          : undefined,
      };
    };

    return {
      pro: extract("pro"),
      premium: extract("premium"),
      business: extract("business"),
    };
  } catch {
    return null;
  }
}

/** Purchase a product. Returns the active plan on success, null on failure/cancel. */
export async function purchaseProduct(
  productIdentifier: string,
): Promise<Plan | null> {
  if (!_initialized) return null;

  try {
    const { Purchases } = await import("@revenuecat/purchases-js");
    const instance = Purchases.getSharedInstance();
    const result = await instance.purchase({ rcPackage: { product: { identifier: productIdentifier } } as never });

    const entitlements = result.customerInfo.entitlements.active;
    if (entitlements["business"]) return "business";
    if (entitlements["premium"]) return "premium";
    if (entitlements["pro"]) return "pro";
    return "free";
  } catch {
    return null;
  }
}
