# eBPF settlement-path filters

Deny-by-default allowlist for CLRTY-1 RPC, API, and 1inch Fusion egress.

## Load (ops only — not CI)

```bash
# Example — adjust to your tc/cgroup setup
bpftool prog load settlement_path.bpf.c /sys/fs/bpf/clrty_settlement
# Apply filters.yaml allowlist via your controller
```

CI only checks that `filters.yaml` exists and `mode: deny_by_default`.
