import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

async function evaluate(api, key, flag, profile) {
  const options = {
    headers: { 'X-Environment-Key': key },
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  }
  if (profile.identity) {
    options.method = 'POST'
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify({
      identifier: profile.identity,
      transient: true,
      traits: Object.entries(profile.traits ?? {}).map(([trait_key, trait_value]) => ({
        trait_key, trait_value, transient: true,
      })),
    })
  }
  const response = await fetch(new URL(profile.identity ? 'identities/' : 'flags/', api), options)
  if (!response.ok) throw new Error(`Flagsmith returned HTTP ${response.status}`)
  const payload = await response.json()
  const flags = profile.identity ? payload.flags : payload
  if (!Array.isArray(flags)) throw new Error('Flagsmith returned an invalid flag list')
  const result = flags.find(item => item.feature?.name === flag)
  if (!result) return null
  if (typeof result.enabled !== 'boolean' || !Object.hasOwn(result, 'feature_state_value')) {
    throw new Error('Flagsmith returned an invalid flag state')
  }
  return { enabled: result.enabled, value: result.feature_state_value }
}

export async function inspect(config, { demo = null } = {}) {
  const { flag, profiles } = config ?? {}
  if (typeof flag !== 'string' || !flag.trim() || !Array.isArray(profiles) ||
      profiles.length < 1 || profiles.length > 15) {
    throw new Error('Provide one flag and 1 to 15 synthetic profiles')
  }
  if (demo !== null && demo !== 'drift' && demo !== 'fixed') throw new Error('Unknown demo scenario')
  const baseline = demo ? 'demo-baseline' : process.env.FLAGSMITH_BASELINE_KEY
  const candidate = demo ? 'demo-candidate' : process.env.FLAGSMITH_CANDIDATE_KEY
  if (!baseline || !candidate) throw new Error('Set FLAGSMITH_BASELINE_KEY and FLAGSMITH_CANDIDATE_KEY')
  let api = null
  if (!demo) {
    api = new URL(process.env.FLAGSMITH_API_URL ?? 'https://api.flagsmith.com/api/v1/')
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)
    if ((api.protocol !== 'https:' && !(api.protocol === 'http:' && loopback)) ||
        api.username || api.password || api.search || api.hash) {
      throw new Error('Use an HTTPS Flags API URL, or HTTP on localhost, without credentials or a query')
    }
    if (!api.pathname.endsWith('/')) api.pathname += '/'
  }
  const names = new Set()
  for (const profile of profiles) {
    const { name, identity, traits, expected } = profile ?? {}
    if (typeof name !== 'string' || !name.trim() || names.has(name) ||
        (identity !== undefined && (typeof identity !== 'string' || !identity.trim())) ||
        (traits !== undefined && (!identity || !traits || typeof traits !== 'object' || Array.isArray(traits))) ||
        (expected !== 'unchanged' && (!expected || typeof expected.enabled !== 'boolean' ||
          !Object.hasOwn(expected, 'value'))) ||
        (traits && Object.values(traits).some(value => !['string', 'boolean', 'number'].includes(typeof value)))) {
      throw new Error('Each profile needs a unique name and a valid expectation. Traits require an identity.')
    }
    names.add(name)
  }
  const rows = []
  const offline = demo ? await import('./demo-flagsmith.mjs') : null
  for (const profile of profiles) {
    const { name, expected } = profile
    const [before, after] = offline ? await offline.demoStates(flag, profile, demo) : await Promise.all([
      evaluate(api, baseline, flag, profile),
      evaluate(api, candidate, flag, profile),
    ])
    const changed = !isDeepStrictEqual(before, after)
    let issue = null
    if (before === null || after === null) issue = 'Flag missing in at least one environment'
    else if (expected === 'unchanged' && changed) issue = 'Protected profile changed'
    else if (expected !== 'unchanged' &&
        (after.enabled !== expected.enabled || !isDeepStrictEqual(after.value, expected.value))) {
      issue = 'Candidate state differs from the release intent'
    }
    rows.push({ name, before, after, expected, issue })
  }
  const sameEnvironment = baseline === candidate
  const status = rows.some(row => row.issue) ? 'blocked' : sameEnvironment ? 'smoke test' : 'ready for review'
  const evidence = { api: api?.href ?? null, demo, flag, profiles, rows, status, sameEnvironment }
  const digest = createHash('sha256').update(JSON.stringify([baseline, candidate, evidence])).digest('hex')
  return { ...evidence, digest }
}

export function approvalRecord(report, digest, reviewer) {
  if (report.status !== 'ready for review' || report.digest !== digest) {
    throw new Error('Approval rejected. Review two distinct environments and use the latest matching digest.')
  }
  if (typeof reviewer !== 'string' || !reviewer.trim() || reviewer.length > 90) {
    throw new Error('Provide a reviewer name of 1 to 90 characters.')
  }
  return { ...report, reviewer: reviewer.trim(), approvedAt: new Date().toISOString() }
}

function display(report) {
  console.table(report.rows.map(({ name, before, after, issue }) => ({
    Profile: name,
    Baseline: before ? JSON.stringify(before) : 'missing',
    Candidate: after ? JSON.stringify(after) : 'missing',
    Result: issue ?? 'pass',
  })))
  console.log(`Status: ${report.status}`)
  console.log(`Review digest: ${report.digest}`)
  if (report.sameEnvironment) console.log('Both keys point to the same environment. Approval is unavailable.')
}

async function main() {
  const [command, path, approvalDigest, reviewer] = process.argv.slice(2)
  if (!path || !['scan', 'approve'].includes(command) ||
      (command === 'approve' && (!/^[a-f0-9]{64}$/.test(approvalDigest ?? '') || !reviewer?.trim()))) {
    throw new Error('Usage: node preflight.mjs scan <contract.json> | approve <contract.json> <digest> <reviewer>')
  }
  const report = await inspect(JSON.parse(await readFile(path, 'utf8')))
  display(report)
  if (report.status === 'blocked') {
    process.exitCode = 2
    return
  }
  if (command === 'scan') return
  const record = approvalRecord(report, approvalDigest, reviewer)
  const name = `approval-${report.digest.slice(0, 16)}.json`
  await writeFile(name, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(`Approval recorded in ${name}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

