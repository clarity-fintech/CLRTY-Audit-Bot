import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSentryWebhook } from "../src/sentry_webhook.js";
import { applyHealing } from "../src/healing.js";
import { parseContractTags } from "../src/enrich.js";

describe("parseSentryWebhook", () => {
  it("maps created and resolved actions", () => {
    const created = parseSentryWebhook({
      action: "created",
      data: { issue: { id: "123", title: "boom", shortId: "CLRTY-1", level: "error" } },
    });
    expect(created.action).toBe("created");
    expect(created.issueId).toBe("123");
    expect(created.title).toBe("boom");

    const resolved = parseSentryWebhook({
      action: "resolved",
      data: { issue: { id: "123", title: "boom", status: "resolved" } },
    });
    expect(resolved.action).toBe("resolved");
  });
});

describe("healing loop", () => {
  it("creates mock Linear ticket then closes on resolve", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clrty-audit-"));
    const sink = join(dir, "tickets.jsonl");
    const env = {
      CLRTY_RPC_SMOKE: "0",
      CLRTY_L1_RPC: "http://127.0.0.1:9",
      CLRTY_CONTRACT_TAGS: "FmaExecutionGateway,FmaStakingVault",
    };

    expect(parseContractTags(env)).toEqual([
      "FmaExecutionGateway",
      "FmaStakingVault",
    ]);

    const open = await applyHealing(
      parseSentryWebhook({
        action: "created",
        data: { issue: { id: "42", title: "RPC timeout", level: "error" } },
      }),
      env,
      sink,
    );
    expect(open.action).toBe("created");
    expect(open.ticket?.mode).toBe("mock");
    expect(open.ticket?.status).toBe("open");
    expect(open.enrichment.contractTags).toContain("FmaExecutionGateway");

    const closed = await applyHealing(
      parseSentryWebhook({
        action: "resolved",
        data: { issue: { id: "42", title: "RPC timeout", status: "resolved" } },
      }),
      env,
      sink,
    );
    expect(closed.action).toBe("closed");
    expect(closed.ticket?.status).toBe("closed");
    expect(closed.rule).toBe("sentry_resolve_closes_linear");

    const reopened = await applyHealing(
      parseSentryWebhook({
        action: "reopened",
        data: { issue: { id: "42", title: "RPC timeout", status: "unresolved" } },
      }),
      env,
      sink,
    );
    expect(reopened.action).toBe("reopened");
    expect(reopened.ticket?.status).toBe("reopened");

    const lines = (await readFile(sink, "utf8")).trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });
});
