// Shared runtime label so the three probes report identically.
export function runtimeLabel() {
  return process.versions.bun
    ? `Bun ${process.versions.bun}`
    : `Node ${process.versions.node}`
}
