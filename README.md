# CLRTY-Audit-Bot

Self-healing loop that links **Sentry** runtime issues to **Linear** tickets, enriched with **CLRTY-1** tip height and contract tags.

Without `LINEAR_API_KEY`, tickets are written to `var/tickets.jsonl` (mock sink).

## Endpoints

| Method | Path | Body |
|--------|------|------|
| `GET` | `/health` | — |
| `POST` | `/v1/webhooks/sentry` | Sentry issue webhook JSON |

## Healing rules (stub)

| Sentry action | Linear effect |
|---------------|---------------|
| created / unknown | create or update ticket |
| resolved | close ticket |
| reopened / regression | reopen ticket |

## Enrichment

- CLRTY-1 RPC tip height via `probeClrty1`
- Contract tags from `CLRTY_CONTRACT_TAGS` (comma-separated)

## Env

| Variable | Default |
|----------|---------|
| `CLRTY_L1_RPC` | `https://rpc.clarity-fintech.com` |
| `CLRTY_API_BASE` | `https://api.clarity-fintech.com` |
| `CLRTY_CONTRACT_TAGS` | _(empty)_ |
| `LINEAR_API_KEY` | _(unset → mock sink)_ |
| `LINEAR_TEAM_ID` | required when live |
| `CLRTY_RPC_SMOKE` | `1` (set `0` for offline CI) |
| `PORT` | `8091` |

## Run

```bash
cp .env.example .env
npm install
npm test
npm run build
npm start
```

```bash
curl -s http://127.0.0.1:8091/health
curl -s -X POST http://127.0.0.1:8091/v1/webhooks/sentry \
  -H 'content-type: application/json' \
  -d '{"action":"created","data":{"issue":{"id":"1","title":"demo","level":"error"}}}'
```

## License

Apache-2.0 © Clarity Fintech
