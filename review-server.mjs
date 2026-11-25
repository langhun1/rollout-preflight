import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { approvalRecord, inspect } from './preflight.mjs'

const host = '127.0.0.1'
const port = Number(process.env.PREFLIGHT_PORT ?? 4337)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PREFLIGHT_PORT')
const origin = `http://${host}:${port}`
const contract = {
  flag: 'checkout_express',
  profiles: [
    { name: 'Anonymous visitors', expected: 'unchanged' },
    { name: 'Trial customers', identity: 'demo-trial', traits: { plan: 'trial' }, expected: { enabled: true, value: 'express' } },
    { name: 'Returning subscribers', identity: 'demo-subscriber', traits: { plan: 'subscriber' }, expected: 'unchanged' },
  ],
}
const html = await readFile(new URL('./review.html', import.meta.url))
const script = await readFile(new URL('./review.mjs', import.meta.url))
const example = JSON.parse(await readFile(new URL('./example.json', import.meta.url), 'utf8'))

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(data))
  }
  if (req.headers.host !== `${host}:${port}`) return json(403, {error:'Open the local dashboard URL.'})
  if (req.method === 'GET' && (req.url === '/' || req.url === '/review.mjs')) {
    const page = req.url === '/'
    res.writeHead(200, { 'Content-Type': page ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' })
    return res.end(page ? html : script)
  }
  if (req.method === 'GET' && req.url === '/api/config') {
    return json(200, { example, live: Boolean(process.env.FLAGSMITH_BASELINE_KEY && process.env.FLAGSMITH_CANDIDATE_KEY) })
  }
  if (req.method !== 'POST' || !['/api/scan', '/api/approve'].includes(req.url)) return json(404, {error:'Route not found.'})
  if (req.headers.origin !== origin || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
    return json(403, {error:'Submit from the local dashboard.'})
  }
  try {
    let body = ''
    req.setEncoding('utf8')
    for await (const chunk of req) {
      body += chunk
      if (Buffer.byteLength(body) > 24_576) return json(413, {error:'Contract is too large.'})
    }
    const { mode, scenario, liveContract, digest, reviewer } = JSON.parse(body)
    if (mode !== 'demo' && mode !== 'live') throw new Error('Choose a data source.')
    const report = mode === 'demo'
      ? await inspect(contract, { demo: scenario === 'fixed' ? 'fixed' : 'drift' })
      : await inspect(liveContract)
    const record = req.url === '/api/approve' ? approvalRecord(report, digest, reviewer) : null
    json(200, { report, record })
  } catch (error) {
    if (!res.destroyed) json(400, { error: error.message === 'fetch failed' ? 'Flagsmith could not be reached.' : error.message })
  }
})
server.listen(port, host, () => console.log(`Rollout Preflight is listening at ${origin}`))

