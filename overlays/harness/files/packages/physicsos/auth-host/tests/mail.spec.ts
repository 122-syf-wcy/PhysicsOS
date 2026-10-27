/**
 * Mail composer specs — the MIME shapes and escaping that a broken message
 * would only reveal in a real client (a missing boundary, an unencoded CJK
 * subject, an HTML body whose text was read as markup).
 */

import { describe, expect, it } from 'vitest'
import {
  buildMessage, createAccountNotifier, readMailConfig,
  type MailConfig, type MailMessage,
} from '../src/mail.ts'

const config: MailConfig = {
  host: 'smtp.qq.com',
  port: 465,
  user: 'bot@qq.com',
  password: 'app-password',
  fromName: 'PhysicsOS',
  siteUrl: 'https://physics.dongsiwei.com',
}

/** Decode the base64 payload of one MIME part (single-part or inside a boundary). */
const decodePart = (message: string, marker: string): string => {
  const start = message.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const bodyStart = message.indexOf('\r\n\r\n', start) + 4
  const nextBoundary = message.indexOf('\r\n--', bodyStart)
  /* A single-part message has no following boundary; `indexOf` would return -1
     and slicing to it would drop the final character of the payload. */
  const bodyEnd = nextBoundary === -1 ? message.length : nextBoundary
  const encoded = message.slice(bodyStart, bodyEnd).replaceAll('\r\n', '')
  return Buffer.from(encoded, 'base64').toString('utf8')
}

describe('mail composer', () => {
  it('builds a single-part text message when no HTML is supplied', () => {
    const message: MailMessage = { to: 'a@b.com', subject: '测试', text: '正文' }
    const built = buildMessage(config, message)
    expect(built).toContain('Content-Type: text/plain; charset=UTF-8')
    expect(built).not.toContain('multipart/alternative')
    expect(decodePart(built, 'Content-Type: text/plain')).toBe('正文')
  })

  it('builds multipart/alternative with text first so a text reader stops early', () => {
    const message: MailMessage = {
      to: 'a@b.com', subject: '测试', text: '纯文本正文', html: '<p>富文本正文</p>',
    }
    const built = buildMessage(config, message)
    const boundary = /boundary="([^"]+)"/.exec(built)?.[1]
    expect(boundary).toBeTruthy()
    expect(built).toContain('Content-Type: multipart/alternative')

    const textAt = built.indexOf('Content-Type: text/plain')
    const htmlAt = built.indexOf('Content-Type: text/html')
    expect(textAt).toBeGreaterThan(-1)
    expect(htmlAt).toBeGreaterThan(textAt)

    expect(decodePart(built, 'Content-Type: text/plain')).toBe('纯文本正文')
    expect(decodePart(built, 'Content-Type: text/html')).toBe('<p>富文本正文</p>')
    /* Both parts must be closed, or a client hangs on a truncated message. */
    expect(built.trimEnd().endsWith(`--${boundary}--`)).toBe(true)
  })

  it('encodes a CJK subject instead of sending raw UTF-8 bytes in a header', () => {
    const built = buildMessage(config, { to: 'a@b.com', subject: '账号审核通过', text: 'x' })
    const subjectLine = /^Subject: (.*)$/m.exec(built)?.[1] ?? ''
    expect(subjectLine).toMatch(/^=\?UTF-8\?B\?/)
    const encoded = subjectLine.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, '')
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('账号审核通过')
  })

  it('formats the From mailbox with the configured display name', () => {
    const built = buildMessage(config, { to: 'a@b.com', subject: 's', text: 'x' })
    expect(built).toMatch(/^From: "PhysicsOS" <bot@qq\.com>$/m)
    expect(built).toMatch(/^To: <a@b\.com>$/m)
  })
})

describe('mail configuration', () => {
  it('is absent until both the account and the app password are set', () => {
    expect(readMailConfig({})).toBeUndefined()
    expect(readMailConfig({ PHYSICSOS_SMTP_USER: 'bot@qq.com' })).toBeUndefined()
    expect(readMailConfig({ PHYSICSOS_SMTP_PASSWORD: 'pw' })).toBeUndefined()
  })

  it('defaults to QQ Mail submission and reads the public URL for links', () => {
    const parsed = readMailConfig({
      PHYSICSOS_SMTP_USER: 'bot@qq.com',
      PHYSICSOS_SMTP_PASSWORD: 'pw',
      PHYSICSOS_PUBLIC_URL: 'https://example.test/',
    })
    expect(parsed).toMatchObject({
      host: 'smtp.qq.com',
      port: 465,
      user: 'bot@qq.com',
      siteUrl: 'https://example.test/',
    })
  })

  it('exposes a notifier only once the mailbox resolves', () => {
    expect(createAccountNotifier({})).toBeUndefined()
    expect(createAccountNotifier({
      PHYSICSOS_SMTP_USER: 'bot@qq.com',
      PHYSICSOS_SMTP_PASSWORD: 'pw',
    })?.kind).toBe('smtp:smtp.qq.com:465')
  })
})
