import { describe, expect, it } from "vitest";
import {
  CLRTY1_CHAIN_ID,
  CLRTY1_NUMERIC_CHAIN_ID,
  getClrty1ConnectionReport,
  loadClrty1Config,
  probeClrty1,
} from "../src/clrty1.js";

const live = process.env.CLRTY_LIVE !== "0";

describe.skipIf(!live)("clrty1 live connection", () => {
  it(
    "affirms CLRTY-1 via exchange/api failover (no rpc tip required)",
    async () => {
      const cfg = loadClrty1Config({
        ...process.env,
        CLRTY_L1_RPC: process.env.CLRTY_L1_RPC || "https://rpc.clarity-fintech.com",
        CLRTY_API_BASE: process.env.CLRTY_API_BASE || "https://api.clarity-fintech.com",
        CLRTY_EXCHANGE_HEALTH:
          process.env.CLRTY_EXCHANGE_HEALTH ||
          "https://exchange.clarity-fintech.com/health",
      });
      const probe = await probeClrty1(cfg);
      expect(probe.ok).toBe(true);
      expect(
        probe.chainId === CLRTY1_CHAIN_ID ||
          String(probe.chainId) === String(CLRTY1_NUMERIC_CHAIN_ID) ||
          String(probe.chainId).toLowerCase().includes("clrty-1"),
      ).toBe(true);
      expect(probe.fallbacks_tried.length).toBeGreaterThan(0);
      expect(["rpc", "rpc_fallback", "api_rpc", "api_chain_affirm", "exchange_health"]).toContain(
        probe.source,
      );

      const report = await getClrty1ConnectionReport(cfg);
      expect(report.ok).toBe(true);
      expect(report.affirmed).toBe(true);
      expect(report.numericChainId).toBe(CLRTY1_NUMERIC_CHAIN_ID);
    },
    30_000,
  );
});
