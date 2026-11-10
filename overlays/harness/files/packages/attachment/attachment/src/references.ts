/** Attachment discovery in first-party Session content, without interpreting arbitrary tool values. */

import { AttachmentId } from './brand.ts'
import type { FileAttachmentRef, ImageAttachmentRef, SessionAttachmentReference } from './types.ts'

/** A persisted or live Session event supplied by its owning Session reader. */
export interface AttachmentSessionEvent {
  readonly type: string
  readonly data: unknown
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function reference(kind: unknown, value: unknown): SessionAttachmentReference | undefined {
  const ref = record(value)
  if (ref === undefined || typeof ref['attachmentId'] !== 'string' || ref['attachmentId'].length === 0
    || !integer(ref['bytes'], 0)) return undefined
  const attachmentId = AttachmentId(ref['attachmentId'])
  if (kind === 'file' && typeof ref['name'] === 'string') {
    const file: FileAttachmentRef = { attachmentId, bytes: ref['bytes'], name: ref['name'] }
    return { kind, ref: file }
  }
  const mediaType = ref['mediaType']
  if (kind !== 'image' || (mediaType !== 'image/png' && mediaType !== 'image/jpeg'
    && mediaType !== 'image/webp' && mediaType !== 'image/gif')
    || !integer(ref['width'], 1) || !integer(ref['height'], 1)) return undefined
  const image: ImageAttachmentRef = {
    attachmentId, mediaType, bytes: ref['bytes'], width: ref['width'], height: ref['height'],
    ...(typeof ref['name'] === 'string' ? { name: ref['name'] } : {}),
  }
  const original = record(ref['originalDimensions'])
  if (original !== undefined && integer(original['width'], 1) && integer(original['height'], 1)) {
    image.originalDimensions = { width: original['width'], height: original['height'] }
  }
  return { kind, ref: image }
}

function contentReferences(content: unknown, result: SessionAttachmentReference[]): void {
  if (!Array.isArray(content)) return
  for (const value of content as readonly unknown[]) {
    const block = record(value)
    if (block === undefined) continue
    const found = reference(block['type'], block['attachment'])
    if (found !== undefined) result.push(found)
  }
}

/**
 * Enumerate only declared first-party content fields, including queued input and settled Assistant streams.
 * The caller must obtain events from a trusted Session reader; a request body is not ownership evidence.
 * Unknown event payloads and tool arguments are not searched for attachment identifiers.
 * @param events - authoritative live or persisted events, in any order.
 * @returns detached references, preserving occurrences and their original content order.
 */
export function sessionAttachmentReferences(events: readonly AttachmentSessionEvent[]): SessionAttachmentReference[] {
  const result: SessionAttachmentReference[] = []
  for (const event of events) {
    const data = record(event.data)
    if (data === undefined) continue
    switch (event.type) {
      case 'user/message':
      case 'tool/ptc-dispatch':
        contentReferences(data['content'], result)
        break
      case 'system/message':
      case 'developer/message':
      case 'tool/result':
      case 'team/message/queued':
        contentReferences(record(data['message'])?.['content'], result)
        break
      case 'agent/inbox/spliced': {
        const inserted = data['inserted']
        if (Array.isArray(inserted)) {
          for (const message of inserted as readonly unknown[]) {
            contentReferences(record(message)?.['content'], result)
          }
        }
        break
      }
      case 'compaction/summary':
        contentReferences(data['summary'], result)
        contentReferences(data['rawOutput'], result)
        break
      case 'assistant/message':
      case 'assistant/attempt': {
        if (event.type === 'assistant/message') contentReferences(record(data['message'])?.['content'], result)
        const stream = data['stream']
        if (!Array.isArray(stream)) break
        // Compact streams keep block-end chunks verbatim; delta runs contain no attachments.
        for (const entry of stream as readonly unknown[]) {
          const packed = record(entry)
          if (packed?.['type'] !== 'chunk') continue
          const chunk = record(packed['chunk'])
          if (chunk?.['type'] === 'block-end') contentReferences([chunk['block']], result)
        }
        break
      }
      default:
        // Session event types are merge-extensible; their arbitrary payloads grant no file authority.
        break
    }
  }
  return result
}
