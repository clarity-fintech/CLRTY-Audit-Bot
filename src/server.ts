import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { loadClrty1Config, probeClrty1, CLRTY1_CHAIN_ID } from "./clrty1.js";
import { parseSentryWebhook } from "./sentry_webhook.js";
import { applyHealing } from "./healing.js";
import { linearConfigured } from "./linear.js";
import { validateEbpfPolicy } from "./security/validate_ebpf.js";
import { poolLoopsVersion } from "./liquidity/pool_loops.js";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createApp() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        const cfg = loadClrty1Config();
        const probe = await probeClrty1(cfg);
        const ebpf = validateEbpfPolicy();
        return send(res, 200, {
          ok: true,
          service: "CLRTY-Audit-Bot",
          chainId: CLRTY1_CHAIN_ID,
          clrty1: probe,
          ebpf_policy: {
            ok: ebpf.ok,
            version: ebpf.version,
            error: ebpf.error,
          },
          pool_loops: poolLoopsVersion(),
          linear: linearConfigured() ? "live" : "mock_file_sink",
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/webhooks/sentry") {
        const body = await readJson(req);
        const event = parseSentryWebhook(body);
        const result = await applyHealing(event);
        return send(res, 200, {
          ok: true,
          event: {
            action: event.action,
            issueId: event.issueId,
            title: event.title,
          },
          healing: result,
        });
      }

      return send(res, 404, { ok: false, error: "not_found" });
    } catch (e) {
      return send(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

const isMain =
  process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.PORT || 8091);
  const server = createApp();
  server.listen(port, () => {
    console.log(`CLRTY-Audit-Bot listening on :${port}`);
  });
}
