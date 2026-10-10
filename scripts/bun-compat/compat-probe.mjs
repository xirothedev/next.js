// Loadability probe: for each node: module the Next.js SERVER imports, verify
// it loads on the current runtime, and that every symbol Next.js actually
// imports/calls from it is present on the module namespace.
//
// The module set is derived from the source, not guessed (re-run to refresh):
//   grep -rhoE "['\"]node:[a-z0-9/._]+" packages/next/src/server \
//     | grep -oE "node:[a-z0-9/._]+" | sort -u   # 26; drop node:internal/* (comment-only)
// Symbols per module are the ones Next.js references (grep the specifier).
// Run: bun scripts/bun-compat/compat-probe.mjs
import { runtimeLabel } from './_runtime.mjs'

const probes = {
  'node:assert': ['ok', 'strictEqual', 'deepStrictEqual'],
  'node:async_hooks': ['AsyncLocalStorage', 'AsyncResource'],
  'node:buffer': ['Buffer', 'atob', 'btoa'],
  'node:child_process': ['spawn', 'exec', 'execSync', 'fork'], // build/tooling + server tests
  'node:crypto': [
    'createHash',
    'randomBytes',
    'timingSafeEqual',
    'createHmac',
    'randomUUID',
    'pbkdf2',
    'scryptSync',
  ],
  'node:events': ['EventEmitter', 'on', 'once', 'listenerCount'],
  'node:fs': [
    'readFileSync',
    'existsSync',
    'writeFileSync',
    'statSync',
    'readdirSync',
    'rmSync',
    'promises',
  ],
  'node:fs/promises': [
    'readFile',
    'writeFile',
    'mkdir',
    'stat',
    'readdir',
    'rm',
  ],
  'node:http': [
    'createServer',
    'IncomingMessage',
    'ServerResponse',
    'get',
    'METHODS',
  ],
  'node:inspector': ['Session', 'open', 'url'],
  'node:module': ['createRequire', 'builtinModules'],
  'node:net': ['Socket', 'Server', 'createServer', 'isIP'], // build/tooling + server tests
  'node:path': ['join', 'resolve', 'dirname', 'relative', 'sep'],
  'node:querystring': ['parse', 'stringify', 'escape', 'unescape'],
  'node:stream': [
    'Readable',
    'Writable',
    'PassThrough',
    'Transform',
    'pipeline',
    'Duplex',
  ],
  'node:stream/promises': ['pipeline', 'finished'], // action-handler.ts uses pipeline
  'node:timers': ['setTimeout', 'setImmediate', 'setInterval'],
  'node:timers/promises': ['setTimeout', 'setImmediate', 'scheduler'], // fast-set-immediate patches setImmediate
  'node:url': [
    'URL',
    'URLSearchParams',
    'fileURLToPath',
    'pathToFileURL',
    'parse',
    'format',
  ],
  'node:util': ['types', 'promisify', 'inspect', 'styleText'],
  'node:vm': ['createContext', 'runInContext', 'Script', 'compileFunction'], // server tests / sandbox
  'node:worker_threads': [
    'Worker',
    'isMainThread',
    'threadId',
    'MessageChannel',
  ], // build + server tests
  'node:zlib': [
    'createGzip',
    'createBrotliCompress',
    'gunzip',
    'brotliDecompress',
  ],
}

const results = []
for (const [mod, apis] of Object.entries(probes)) {
  try {
    const ns = await import(mod)
    const missing = []
    const viaDefault = []
    for (const a of apis) {
      if (ns[a] !== undefined) continue
      // Distinguish, don't mask: a symbol only on `.default` is a weaker signal.
      if (ns.default?.[a] !== undefined) viaDefault.push(a)
      else missing.push(a)
    }
    results.push({
      mod,
      missing,
      viaDefault,
      status: missing.length ? 'partial' : 'ok',
    })
  } catch (e) {
    results.push({
      mod,
      status: 'fail',
      missing: ['IMPORT'],
      viaDefault: [],
      err: String(e).slice(0, 80),
    })
  }
}

const ok = results.filter((r) => r.status === 'ok')
const partial = results.filter((r) => r.status === 'partial')
const fail = results.filter((r) => r.status === 'fail')
console.log(`\nRuntime: ${runtimeLabel()}`)
console.log(
  `Modules: ${ok.length} ok / ${partial.length} partial / ${fail.length} fail (of ${results.length})\n`
)
for (const r of partial)
  console.log(`PARTIAL ${r.mod}: missing ${r.missing.join(', ')}`)
for (const r of fail) console.log(`FAIL    ${r.mod}: ${r.err}`)
for (const r of ok)
  if (r.viaDefault.length)
    console.log(
      `NOTE    ${r.mod}: only on .default (weaker): ${r.viaDefault.join(', ')}`
    )
if (!partial.length && !fail.length)
  console.log('All modules load with every imported/called symbol present.')
