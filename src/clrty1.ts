/** CLRTY-1 L1 RPC client — duplicated into each service repo (no private npm this pass). */

export const CLRTY1_CHAIN_ID = "clrty-1";
export const CLRTY1_NUMERIC_CHAIN_ID = 1202;
export const CLRTY1_DENOM = "uclrty";
export const CLRTY1_DECIMALS = 9;

export type Clrty1Config = {
  rpcUrl: string;
  apiBase: string;
  chainId: string;
  numericChainId: number;
};

export function loadClrty1Config(env: NodeJS.ProcessEnv = process.env): Clrty1Config {
  return {
    rpcUrl:
      env.CLRTY_L1_RPC ||
      env.CLRTY_L1_RPC_URL ||
      "https://rpc.clarity-fintech.com",
    apiBase: env.CLRTY_API_BASE || "https://api.clarity-fintech.com",
    chainId: env.CLRTY_L1_CHAIN_ID || CLRTY1_CHAIN_ID,
    numericChainId: Number(env.CLRTY_L1_NUMERIC_CHAIN_ID || CLRTY1_NUMERIC_CHAIN_ID),
  };
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

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

/** Probe CLRTY-1 node; fail closed if chain id mismatches when returned. */
export async function probeClrty1(
  cfg: Clrty1Config = loadClrty1Config(),
): Promise<{
  ok: boolean;
  rpcUrl: string;
  chainId: string;
  tipHeight?: number | string;
  error?: string;
  source: string;
}> {
  const methods = ["clrty_chainId", "eth_chainId", "net_version", "clrty_blockNumber", "eth_blockNumber"];
  let tip: number | string | undefined;
  let seenChain: string | undefined;

  for (const method of ["clrty_chainId", "eth_chainId", "net_version"] as const) {
    const r = await jsonRpc<string>(cfg.rpcUrl, method);
    if (r.ok && r.data != null) {
      seenChain = String(r.data);
      break;
    }
  }

  for (const method of ["clrty_blockNumber", "eth_blockNumber"] as const) {
    const r = await jsonRpc<string>(cfg.rpcUrl, method);
    if (r.ok && r.data != null) {
      tip = r.data;
      break;
    }
  }

  // Also try REST health on API base
  if (tip === undefined) {
    try {
      const h = await fetch(`${cfg.apiBase.replace(/\/$/, "")}/health`);
      if (h.ok) {
        const j = (await h.json().catch(() => ({}))) as { height?: number; chain_id?: string };
        if (j.height != null) tip = j.height;
        if (j.chain_id) seenChain = j.chain_id;
      }
    } catch {
      /* ignore */
    }
  }

  if (seenChain) {
    const normalized = seenChain.startsWith("0x")
      ? String(parseInt(seenChain, 16))
      : seenChain;
    const expectNum = String(cfg.numericChainId);
    const ok =
      seenChain === cfg.chainId ||
      normalized === expectNum ||
      seenChain === expectNum ||
      seenChain.toLowerCase() === cfg.chainId.toLowerCase();
    if (!ok) {
      return {
        ok: false,
        rpcUrl: cfg.rpcUrl,
        chainId: seenChain,
        tipHeight: tip,
        error: `chain_mismatch expected=${cfg.chainId}/${cfg.numericChainId} got=${seenChain}`,
        source: "rpc",
      };
    }
  }

  // Reachability: if we got tip OR a successful HTTP to rpc, ok
  if (tip !== undefined || seenChain) {
    return {
      ok: true,
      rpcUrl: cfg.rpcUrl,
      chainId: seenChain || cfg.chainId,
      tipHeight: tip,
      source: "rpc",
    };
  }

  // Last resort: OPTIONS/GET on RPC root
  try {
    const res = await fetch(cfg.rpcUrl, { method: "GET" });
    if (res.ok || res.status === 405 || res.status === 400) {
      return {
        ok: true,
        rpcUrl: cfg.rpcUrl,
        chainId: cfg.chainId,
        source: "http_reachable",
      };
    }
    return {
      ok: false,
      rpcUrl: cfg.rpcUrl,
      chainId: cfg.chainId,
      error: `unreachable http_${res.status}`,
      source: "http",
    };
  } catch (e) {
    return {
      ok: false,
      rpcUrl: cfg.rpcUrl,
      chainId: cfg.chainId,
      error: e instanceof Error ? e.message : String(e),
      source: "http",
    };
  }
}

export function rpcSmokeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLRTY_RPC_SMOKE !== "0";
}
