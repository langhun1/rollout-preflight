const element = id => document.getElementById(id)
const query = ['mode','scenario','scenarioLabel','contractBox','contract','scan','feature','status','rows','evidence','reviewer','approve','approvalInfo','message']
const ui = Object.fromEntries(query.map(id => [id, element(id)]))
let report = null
let busy = false
let liveAvailable = false

function message(text, positive = false) {
  ui.message.textContent = text
  ui.message.dataset.tone = positive ? 'good' : 'warn'
}

function updateControls() {
  const demo = ui.mode.value === 'demo'
  ui.scenario.hidden = !demo
  ui.scenarioLabel.hidden = !demo
  ui.contractBox.hidden = demo
  ui.scan.disabled = busy || (!demo && !liveAvailable)
  ui.approve.disabled = busy || report?.status !== 'ready for review' || !ui.reviewer.value.trim()
  ui.mode.disabled = busy
  ui.scenario.disabled = busy
  ui.contract.disabled = busy
}

function describe(state) {
  if (!state) return 'Missing'
  return (state.enabled ? 'On' : 'Off') + (state.value == null ? '' : ` · ${typeof state.value === 'string' ? state.value : JSON.stringify(state.value)}`)
}

function render() {
  ui.rows.replaceChildren()
  ui.feature.textContent = report?.flag ?? 'Release impact'
  ui.status.textContent = {
    'blocked':'Blocked', 'ready for review':'Ready for review', 'smoke test':'Same-environment check',
  }[report?.status] ?? 'Waiting for scan'
  ui.status.dataset.tone = report?.status === 'blocked' ? 'warn' : report ? 'good' : ''
  ui.evidence.textContent = report
    ? `${report.demo ? 'Flagsmith SDK · Demo snapshots' : 'Flagsmith API'} · Review digest ${report.digest}`
    : 'Run preflight to load flag decisions.'
  ui.approvalInfo.textContent = report?.status === 'ready for review'
    ? 'Approval checks the current decisions again and downloads a record for your release review.'
    : 'Run a passing comparison of distinct environments to enable approval.'
  for (const row of report?.rows ?? []) {
    const tr = document.createElement('tr')
    const title = document.createElement('th')
    title.scope = 'row'
    title.textContent = row.name
    tr.append(title)
    for (const [text, style] of [[describe(row.before), 'state'], [describe(row.after), 'state'], [row.issue ?? 'Pass', row.issue ? 'warn' : 'ok']]) {
      const cell = document.createElement('td')
      cell.className = style
      cell.textContent = text
      tr.append(cell)
    }
    ui.rows.append(tr)
  }
  updateControls()
}

function reset() {
  report = null
  message(ui.mode.value === 'live' && !liveAvailable ? 'Start the dashboard with Flagsmith environment keys to enable live scans.' : '')
  render()
}

async function run(approve) {
  const body = { mode: ui.mode.value, scenario: ui.scenario.value }
  if (body.mode === 'live') {
    try { body.liveContract = JSON.parse(ui.contract.value) }
    catch { message('The release contract must be valid JSON.'); return }
  }
  if (approve) {
    body.digest = report?.digest
    body.reviewer = ui.reviewer.value
  } else {
    report = null
  }
  busy = true
  render()
  message(approve ? 'Verifying current decisions…' : 'Checking flag decisions…', true)
  try {
    const response = await fetch(approve ? '/api/approve' : '/api/scan', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)
    report = data.report
    message('')
    if (data.record) {
      const link = document.createElement('a')
      const url = URL.createObjectURL(new Blob([JSON.stringify(data.record, null, 2) + '\n'], {type:'application/json'}))
      link.href = url
      link.download = `${report.demo ? 'demo-' : ''}approval-${report.digest.slice(0,16)}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      message('Approval record downloaded.', true)
    }
  } catch (error) {
    if (approve) report = null
    message(error.message)
  } finally {
    busy = false
    render()
  }
}

for (const control of [ui.mode, ui.scenario, ui.contract]) control.addEventListener('input', reset)
ui.reviewer.addEventListener('input', updateControls)
ui.scan.addEventListener('click', () => run(false))
ui.approve.addEventListener('click', () => run(true))
try {
  const response = await fetch('/api/config')
  if (!response.ok) throw new Error('Unable to load dashboard settings.')
  const { live, example } = await response.json()
  liveAvailable = live
  ui.contract.value = JSON.stringify(example, null, 2)
  await run(false)
} catch (error) {
  message(error.message)
  updateControls()
}

