/** CLRTY-1 L1 RPC client — duplicated into each service repo (no private npm this pass). */

export const CLRTY1_CHAIN_ID = "clrty-1";
export const CLRTY1_NUMERIC_CHAIN_ID = 1202;
export const CLRTY1_DENOM = "uclrty";
export const CLRTY1_DECIMALS = 9;

export const DEFAULT_EXCHANGE_HEALTH =
  "https://exchange.clarity-fintech.com/health";
export const DEFAULT_API_BASE = "https://api.clarity-fintech.com";
export const DEFAULT_RPC = "https://rpc.clarity-fintech.com";

export type Clrty1Config = {
  rpcUrl: string;
  rpcFallbackUrl?: string;
  apiBase: string;
  exchangeHealthUrl: string;
  chainId: string;
  numericChainId: number;
};

export function loadClrty1Config(env: NodeJS.ProcessEnv = process.env): Clrty1Config {
  return {
    rpcUrl: env.CLRTY_L1_RPC || env.CLRTY_L1_RPC_URL || DEFAULT_RPC,
    rpcFallbackUrl: env.CLRTY_L1_RPC_FALLBACK || undefined,
    apiBase: env.CLRTY_API_BASE || DEFAULT_API_BASE,
    exchangeHealthUrl: env.CLRTY_EXCHANGE_HEALTH || DEFAULT_EXCHANGE_HEALTH,
    chainId: env.CLRTY_L1_CHAIN_ID || CLRTY1_CHAIN_ID,
    numericChainId: Number(env.CLRTY_L1_NUMERIC_CHAIN_ID || CLRTY1_NUMERIC_CHAIN_ID),
  };
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type Clrty1ProbeResult = {
  ok: boolean;
  rpcUrl: string;
  chainId: string;
  tipHeight?: number | string;
  error?: string;
  source: string;
  fallbacks_tried: string[];
};

export type Clrty1ConnectionReport = Clrty1ProbeResult & {
  numericChainId: number;
  apiBase: string;
  exchangeHealthUrl: string;
  affirmed: boolean;
};

export async function jsonRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
  id = 1,
): Promise<RpcResult<T>> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const body = (await res.json()) as {
      result?: T;
      error?: { message?: string };
    };
    if (body.error) return { ok: false, error: body.error.message || "rpc_error" };
    return { ok: true, data: body.result as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function affirmsChain(
  seen: string | number | undefined | null,
  cfg: Clrty1Config,
): boolean {
  if (seen == null || seen === "") return false;
  const raw = String(seen).trim();
  const normalized = raw.startsWith("0x")
    ? String(parseInt(raw, 16))
    : raw;
  const expectNum = String(cfg.numericChainId);
  return (
    raw === cfg.chainId ||
    raw.toLowerCase() === cfg.chainId.toLowerCase() ||
    normalized === expectNum ||
    raw === expectNum ||
    raw.toLowerCase().includes("clrty-1")
  );
}

function textAffirmsClrty1(text: string, cfg: Clrty1Config): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("clrty-1") ||
    lower.includes(`"chain":"${cfg.chainId}"`) ||
    lower.includes(`"chain_id":"${cfg.chainId}"`) ||
    lower.includes(`"numeric_chain_id":${cfg.numericChainId}`) ||
    lower.includes(String(cfg.numericChainId))
  );
}

async function probeRpcEndpoint(
  rpcUrl: string,
  cfg: Clrty1Config,
): Promise<{
  tip?: number | string;
  seenChain?: string;
  affirmed: boolean;
  error?: string;
}> {
  let tip: number | string | undefined;
  let seenChain: string | undefined;
  let lastError: string | undefined;

  for (const method of ["clrty_chainId", "eth_chainId", "net_version"] as const) {
    const r = await jsonRpc<string>(rpcUrl, method);
    if (r.ok && r.data != null) {
      seenChain = String(r.data);
      break;
    }
    lastError = r.ok ? undefined : r.error;
  }

  for (const method of ["clrty_blockNumber", "eth_blockNumber"] as const) {
    const r = await jsonRpc<string>(rpcUrl, method);
    if (r.ok && r.data != null) {
      tip = r.data;
      break;
    }
    lastError = r.ok ? undefined : r.error;
  }

  // Tip without chain is not enough for identity; require chain affirmation.
  const ok = seenChain != null ? affirmsChain(seenChain, cfg) : false;

  return {
    tip,
    seenChain,
    affirmed: ok,
    error: ok ? undefined : lastError || (seenChain ? "chain_mismatch" : "rpc_no_chain"),
  };
}

async function fetchText(
  url: string,
): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json,*/*" },
      signal: AbortSignal.timeout(8_000),
    });
    const text = await res.text();
    return { ok: res.ok || res.status < 500, status: res.status, text };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Multi-endpoint CLRTY-1 probe with failover.
 * Order: primary RPC → CLRTY_L1_RPC_FALLBACK → ${apiBase}/rpc → apiBase (chain affirm)
 * → exchange /health (chain / numeric_chain_id).
 * API JSON with `"chain":"clrty-1"` counts as connected even without tip (source: api_chain_affirm).
 * Fail closed only when no endpoint affirms clrty-1 / 1202.
 */
export async function probeClrty1(
  cfg: Clrty1Config = loadClrty1Config(),
): Promise<Clrty1ProbeResult> {
  const fallbacks_tried: string[] = [];
  const apiBase = cfg.apiBase.replace(/\/$/, "");

  // 1) Primary RPC JSON-RPC
  fallbacks_tried.push(`rpc:${cfg.rpcUrl}`);
  const primary = await probeRpcEndpoint(cfg.rpcUrl, cfg);
  if (primary.affirmed) {
    return {
      ok: true,
      rpcUrl: cfg.rpcUrl,
      chainId: primary.seenChain || cfg.chainId,
      tipHeight: primary.tip,
      source: "rpc",
      fallbacks_tried,
    };
  }
  if (primary.seenChain && !affirmsChain(primary.seenChain, cfg)) {
    return {
      ok: false,
      rpcUrl: cfg.rpcUrl,
      chainId: primary.seenChain,
      tipHeight: primary.tip,
      error: `chain_mismatch expected=${cfg.chainId}/${cfg.numericChainId} got=${primary.seenChain}`,
      source: "rpc",
      fallbacks_tried,
    };
  }

  // 2) CLRTY_L1_RPC_FALLBACK
  if (cfg.rpcFallbackUrl) {
    fallbacks_tried.push(`rpc_fallback:${cfg.rpcFallbackUrl}`);
    const fb = await probeRpcEndpoint(cfg.rpcFallbackUrl, cfg);
    if (fb.affirmed) {
      return {
        ok: true,
        rpcUrl: cfg.rpcFallbackUrl,
        chainId: fb.seenChain || cfg.chainId,
        tipHeight: fb.tip,
        source: "rpc_fallback",
        fallbacks_tried,
      };
    }
  }

  // 3) ${apiBase}/rpc
  const apiRpc = `${apiBase}/rpc`;
  fallbacks_tried.push(`api_rpc:${apiRpc}`);
  const apiRpcProbe = await probeRpcEndpoint(apiRpc, cfg);
  if (apiRpcProbe.affirmed) {
    return {
      ok: true,
      rpcUrl: apiRpc,
      chainId: apiRpcProbe.seenChain || cfg.chainId,
      tipHeight: apiRpcProbe.tip,
      source: "api_rpc",
      fallbacks_tried,
    };
  }

  // Also treat any body/header mentioning clrty-1 on api/rpc GET as affirm
  const apiRpcGet = await fetchText(apiRpc);
  if (apiRpcGet.text && textAffirmsClrty1(apiRpcGet.text, cfg)) {
    let chainId = cfg.chainId;
    try {
      const j = JSON.parse(apiRpcGet.text) as { chain?: string; chain_id?: string };
      chainId = j.chain || j.chain_id || cfg.chainId;
    } catch {
      /* keep default */
    }
    return {
      ok: true,
      rpcUrl: apiRpc,
      chainId,
      source: "api_chain_affirm",
      fallbacks_tried,
    };
  }

  // 4) apiBase root / any path — chain-affirmed connectivity
  fallbacks_tried.push(`api:${apiBase}`);
  const apiRoot = await fetchText(apiBase);
  if (apiRoot.text && textAffirmsClrty1(apiRoot.text, cfg)) {
    let chainId = cfg.chainId;
    let tip: number | string | undefined;
    try {
      const j = JSON.parse(apiRoot.text) as {
        chain?: string;
        chain_id?: string;
        height?: number;
        tipHeight?: number | string;
      };
      chainId = j.chain || j.chain_id || cfg.chainId;
      tip = j.height ?? j.tipHeight;
    } catch {
      /* keep defaults */
    }
    return {
      ok: true,
      rpcUrl: cfg.rpcUrl,
      chainId,
      tipHeight: tip,
      source: "api_chain_affirm",
      fallbacks_tried,
    };
  }

  // Try /health on api as well
  const apiHealthUrl = `${apiBase}/health`;
  fallbacks_tried.push(`api_health:${apiHealthUrl}`);
  const apiHealth = await fetchText(apiHealthUrl);
  if (apiHealth.text && textAffirmsClrty1(apiHealth.text, cfg)) {
    let chainId = cfg.chainId;
    let tip: number | string | undefined;
    try {
      const j = JSON.parse(apiHealth.text) as {
        chain?: string;
        chain_id?: string;
        height?: number;
      };
      chainId = j.chain || j.chain_id || cfg.chainId;
      tip = j.height;
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      rpcUrl: cfg.rpcUrl,
      chainId,
      tipHeight: tip,
      source: "api_chain_affirm",
      fallbacks_tried,
    };
  }

  // 5) exchange.clarity-fintech.com/health
  fallbacks_tried.push(`exchange_health:${cfg.exchangeHealthUrl}`);
  const ex = await fetchText(cfg.exchangeHealthUrl);
  if (ex.text) {
    try {
      const j = JSON.parse(ex.text) as {
        chain?: string;
        chain_id?: string;
        numeric_chain_id?: number;
        height?: number;
        tipHeight?: number | string;
      };
      const chainField = j.chain || j.chain_id;
      const numOk =
        j.numeric_chain_id != null &&
        Number(j.numeric_chain_id) === cfg.numericChainId;
      if (affirmsChain(chainField, cfg) || numOk || textAffirmsClrty1(ex.text, cfg)) {
        return {
          ok: true,
          rpcUrl: cfg.rpcUrl,
          chainId: chainField || cfg.chainId,
          tipHeight: j.height ?? j.tipHeight,
          source: "exchange_health",
          fallbacks_tried,
        };
      }
    } catch {
      if (textAffirmsClrty1(ex.text, cfg)) {
        return {
          ok: true,
          rpcUrl: cfg.rpcUrl,
          chainId: cfg.chainId,
          source: "exchange_health",
          fallbacks_tried,
        };
      }
    }
  }

  return {
    ok: false,
    rpcUrl: cfg.rpcUrl,
    chainId: cfg.chainId,
    error:
      primary.error ||
      apiRoot.error ||
      ex.error ||
      "no_endpoint_affirmed_clrty1",
    source: "none",
    fallbacks_tried,
  };
}

/** Full connection report for /health and CLI status. */
export async function getClrty1ConnectionReport(
  cfg: Clrty1Config = loadClrty1Config(),
): Promise<Clrty1ConnectionReport> {
  const probe = await probeClrty1(cfg);
  return {
    ...probe,
    numericChainId: cfg.numericChainId,
    apiBase: cfg.apiBase,
    exchangeHealthUrl: cfg.exchangeHealthUrl,
    affirmed: probe.ok,
  };
}

/** Throw if CLRTY-1 identity is not affirmed by any endpoint. */
export async function assertClrty1Connected(
  cfg: Clrty1Config = loadClrty1Config(),
): Promise<Clrty1ProbeResult> {
  const probe = await probeClrty1(cfg);
  if (!probe.ok) {
    throw new Error(
      `CLRTY-1 not connected: ${probe.error || "unknown"} (source=${probe.source})`,
    );
  }
  return probe;
}

export function rpcSmokeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLRTY_RPC_SMOKE !== "0";
}
