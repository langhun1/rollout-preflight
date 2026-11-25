import { fileURLToPath } from 'node:url'
import { Flagsmith, LocalFileHandler } from 'flagsmith-nodejs'

const clients = Object.fromEntries(['baseline', 'drift', 'fixed'].map(name => {
  const snapshot = fileURLToPath(new URL(`./demo-environments/${name}.json`, import.meta.url))
  return [name, new Flagsmith({
    offlineMode: true,
    offlineHandler: new LocalFileHandler(snapshot),
  })]
}))

export async function demoStates(flag, profile, candidate) {
  return Promise.all([clients.baseline, clients[candidate]].map(async client => {
    const flags = profile.identity
      ? await client.getIdentityFlags(profile.identity, profile.traits)
      : await client.getEnvironmentFlags()
    const { enabled, value, isDefault } = flags.getFlag(flag)
    return isDefault ? null : { enabled, value }
  }))
}
