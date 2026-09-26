#!/usr/bin/env node
/**
 * Print the events of a Harness session log (`session.jsonl.zstd`, one zstd
 * frame per append) as `type :: data` lines, truncating long payloads.
 *
 *   node tests/agent/dump-session-log.mjs <path/to/session.jsonl.zstd> [maxChars]
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { zstdDecompressSync } from 'node:zlib'

const [file, maxArg] = process.argv.slice(2)
if (file === undefined) {
  console.error('usage: dump-session-log.mjs <session.jsonl.zstd> [maxChars]')
  process.exit(2)
}
const maxChars = Number(maxArg ?? 1400)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

const buffer = readFileSync(file)
const frameStarts = []
for (let offset = buffer.indexOf(MAGIC); offset >= 0; offset = buffer.indexOf(MAGIC, offset + 4)) {
  frameStarts.push(offset)
}
let text = ''
for (let index = 0; index < frameStarts.length; index += 1) {
  const start = frameStarts[index]
  const end = index + 1 < frameStarts.length ? frameStarts[index + 1] : buffer.length
  try {
    text += zstdDecompressSync(buffer.subarray(start, end)).toString('utf8')
  } catch (error) {
    console.error(
      `frame ${index} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
for (const line of text.split(/\r?\n/)) {
  if (line.trim().length === 0) continue
  let event
  try {
    event = JSON.parse(line)
  } catch {
    continue
  }
  const data = JSON.stringify(event.data ?? event)
  console.log(`${event.type} :: ${data.length > maxChars ? `${data.slice(0, maxChars)} …` : data}`)
}
