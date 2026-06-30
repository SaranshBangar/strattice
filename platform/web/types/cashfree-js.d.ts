declare module "@cashfreepayments/cashfree-js" {
  export function load(opts: { mode: "sandbox" | "production" }): Promise<{
    checkout: (o: unknown) => Promise<unknown>;
    subscriptionsCheckout?: (o: { subsSessionId: string; redirectTarget?: string }) => Promise<unknown>;
  }>;
}
