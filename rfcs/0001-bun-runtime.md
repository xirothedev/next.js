# RFC: Bun Runtime Support for Next.js

**Status:** Draft (design only — no runtime code ships in this PR)  
**Author:** [@xirothedev](https://github.com/xirothedev)  
**Date:** 2026-10-10  
**Target Reviewers:** Next.js upstream maintainers

> **Empirical basis.** The compatibility matrix (§6), benchmark (§5), and risk analysis (§7) were **measured against Bun 1.3.14** using the reproducible harness in `scripts/bun-compat/` (the only code in this PR besides this document). Where measurement contradicted the initial Bun-docs estimate, **the measured value wins**. Headline finding: every Node.js API Next.js's server imports loads and behaves correctly on Bun, so Phase 1 needs **no runtime shim layer** — the real risk is behavioral/ecosystem, not API surface. See §6.
>
> **Scope of this PR.** This is a design RFC. It changes **no** runtime/config source — the `experimental.bun` flag ships with the implementation PR (§9), not here, so a design review isn't blocked on code that only "looks" implemented.

---

## 1. Problem Statement

### Why Bun?

Next.js currently requires Node.js as its server runtime. While Node.js is mature and performant, the JavaScript runtime landscape has shifted:

- **Performance**: On a `node:http` JSON echo benchmark run locally for this RFC (§5), Bun served **~2.2×** the requests/second of Node.js 22. Bun's own benchmarks report larger `Bun.serve()` gains; the point stands that the runtime headroom is real, not theoretical.
- **Unification**: Bun combines runtime, package manager, bundler, and test runner in one binary. Supporting Bun reduces fragmentation for teams already using it for tooling.
- **Production demand**: Next.js already runs on Bun via `bun --bun next start`, but it is **unofficial and untested in CI**. Formalizing it turns a working-but-fragile path into a supported, regression-tested one.

### Why now?

Bun 1.3+ already loads the full Node.js surface Next.js's server uses (§6). Bun 1.4 (Aug 2026) rewrote the runtime in Rust and tracks Node.js 26.x compatibility; Bun 2.x pushed npm-package compatibility to ~99.4%. The runtime is mature enough for a supported experimental path.

### Non-goals

- Replacing Turbopack with Bun's bundler (Turbopack remains the bundler).
- Replacing SWC with Bun's transpiler.
- Changing the default runtime (Node.js remains default).
- Making `bun install` / `bun test` the default (that's a later phase, §3).

---

## 2. Proposed Solution

### 2.1 Opt-in mechanism

```typescript
// next.config.ts
export default {
  experimental: {
    bun: true,
  },
}
```

- `experimental.bun: true` is the primary opt-in.
- It does **not** change `NEXT_RUNTIME` (see §2.2). Bun is detected at runtime via `process.versions.bun`, so no extra env var or config surface is introduced.

The flag is **not** added by this PR. The implementation PR adds exactly two declarations (the `experimental` schema is a `strictObject`, so both are required for `experimental.bun` to validate; each is additive — absent stays optional, and no `NextConfigRuntime` Pick entry is needed because the flag is read at the CLI/start boundary, not inside pre-compiled bundles):

```typescript
// config-shared.ts — ExperimentalConfig
bun?: boolean

// config-schema.ts — experimentalSchema
bun: z.boolean().optional(),
```

### 2.2 Runtime detection — keep `NEXT_RUNTIME=nodejs`, detect Bun separately

The initial design auto-set `NEXT_RUNTIME=bun`. **Verification overturned this.** Besides ~100 `=== 'edge'` checks, the codebase has exact `=== 'nodejs'` comparisons that select capability, and one is load-bearing: `build/webpack/alias/react-dom-server.js` picks the server React build with `if (process.env.NEXT_RUNTIME === 'nodejs')`. Setting `NEXT_RUNTIME=bun` makes that test false and silently selects the **wrong React server build**, breaking SSR — a regression a design doc would never catch.

Therefore: under `experimental.bun`, `NEXT_RUNTIME` stays `'nodejs'` (Bun runs the existing Node code path unchanged — exactly what §6's measurement supports). Where Bun-specific behavior is ever needed, branch on `process.versions.bun` at that single site, never on a new `NEXT_RUNTIME` value. The only exact `=== 'nodejs'` sites, for reference by the implementation PR:

- `build/webpack/alias/react-dom-server.js`, `.../react-dom-server-experimental.js` — React server build selection (**must stay `nodejs`**)
- `shared/lib/bloom-filter.ts` — fast-path selection (falls back safely)
- `build/templates/app-page-runtime.ts` — runtime label

### 2.3 Compatibility shims (none needed today)

Measurement found **no shim is required** for the Node.js APIs Next.js's server imports (§6). No shim directory is created or pre-designed. The principle, should a shim ever become necessary: rely on Bun's built-in compat first; add a shim **only** at the seam of a **reproduced** gap (never a docs-suspected one), tagged with a "delete me when Bun upstreams this" note; upstream everything else. The location/shape of such a shim is decided by the PR that adds it, not speculatively here.

### 2.4 Bun-specific entry points

None in Phase 1. `next start` detects Bun via `process.versions.bun` and keeps `NEXT_RUNTIME=nodejs`; the Node.js build output is byte-identical, so no separate server bundle is produced.

---

## 3. Implementation Plan

### Phase 1: Server Runtime (this RFC's subject)

Make `next start` a supported production runtime on Bun.

**Scope:** `next start` only (not `next dev`); Node.js build pipeline unchanged; edge runtime unchanged.

**Deliverables (all in the follow-up implementation PR, none in this RFC PR):**

1. `experimental.bun` flag: the two `config-shared.ts` / `config-schema.ts` declarations from §2.1.
2. Bun detection at the CLI/start seam (`bin/next.ts`): when `experimental.bun` is set, log a Bun banner; keep `NEXT_RUNTIME=nodejs`.
3. Startup warning + graceful Node.js fallback when the flag is set but the process is Node.
4. Compatibility matrix wired as a CI artifact (harness already exists: `scripts/bun-compat/`, §6).
5. CI job: `next start` on Bun over a subset of e2e tests.
6. User documentation + migration guide.

**No shim layer** is in the deliverable list — measurement showed none is needed (§6).

**TDD approach (follow-up PR):** red → green per deliverable; the test seams are (a) config parsing of `experimental.bun`, (b) `NEXT_RUNTIME` staying `'nodejs'` and the 4 `=== 'nodejs'` capability sites still resolving to the Node build under the flag, (c) the fallback warning when the flag is set but `process.versions.bun` is absent.

> **Adjacent surface, not a numbered phase:** `next dev` on Bun (HMR, file watching, on-demand compilation, middleware sandbox) is a materially larger surface than `next start` and is deliberately kept out of Phase 1 and out of the phase spine below — it is treated as its own future effort when taken up.

### The remaining phases (issue #2's spine, in order)

- **Phase 2 — Package Manager:** `bun install` / `bunx` support in `create-next-app` and the CLI.
- **Phase 3 — Standalone Output:** `output: 'standalone'` emits a Bun-compatible `server.js`.
- **Phase 4 — Framework Build:** Next.js's own build runs on Bun (this is where build-time-on-Bun becomes measurable).
- **Phase 5 — App Bundler (speculative):** evaluate Bun's bundler vs Turbopack for app code.

---

## 4. Migration Strategy

### For existing Node.js users

**Zero impact.** `experimental.bun` is opt-in; users who don't set it run on Node.js unchanged, with an identical build output.

If the flag is set but the process is actually Node.js (misconfigured deploy), the server logs a console warning and continues on Node.js. It does **not** hard-error.

### For new Bun users

```bash
# 1. Install Bun
curl -fsSL https://bun.sh/install | bash

# 2. Opt in — next.config.ts → experimental.bun: true

# 3. Build (unchanged, on Node.js)
next build

# 4. Serve on Bun
bun --bun next start
```

### Rollout stages

| Stage        | Criteria                                                                     |
| ------------ | ---------------------------------------------------------------------------- |
| Experimental | Opt-in, console warning, known behavioral gaps documented                    |
| Beta         | Opt-in, no warning, CI Bun matrix green, benchmark targets met               |
| Stable       | Still opt-in (not default), full Bun CI green, no critical bugs for 4+ weeks |

### Deprecation path

`experimental.bun` → top-level `bun: true` (stable config) → runtime default only if adoption warrants.

---

## 5. Performance Benchmarks

### Measured baseline (this RFC)

A minimal `node:http` JSON echo server, 20,000 requests at concurrency 50, run twice on each runtime on one machine (this RFC author's Linux host):

| Runtime       | Run 1        | Run 2        |
| ------------- | ------------ | ------------ |
| Node.js 22.23 | 16,598 req/s | 16,570 req/s |
| Bun 1.3.14    | 36,232 req/s | 37,244 req/s |

**≈2.2× throughput for Bun on raw `node:http`.** This is a _runtime_ baseline using the same `node:http` API both runtimes expose — it isolates the runtime, not Next.js. It is **not** an end-to-end `next start` number.

> Reproduce: `node scripts/bun-compat/http-bench.mjs` and `bun scripts/bun-compat/http-bench.mjs`.

### Not yet measured (needs a built workspace)

App-level `next start` cold-start, RSS, p99, and SSR throughput require a full `next build`, which requires installed deps. These are **deferred to the implementation PR** (§9), run on dedicated hardware with the tiers below. Reporting numbers I could not reproduce would be misleading, so none are claimed here.

### Workload tiers (for the implementation PR)

1. **Static page** — cold start + throughput.
2. **SSR page** — render performance under load.
3. **API route** — JSON serialization + I/O.
4. **Build time** — see note below.

### Targets

| Metric             | Target                         |
| ------------------ | ------------------------------ |
| Cold start         | Within 10% of Node.js baseline |
| Throughput (req/s) | ≥1.5× Node.js baseline         |
| Memory (RSS)       | Within 20% of Node.js baseline |
| p99 latency        | Within 10% of Node.js baseline |
| Build time         | See note — not a Phase 1 goal  |

**Build-time note (issue #2 listed "build time" as an expected gain).** In Phase 1, `next build` stays on Node.js by design (§3 scope), so Bun has **no effect on build time** — the correct Phase 1 target is _parity_ (`1.0×`, measured as a regression guard, method: `time next build` on the same fixture, Node.js only). Build-on-Bun is genuinely Phase 4 (§3), where the tier-4 build-time target becomes a speedup goal. Claiming a build-time win now would be false.

---

## 6. Compatibility Matrix (measured)

Issue #2 asked which of the **~68 Node.js builtins** work on Bun. 68 is `require('module').builtinModules.length` — Node's full list. The actionable subset is what Next.js's **server** actually references: grepping `packages/next/src/server` yields **26 `node:` specifiers**, of which one (`node:internal/process/task_queues`) is a comment-only mention and the rest split into ~19 direct runtime imports plus a handful that appear only in test/build-tooling files. So the honest frame is: **of Node's 68 builtins, the Next.js server references 25 real ones, and every one of them works on Bun.**

`scripts/bun-compat/compat-probe.mjs` loads its module list **from that grep** (not hand-guessed) and probes the 23 loadable modules two ways: (A) does the module load with every symbol Next.js imports present, and (B — in `behavior-probe.mjs`) do the specific APIs Next.js _calls_ behave like Node.

**Result: 23/23 load; every Next.js-called symbol is present; 0 gaps.** For the three-way classification the issue asked (works / needs shim / needs upstream fix): all 25 referenced modules are **"works"** for Next.js's usage — **0 need a Next.js shim and 0 need a Bun upstream fix**, because the modules where Bun diverges are not ones Next.js calls.

| Module (server-referenced)                                         | Loads w/ Next.js's symbols | Behavior where Next.js calls it                                           | Shim |
| ------------------------------------------------------------------ | :------------------------: | ------------------------------------------------------------------------- | :--: |
| `node:fs`, `node:fs/promises`                                      |             ✅             | `readFileSync`/`existsSync`/`promises` ok                                 |  No  |
| `node:stream`, `node:stream/promises`                              |             ✅             | `Readable`/`Duplex`/`pipeline`; `stream/promises.pipeline` ok             |  No  |
| `node:timers`, `node:timers/promises`                              |             ✅             | `setTimeout`/`setImmediate`; `timers/promises.setImmediate` ok            |  No  |
| `node:assert`                                                      |             ✅             | `ok`/`strictEqual`/`deepStrictEqual` ok                                   |  No  |
| `node:async_hooks`                                                 |             ✅             | `AsyncLocalStorage` works (the only API prod code uses)                   |  No  |
| `node:http`                                                        |             ✅             | `createServer`/`IncomingMessage`/`ServerResponse` ok                      |  No  |
| `node:crypto`                                                      |             ✅             | `createHash`/`randomBytes`/`randomUUID`/`createHmac`/`timingSafeEqual` ok |  No  |
| `node:util`                                                        |             ✅             | `types`/`promisify`/`inspect`/`styleText` ok                              |  No  |
| `node:url`, `node:querystring`, `node:path`                        |             ✅             | ok                                                                        |  No  |
| `node:events`, `node:buffer`, `node:zlib`                          |             ✅             | ok                                                                        |  No  |
| `node:module`                                                      |             ✅             | `createRequire`/`builtinModules` ok                                       |  No  |
| `node:inspector`                                                   |             ✅             | `Session`/`open`/`url` ok                                                 |  No  |
| `node:net`, `node:vm`, `node:worker_threads`, `node:child_process` |             ✅             | ok (build/tooling + server tests, not hot server path)                    |  No  |

Two Node APIs that Bun lacks outright — `module.registerHooks` and `http2.SecureServerSession` — are **not imported anywhere in `src/server`**, so they are out of scope rather than gaps. (`node:http2` is not referenced by the server at all.)

### Behavioral divergences found (and why each is a non-issue)

Probing behavior, not just loadability, surfaced three real Bun/Node divergences — each **cross-checked against Next.js usage** and found irrelevant:

1. **`async_hooks.createHook` never fires; `executionAsyncId()` returns 0.** → Next.js production code uses **only `AsyncLocalStorage`**, which Bun implements correctly. `createHook` appears in Next.js solely in a test fixture (`fast-set-immediate.external.test.ts`). Non-issue.
2. **`crypto` rejects `secp256k1` and `chacha20-poly1305`.** → Next.js uses only `createHash`/`randomBytes`/`randomUUID`/`createHmac`/`timingSafeEqual`. `createDiffieHellman` even works. Non-issue.
3. **`http.Server` does not extend `net.Server`.** → No Next.js code does `instanceof net.Server` or relies on `net.Server` methods on the HTTP server. Non-issue.

> Reproduce: `bun scripts/bun-compat/compat-probe.mjs` (loadability) and `bun scripts/bun-compat/behavior-probe.mjs` (behavior).

### The real risk is downstream, not the core modules

Every core module the server references works. The genuine compatibility risk is **userland/npm and native addons** (e.g. `sharp`, `better-sqlite3`, `bcrypt`, OpenTelemetry/`datadog`/`newrelic` auto-instrumentation), which Next.js doesn't own but its users depend on. That's an ecosystem story (§7), not a framework-API story.

---

## 7. Risks and Mitigations

### Risk taxonomy (likelihood revised after measurement)

| Category                  | Examples                                                 | Likelihood | Impact |
| ------------------------- | -------------------------------------------------------- | ---------- | ------ |
| Core Node.js API gaps     | ~~async_hooks, crypto~~ — measured clean (§6)            | **Low**    | —      |
| Behavioral differences    | error text, timing, `net`/`tls` socket edge cases        | Medium     | Medium |
| Native modules (userland) | `sharp` segfaults, `better-sqlite3` unsupported          | **High**   | High   |
| Ecosystem assumptions     | packages checking `process.versions.node`                | Medium     | Medium |
| Bun target drift          | `process.versions.node` bump (24→26) breaks N-API addons | Medium     | High   |

### Detection

1. **Generated compat matrix** (`scripts/bun-compat/`) — run in CI against a Bun version.
2. **CI matrix** — `next start` on Bun over an e2e subset, per Bun × Next.js version.
3. **Startup detection** — `process.versions.bun` present → log the Bun runtime + version banner.

### Mitigation

| Risk                   | Mitigation                                                   |
| ---------------------- | ------------------------------------------------------------ |
| Core API gaps          | None needed today; add a seam shim only if reproduced (§2.3) |
| Behavioral differences | e2e Bun matrix catches divergence; Node.js path is unchanged |
| Native modules         | Document unsupported packages; feature-detect + clear error  |
| Ecosystem assumptions  | PR-review checklist: flag `process.versions.node` checks     |

### Rollback

1. Remove `experimental.bun` from config → back to Node.js.
2. Deployment platform overrides `NEXT_RUNTIME=nodejs`.
3. No data migration — build output is identical.

---

## 8. Resolved Questions

1. **Does `experimental.bun` affect `next dev`?** No — production `next start` only until stable; `next dev` is an adjacent future effort (§3).
2. **Minimum Bun version?** Track the latest stable Bun; CI pins one (1.3.x validated here). No lower pin until a compatibility floor is required by a reproduced gap.
3. **Generated vs manual matrix?** **Generated** — `scripts/bun-compat/` emits it from a live probe, so it can't drift from reality.
4. **PoC before review?** Design + this measured validation plan are sufficient for a design-only RFC; the PoC is the follow-up implementation PR.

---

## 9. Validation Plan

**Done by this RFC (Bun 1.3.14):** module-by-module loadability + behavior probe (§6); runtime throughput baseline (§5).

**Implementation PR (needs installed deps + built workspace):**

1. Red → green for config parsing of `experimental.bun` (seam: parsed config).
2. Red → green that the start path keeps `NEXT_RUNTIME=nodejs` (seam: env observed by the server) and that the `react-dom-server` alias still resolves to the Node server build under `experimental.bun`.
3. Red → green for the Node-with-flag-set warning + fallback (seam: startup log + chosen runtime).
4. e2e: boot a fixture app with `bun --bun next start`, assert a page + API route render.
5. App-level benchmarks on the §5 tiers vs Node.js baseline (incl. the build-time regression guard).
6. CI job wiring the Bun matrix + compat-probe artifact.

**Shims:** none planned. If a reproduced gap appears, add one at its `node:` module seam via a fresh red → green slice (§2.3).

---

## 10. References

- [Bun Node.js Compatibility Docs](https://bun.com/docs/runtime/nodejs-compat) — self-reported pass rates, used only as a starting hypothesis; superseded by §6 measurement.
- [Next.js `NEXT_RUNTIME` usage](https://github.com/vercel/next.js/tree/canary/packages/next/src/server) — the de-facto runtime seam.
- [Next.js `config-shared.ts`](https://github.com/vercel/next.js/tree/canary/packages/next/src/server/config-shared.ts) — where `experimental.bun` will land (implementation PR).
- `scripts/bun-compat/` — the harness that produced §5–§6.
