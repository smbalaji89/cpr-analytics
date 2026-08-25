import { readEnvBool, readEnvOr } from "@/lib/utils/env";
import { MockMarketDataProvider } from "./providers/mock";
import { YahooFinanceProvider } from "./providers/yahoo";
import type { MarketDataProvider } from "./provider";

export * from "./provider";
export * from "./calendar";

/**
 * Provider factory (PRD §22, §44).
 *
 * Selection is env-driven so the vendor can be swapped without touching a single
 * call site. The mock provider is fenced off from production: shipping synthetic
 * prices as if they were real is the one failure mode here that would actively
 * mislead a user, so it takes a deliberate, explicitly-named override.
 */

export interface ProviderFactoryOptions {
  /** 0 disables Next fetch caching — used by the sync job. */
  revalidateSeconds?: number;
}

export function getMarketDataProvider(
  options: ProviderFactoryOptions = {},
): MarketDataProvider {
  // Blank counts as unset — see lib/utils/env.ts for why that matters.
  const requested = readEnvOr("MARKET_DATA_PROVIDER", "yahoo").toLowerCase();

  switch (requested) {
    case "mock": {
      const allowInProd = readEnvBool("ALLOW_MOCK_PROVIDER_IN_PRODUCTION");
      if (process.env.NODE_ENV === "production" && !allowInProd) {
        throw new Error(
          "MARKET_DATA_PROVIDER=mock is not permitted in production. " +
            "The mock provider returns synthetic prices. Set MARKET_DATA_PROVIDER=yahoo, " +
            "or set ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true if you are knowingly running a demo.",
        );
      }
      return new MockMarketDataProvider();
    }

    case "yahoo":
      return new YahooFinanceProvider({
        revalidateSeconds: options.revalidateSeconds,
      });

    default:
      throw new Error(
        `Unknown MARKET_DATA_PROVIDER "${requested}". Supported values: yahoo, mock.`,
      );
  }
}
