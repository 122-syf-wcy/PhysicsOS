const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
const PLACEHOLDER_RE = /(?:placeholder|dummy|fake|todo|replace|unsigned|example)/i
const PLATFORM_NAMES = new Set([
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'linux-x86_64',
])
const UNSIGNED_ENV_PREFIXES = [
  'TAURI_SIGNING_',
  'APPLE_CERTIFICATE',
  'APPLE_API_',
  'APPLE_ID',
  'APPLE_PASSWORD',
  'APPLE_TEAM_ID',
  'WINDOWS_CERTIFICATE',
  'WINDOWS_SIGN_',
]

function parseVersion(value) {
  if (typeof value !== 'string') throw new TypeError('Version must be a string.')
  const match = VERSION_RE.exec(value)
  if (match === null) throw new TypeError(`Invalid semantic version: ${value}`)
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  }
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNumber = /^\d+$/.test(a) ? Number(a) : null
    const bNumber = /^\d+$/.test(b) ? Number(b) : null
    if (aNumber !== null && bNumber !== null) return aNumber < bNumber ? -1 : 1
    if (aNumber !== null) return -1
    if (bNumber !== null) return 1
    return a < b ? -1 : 1
  }
  return 0
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = a.numbers[index] - b.numbers[index]
    if (difference !== 0) return difference
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

export function platformKey(platform = process.platform, architecture = process.arch) {
  if (platform === 'darwin' && architecture === 'arm64') return 'darwin-aarch64'
  if (platform === 'darwin' && architecture === 'x64') return 'darwin-x86_64'
  if (platform === 'win32' && architecture === 'x64') return 'windows-x86_64'
  if (platform === 'linux' && architecture === 'x64') return 'linux-x86_64'
  throw new Error(`No Tauri update target for ${platform}/${architecture}.`)
}

function assertSignature(signature) {
  const value = typeof signature === 'string' ? signature.trim() : ''
  if (value.length < 40 || PLACEHOLDER_RE.test(value) || new Set(value).size < 8) {
    throw new Error('Update artifact signature is missing, placeholder-like, or malformed.')
  }
}

function parseManifest(value) {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('latest.json must be an object.')
  }
  parseVersion(value.version)
  if (typeof value.pub_date !== 'string' || Number.isNaN(Date.parse(value.pub_date))) {
    throw new TypeError('latest.json pub_date must be an ISO date-time.')
  }
  if (typeof value.platforms !== 'object' || value.platforms === null) {
    throw new TypeError('latest.json platforms must be an object.')
  }
  for (const [platform, artifact] of Object.entries(value.platforms)) {
    if (!PLATFORM_NAMES.has(platform)) throw new TypeError(`Unknown update platform: ${platform}`)
    if (typeof artifact !== 'object' || artifact === null) {
      throw new TypeError(`Update artifact for ${platform} must be an object.`)
    }
    assertSignature(artifact.signature)
    let url
    try {
      url = new URL(artifact.url)
    } catch {
      throw new TypeError(`Update artifact URL for ${platform} is invalid.`)
    }
    if (url.protocol !== 'https:') {
      throw new Error(`Update artifact for ${platform} must use HTTPS.`)
    }
  }
  return value
}

export function selectUpdate(manifestValue, platform, currentVersion) {
  const manifest = parseManifest(manifestValue)
  if (compareVersions(manifest.version, currentVersion) <= 0) return null
  const artifact = manifest.platforms[platform]
  if (artifact === undefined) return null
  return {
    version: manifest.version,
    ...(manifest.notes === undefined ? {} : { notes: manifest.notes }),
    publishedAt: manifest.pub_date,
    url: artifact.url,
    signature: artifact.signature,
  }
}

export function validateReleaseConfig(config) {
  if (typeof config !== 'object' || config === null) {
    throw new TypeError('Tauri release config must be an object.')
  }
  parseVersion(config.version)
  if (config.bundle?.createUpdaterArtifacts !== true) {
    throw new Error('Tauri updater must create signed updater artifacts.')
  }
  const updater = config.plugins?.updater
  if (typeof updater !== 'object' || updater === null) {
    throw new Error('Tauri updater configuration is missing.')
  }
  const pubkey = typeof updater.pubkey === 'string' ? updater.pubkey.trim() : ''
  if (pubkey.length < 40 || PLACEHOLDER_RE.test(pubkey)) {
    throw new Error('Tauri updater configuration has no real public key.')
  }
  if (!Array.isArray(updater.endpoints) || updater.endpoints.length === 0) {
    throw new Error('Tauri updater configuration has no endpoint.')
  }
  for (const endpoint of updater.endpoints) {
    let url
    try {
      url = new URL(endpoint)
    } catch {
      throw new Error('Tauri updater endpoint is not an absolute URL.')
    }
    if (url.protocol !== 'https:' || !url.pathname.endsWith('/physicsos/update/latest.json')) {
      throw new Error(
        'Tauri updater endpoint must target update-host /physicsos/update/latest.json over HTTPS.',
      )
    }
  }
  return config
}

export function localUnsignedEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !UNSIGNED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  )
}
