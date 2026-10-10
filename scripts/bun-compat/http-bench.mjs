// Runtime throughput baseline: a minimal node:http JSON echo server, 20k reqs
// at concurrency 50, requested from itself. Run under BOTH runtimes to compare:
//   node scripts/bun-compat/http-bench.mjs
//   bun  scripts/bun-compat/http-bench.mjs
// This isolates the runtime's node:http stack; it is NOT an end-to-end `next start`.
import http from 'node:http'
import { runtimeLabel } from './_runtime.mjs'

const N = 20000
const CONC = 50
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      hello: 'world',
      runtime: process.versions.bun ? 'bun' : 'node',
    })
  )
})

server.listen(0, async () => {
  const port = server.address().port
  const t0 = Date.now()
  let done = 0
  await new Promise((resolve) => {
    for (let c = 0; c < CONC; c++) {
      const worker = () => {
        if (done++ >= N) {
          if (done >= N) resolve()
          return
        }
        const req = http.request({ port, path: '/', method: 'GET' }, (r) => {
          r.resume()
          r.on('end', worker)
        })
        req.on('error', () => worker())
        req.end()
      }
      worker()
    }
  })
  const ms = Date.now() - t0
  console.log(
    `${runtimeLabel()}: ${N} req in ${ms}ms -> ${Math.round((N / ms) * 1000).toLocaleString()} req/s`
  )
  server.close()
  process.exit(0)
})
