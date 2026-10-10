# `bun-compat` — compatibility + benchmark harness for the Bun runtime RFC

Reproducible probes backing [`rfcs/0001-bun-runtime.md`](../../rfcs/0001-bun-runtime.md) §5–§6. Each script runs standalone (no Next.js build needed). Run them under Bun for the real signal; Node is included to sanity-check the Node baseline.

| Script              | What it measures                                                       |
| ------------------- | ---------------------------------------------------------------------- |
| `compat-probe.mjs`  | Do the 19 `node:` modules Next.js imports **load** with every imported symbol? |
| `behavior-probe.mjs`| Do the specific APIs Next.js **calls** behave like Node (not just load)? |
| `http-bench.mjs`    | `node:http` JSON-echo throughput — a runtime baseline, not `next start`. |

`_runtime.mjs` is a shared helper (the runtime label); import it, don't duplicate it.

```bash
bun scripts/bun-compat/compat-probe.mjs
bun scripts/bun-compat/behavior-probe.mjs
node scripts/bun-compat/http-bench.mjs   # Node baseline
bun  scripts/bun-compat/http-bench.mjs   # Bun baseline
```

The probe lists are derived from Next.js's actual `node:` imports (re-run the grep in `compat-probe.mjs`'s header to refresh), so a `PARTIAL` is only actionable if Next.js calls the missing symbol. The behavior probe INTENTIONALLY exercises APIs Next.js does not call — that is the evidence behind the "no shim needed" claim (RFC §6), not speculation.
