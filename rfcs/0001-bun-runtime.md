# RFC: Bun Runtime Support for Next.js

**Status:** Draft  
**Author:** [@xirothedev](https://github.com/xirothedev)  
**Date:** 2026-10-10  
**Target Reviewers:** Next.js upstream maintainers

---

## 1. Problem Statement

### Why Bun?

Next.js currently requires Node.js as its server runtime. While Node.js is mature and performant, the JavaScript runtime landscape has shifted significantly:

- **Performance**: Bun's HTTP server handles ~180,000 req/s vs Node.js's ~65,000 req/s. Cold start times are 8–15ms on Bun vs 40–120ms on Node.js.
- **Unification**: Bun combines runtime, package manager, bundler, and test runner in one binary. Supporting Bun reduces fragmentation for teams that already use it for tooling.
- **Production demand**: Next.js already runs unofficially on Bun (`bun --bun next dev`). Vercel has shipped first-party Bun runtime support. Formalizing this reduces maintenance burden from unofficial workarounds.

### Why now?

Bun 1.4 (August 2026) rewrote the runtime in Rust and targets Node.js 26.3.0 compatibility. Bun 2.0 (May 2026) pushed npm package compatibility to ~99.4%. The runtime is now stable enough for production experimentation.

### Non-goals

- Replacing Turbopack with Bun's bundler (Turbopack remains the bundler)
- Replacing SWC with Bun's transpiler
- Changing the default runtime (Node.js remains default)

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
- Internally sets `NEXT_RUNTIME=bun` for the server process.
- An env var `NEXT_RUNTIME=bun` is also supported for deployment platforms that cannot set config.

### 2.2 Compatibility shim layer

A thin shim layer lives at `packages/next/src/server/bun/`:

```
packages/next/src/server/bun/
├── registry.ts          # Module → shim manifest
├── shims/
│   ├── async_hooks.ts    # For Bun's stub APIs
│   ├── crypto.ts         # For missing key types/ciphers
│   └── ...
```

**Principles:**

- Rely on Bun's built-in Node.js compat first.
- Ship targeted shims only for critical gaps.
- Upstream fixes in Bun for everything else.
- Every shim has a "delete me when upstream fixes this" contract.

### 2.3 Bun-specific entry points

No new entry points in Phase 1. The existing `next start` entry point branches internally on `NEXT_RUNTIME=bun`.

---

## 3. Implementation Plan

### Phase 1: Server Runtime (this RFC)

Make `next start` work on Bun as a production server runtime.

**Scope:**

- `next start` only (not `next dev`)
- Node.js build pipeline unchanged
- Edge runtime unchanged

**Deliverables:**

1. `experimental.bun` flag in config schema + config-shared
2. `NEXT_RUNTIME=bun` handling in server bootstrap
3. Compatibility shim layer (`server/bun/`)
4. Compatibility matrix (all 19 `node:` modules)
5. CI matrix: Bun version × Next.js version
6. Integration tests: `next start` on Bun
7. User documentation + migration guide

**TDD approach:**

- Red → green loop for each shim
- Vertical slices: one module → one test → one shim
- Test seams: each `node:` module's public API surface
- Use existing repo test infrastructure

### Phase 2: Dev Server (future)

`next dev` on Bun. Includes HMR, file watching, on-demand compilation, middleware sandbox.

### Phase 3: Package Manager (future)

`bun install` support in `create-next-app` and CLI.

### Phase 4: Standalone Output (future)

`output: 'standalone'` generates a Bun-compatible `server.js`.

### Phase 5: Framework Build (future)

Next.js framework code itself runs on Bun during `next build`.

### Phase 6: App Bundler (future)

Evaluate Bun's bundler vs Turbopack for app code. Speculative.

---

## 4. Migration Strategy

### For existing Node.js users

**Zero impact.** The `experimental.bun` flag is opt-in. Existing users who do not set it continue running on Node.js with no changes.

If the flag is set but the process runs on Node.js (e.g., misconfigured deployment), the server logs a console warning and falls back to Node.js. It does not hard-error.

### For new Bun users

```bash
# 1. Install Bun
curl -fsSL https://bun.sh/install | bash

# 2. Set the flag
# next.config.ts → experimental.bun: true

# 3. Build (still on Node.js)
next build

# 4. Start on Bun
bun --bun next start
```

### Rollout stages

| Stage        | Criteria                                                                            |
| ------------ | ----------------------------------------------------------------------------------- |
| Experimental | Opt-in, console warning, known gaps documented                                      |
| Beta         | Opt-in, no warning, compatibility matrix ≥95% green, benchmark targets met          |
| Stable       | Still opt-in (not default), all compat tests passing, no critical bugs for 4+ weeks |

### Deprecation path

`experimental.bun` → `bun: true` (stable config) → eventually runtime default if adoption warrants.

---

## 5. Performance Benchmarks

### Methodology

Benchmarks run on dedicated hardware (not shared CI) with:

- Node.js LTS (current) vs Bun 1.4+
- Same Next.js build output
- Warm and cold start
- 3 workload tiers

### Workload tiers

1. **Static page** — cold start + throughput
2. **SSR page** — rendering performance under load
3. **API route** — JSON serialization + I/O

### Metrics

| Metric             | Target                         |
| ------------------ | ------------------------------ |
| Cold start         | Within 10% of Node.js baseline |
| Throughput (req/s) | ≥1.5x Node.js baseline         |
| Memory (RSS)       | Within 20% of Node.js baseline |
| p99 latency        | Within 10% of Node.js baseline |

### Reporting

Benchmarks are published as part of the RFC review. Numbers are reproducible via a documented script.

---

## 6. Compatibility Matrix

### Node.js modules used by Next.js server

Next.js server imports **19 unique `node:` modules** across ~65 call sites.

| Module                | Bun Status | Shim Needed | Notes                                                                              |
| --------------------- | ---------- | ----------- | ---------------------------------------------------------------------------------- |
| `node:http`           | 97% pass   | No          | Fully implemented                                                                  |
| `node:stream`         | 97% pass   | No          | Fully implemented                                                                  |
| `node:fs`             | 97% pass   | No          | Fully implemented                                                                  |
| `node:events`         | 100% pass  | No          | Fully implemented                                                                  |
| `node:vm`             | 97% pass   | No          | Fully implemented                                                                  |
| `node:zlib`           | 97% pass   | No          | Fully implemented                                                                  |
| `node:url`            | 100% pass  | No          | Fully implemented                                                                  |
| `node:util`           | 94% pass   | Possible    | `styleText`, `inspect` edge cases                                                  |
| `node:path`           | 100% pass  | No          | Fully implemented                                                                  |
| `node:async_hooks`    | Partial    | **Yes**     | `createHook`, `executionAsyncId` are stubs; `AsyncLocalStorage` works              |
| `node:crypto`         | Partial    | **Yes**     | Missing `ed448`, `x448`, `rsa-pss`, `dsa`, `dh`, `ml-kem-512`, some curves/ciphers |
| `node:buffer`         | 100% pass  | No          | Fully implemented                                                                  |
| `node:querystring`    | 100% pass  | No          | Fully implemented                                                                  |
| `node:assert`         | 100% pass  | No          | Fully implemented                                                                  |
| `node:net`            | Partial    | **Yes**     | TLS socket behavior differences                                                    |
| `node:tls`            | Partial    | **Yes**     | `rejectUnauthorized` defaults, `handshakeTimeout` behavior                         |
| `node:https`          | Partial    | **Yes**     | `getPeerCertificate()`, `getCipher()` missing on socket                            |
| `node:worker_threads` | Partial    | Possible    | `resourceLimits`, `stdout`/`stderr` options newer                                  |
| `node:child_process`  | Partial    | Possible    | `spawn()` encoding behavior differs                                                |

### Risk modules (shim candidates)

1. **`node:async_hooks`** — Critical for Next.js (used in sandbox, patch-fetch, cache handlers). Bun's `AsyncLocalStorage` works but hooks are stubs. Shim: polyfill `createHook` using `AsyncLocalStorage` internals.

2. **`node:crypto`** — Used for image optimization, cache keys, OG image generation. Missing key types may cause runtime errors for specific operations. Shim: feature-detect and throw helpful error, or fallback to WebCrypto where possible.

3. **`node:net` / `node:tls` / `node:https`** — Used for HTTP server, image optimizer proxying, fetch. TLS behavior differences could cause subtle bugs. Shim: normalize socket behavior, feature-detect and warn.

---

## 7. Risks and Mitigations

### Risk taxonomy

| Category               | Examples                                    | Likelihood | Impact |
| ---------------------- | ------------------------------------------- | ---------- | ------ |
| Node.js API gaps       | `async_hooks` stubs, `crypto` missing types | High       | High   |
| Behavioral differences | Error messages, timing, stream semantics    | Medium     | Medium |
| Native modules         | N-API partial support, `better-sqlite3`     | Medium     | High   |
| Ecosystem assumptions  | Packages checking `process.versions.node`   | Medium     | Medium |

### Detection

1. **Compatibility test suite** — automated tests for all 19 modules
2. **Runtime feature detection** — check `process.versions.bun` + specific API availability at startup
3. **CI matrix** — Bun version × Next.js version, run on every PR touching `server/bun/`

### Mitigation

| Risk                   | Mitigation                                              |
| ---------------------- | ------------------------------------------------------- |
| API gaps               | Shim layer with clear upstream-fix contract             |
| Behavioral differences | Compat tests catch divergence; fallback to Node.js path |
| Native modules         | Document unsupported packages; provide alternatives     |
| Ecosystem assumptions  | PR review checklist for Node.js-specific checks         |

### Rollback

1. Remove `experimental.bun` from config → back to Node.js
2. Deployment platform overrides with `NEXT_RUNTIME=node`
3. No data migration needed — build output is identical

---

## 8. Open Questions

1. Should `experimental.bun` also affect `next dev` in a future phase, or remain production-only until stable?
2. What is the minimum Bun version to support? (Proposed: 1.4+)
3. Should the compatibility matrix be a generated artifact or manually maintained?
4. Does the RFC need a formal proof-of-concept before maintainer review, or is design + test plan sufficient?

---

## 9. Validation Plan

Before Phase 1 implementation:

1. **Manual smoke test**: `bun --bun next start` on a simple app
2. **Module-by-module verification**: Run each of the 19 modules in isolation on Bun
3. **Baseline benchmarks**: Capture Node.js performance on the 3 workload tiers
4. **Shim identification**: Document which modules need shims based on actual failures

During implementation:

1. TDD for each shim (red → green)
2. Compat test suite passes on Bun
3. CI matrix green
4. Benchmarks meet targets

---

## 10. References

- [Bun 1.4 Release](https://bun.com/blog/bun-v1.4) — Rust rewrite, Node.js 26.3.0 compat
- [Bun Node.js Compatibility Docs](https://bun.com/docs/runtime/nodejs-compat)
- [Next.js NEXT_RUNTIME source](https://github.com/vercel/next.js/tree/canary/packages/next/src/server)
- [Next.js config-shared.ts](https://github.com/vercel/next.js/tree/canary/packages/next/src/server/config-shared.ts)
