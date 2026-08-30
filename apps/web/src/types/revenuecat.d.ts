// Minimal type stub for @revenuecat/purchases-js.
// The full SDK is installed at runtime; this provides just enough for type-safe usage.
declare module "@revenuecat/purchases-js" {
  interface Product {
    identifier: string;
    priceString: string;
  }

  interface Package {
    packageType: "MONTHLY" | "ANNUAL" | "LIFETIME";
    product: Product;
  }

  interface Offering {
    availablePackages: Package[];
  }

  interface Offerings {
    current: Offering | null;
  }

  interface Entitlement {
    isActive: boolean;
  }

  interface CustomerInfo {
    entitlements: {
      active: Record<string, Entitlement>;
    };
  }

  interface PurchaseResult {
    customerInfo: CustomerInfo;
  }

  class Purchases {
    static configure(apiKey: string, userId: string): void;
    static getSharedInstance(): Purchases;
    getOfferings(): Promise<Offerings>;
    purchase(options: { rcPackage: Package }): Promise<PurchaseResult>;
  }
}
