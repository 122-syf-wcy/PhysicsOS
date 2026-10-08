/** Create a deterministic test process environment with no production provider/storage settings. */
export function isolatedHarnessEnvironment(input, home, modelUrl, adminPassword) {
  const url = new URL(modelUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Acceptance model must be an HTTP loopback endpoint')
  }
  const env = Object.fromEntries(
    Object.entries(input).filter(
      ([name]) =>
        !/^(PHYSICSOS_|PHYSICOS_|DSH_|DEEPSEEK_|OPENAI_|ANTHROPIC_|DATABASE_URL|REDIS_URL)/.test(
          name,
        ) && !/(?:API_KEY|API_TOKEN|CREDENTIALS)(?:_FILE)?$/.test(name),
    ),
  )
  return {
    ...env,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    PHYSICSOS_ADMIN_PASSWORD: adminPassword,
    PHYSICSOS_STORAGE_BACKEND: 'json',
    PHYSICSOS_SHARED_STATE_BACKEND: 'memory',
    PHYSICSOS_REGISTRATION_MODE: 'open',
    DEEPSEEK_API_KEY: 'physicsos-acceptance-key',
    DEEPSEEK_BASE_URL: modelUrl,
    PHYSICSOS_MODEL_FALLBACK_BASE_URL: modelUrl,
    PHYSICSOS_MODEL_FALLBACK_API_KEY: 'physicsos-acceptance-key',
    PHYSICSOS_MODEL_POOL_PORT: '0',
  }
}
