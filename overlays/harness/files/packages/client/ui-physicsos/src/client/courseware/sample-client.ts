/** The original lesson is a lazy text/plain asset, never HTML in the application origin or JS bundle. */
export const SOUND_PROPERTIES_SAMPLE = Object.freeze({
  path: '/physicsos/teaching-samples/sound-properties-c-v1.txt',
  bytes: 3_317_789,
  sha256: '9ab882e3643fc669d04138388b590f492151ca48c1022b61dc68627acb92403e',
  title: '声音的特性 · 山水之间',
  description: '31 页完整课堂。贵州文化灵感情境、声学互动模型与按页课堂批注；原始来源和许可保留在课件中。',
})

export async function loadSoundPropertiesSample(options: {
  readonly signal: AbortSignal
  readonly fetch?: typeof fetch
  readonly digest?: (bytes: Uint8Array) => Promise<string>
}): Promise<Blob> {
  const response = await (options.fetch ?? fetch)(SOUND_PROPERTIES_SAMPLE.path, {
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal: options.signal,
  })
  options.signal.throwIfAborted()
  if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'text/plain' || !response.body) {
    throw new Error('课件示例未以安全纯文本返回；未导入或执行。')
  }
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > SOUND_PROPERTIES_SAMPLE.bytes)) throw new Error('课件示例长度异常，未导入。')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      options.signal.throwIfAborted()
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > SOUND_PROPERTIES_SAMPLE.bytes) throw new Error('课件示例超过固定长度，未截断导入。')
      chunks.push(item.value)
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  options.signal.throwIfAborted()
  if (size !== SOUND_PROPERTIES_SAMPLE.bytes) throw new Error('课件示例不完整，请重试。')
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const checksum = options.digest ? await options.digest(bytes) : [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  options.signal.throwIfAborted()
  if (checksum !== SOUND_PROPERTIES_SAMPLE.sha256) throw new Error('课件示例摘要不匹配，未导入。')
  return new Blob([bytes], { type: 'text/html;charset=utf-8' })
}
