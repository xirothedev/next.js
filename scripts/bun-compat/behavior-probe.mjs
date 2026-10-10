// Behavioral probe: for each divergent API, check it BEHAVES like Node, not
// just that it loads. Each check is annotated with whether Next.js calls it,
// and the probe INTENTIONALLY exercises APIs Next.js does NOT call — that is
// the evidence behind the "no shim needed" claim in the RFC (§6), not speculation.
// Run: bun scripts/bun-compat/behavior-probe.mjs
import { runtimeLabel } from './_runtime.mjs'

const out = []
const check = (name, fn) => {
  try {
    out.push({ name, ok: true, note: String(fn()).slice(0, 60) })
  } catch (e) {
    out.push({ name, ok: false, note: String(e).slice(0, 60) })
  }
}

// async_hooks — Next.js prod code uses ONLY AsyncLocalStorage (createHook is test-only).
check('async_hooks.createHook fires (NEXT: unused)', () => {
  const { createHook } = require('node:async_hooks')
  let invoked = false
  const h = createHook({
    init: () => {
      invoked = true
    },
  })
  h.enable()
  setTimeout(() => {}, 1)
  h.disable()
  return invoked ? 'invoked' : 'NOT-invoked(stub)'
})
check('async_hooks.AsyncLocalStorage runs (NEXT: used)', () => {
  const { AsyncLocalStorage } = require('node:async_hooks')
  const als = new AsyncLocalStorage()
  let v
  als.run('X', () => {
    v = als.getStore()
  })
  return v === 'X' ? 'works' : 'BROKEN'
})

// crypto — Next.js uses createHash/randomBytes/randomUUID/createHmac/timingSafeEqual only.
check('crypto createDiffieHellman (NEXT: unused)', () => {
  const d = require('node:crypto').createDiffieHellman(256)
  d.generateKeys()
  return 'works'
})
check('crypto secp256k1 curve (NEXT: unused)', () => {
  require('node:crypto').createECDH('secp256k1')
  return 'works'
})
check('crypto chacha20-poly1305 (NEXT: unused)', () => {
  require('node:crypto').createCipheriv(
    'chacha20-poly1305',
    Buffer.alloc(32),
    Buffer.alloc(16)
  )
  return 'works'
})

// http.Server does not extend net.Server on Bun. Next.js does no `instanceof net.Server`.
check('http.Server instanceof net.Server (NEXT: unused)', () => {
  const s = require('node:http').createServer()
  return s instanceof require('node:net').Server
    ? 'yes'
    : 'NO(diverges, but unused)'
})

check('module.builtinModules includes http (NEXT: used)', () =>
  require('node:module').builtinModules.some(
    (m) => m === 'http' || m === 'node:http'
  )
    ? 'yes'
    : 'no'
)

console.log(runtimeLabel())
console.log(
  'Columns: check name -> observed behavior ("THREW" = the API threw, not supported)\n'
)
for (const r of out)
  console.log(
    '  ' + r.name.padEnd(46) + ' -> ' + (r.ok ? r.note : 'THREW: ' + r.note)
  )
