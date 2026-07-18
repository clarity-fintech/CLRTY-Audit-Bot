# CLRTY-1 security checklist

- [ ] Secrets only via env / wrangler / OS keychain — never committed
- [ ] `CLRTY_L1_RPC` uses HTTPS outside localhost
- [ ] Chain pin: `clrty-1` / numeric `1202` / denom `uclrty`
- [ ] Execute/settle/deploy paths fail closed if `probeClrty1` fails
- [ ] `security/ebpf/filters.yaml` present (`deny_by_default`)
- [ ] Skill manifest declares `operational_logic.substrate: CLRTY-1`
- [ ] No hardcoded private keys or API tokens in source
