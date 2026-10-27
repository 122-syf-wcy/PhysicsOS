/**
 * Minimal SMTP submission client — just enough to mail an account decision.
 *
 * Why not a library: the deployment host reaches the npm registry over a ~1.2MB/s
 * uplink, so every added dependency costs an image rebuild that can fail. The
 * whole surface needed here is "connect on 465, AUTH LOGIN, one UTF-8 message",
 * which is ~150 lines over `node:tls` and has no transitive tree.
 *
 * Deliberately not a general mailer: no attachments, no multiplexing, no retry
 * queue, plain-text body only. A failure is reported to the caller, which stores
 * it on the pending-registration row so an operator can see the account was
 * activated even though the notification did not go out.
 */

import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import { randomUUID } from 'node:crypto'

/** SMTP submission settings for the platform mailbox. */
export interface MailConfig {
  readonly host: string
  readonly port: number
  readonly user: string
  /** QQ Mail calls this an 授权码 (an app password), not the account password. */
  readonly password: string
  /** Display name on the From header; the address always comes from `user`. */
  readonly fromName: string
  /** Public site URL, linked from the message body. */
  readonly siteUrl: string
}

/** One outbound message. */
export interface MailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
}

const CRLF = '\r\n'
const MAX_LINE = 76

/**
 * Resolve mail settings from the environment, or `undefined` when the
 * deployment has not configured a mailbox.
 *
 * Treating "not configured" as a normal state matters: the auth domain must
 * keep working on a deployment that has not set up mail yet, and the approval
 * path then records "no mail transport" instead of failing the approval.
 * @param env - process environment (injected so tests need no globals).
 * @returns the settings, or undefined when incomplete.
 */
export function readMailConfig(env: NodeJS.ProcessEnv): MailConfig | undefined {
  const user = env.PHYSICSOS_SMTP_USER?.trim() ?? ''
  const password = env.PHYSICSOS_SMTP_PASSWORD?.trim() ?? ''
  if (user === '' || password === '') return undefined
  const port = Number.parseInt(env.PHYSICSOS_SMTP_PORT ?? '465', 10)
  return {
    host: env.PHYSICSOS_SMTP_HOST?.trim() || 'smtp.qq.com',
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : 465,
    user,
    password,
    fromName: env.PHYSICSOS_SMTP_FROM_NAME?.trim() || 'PhysicsOS',
    siteUrl: env.PHYSICSOS_PUBLIC_URL?.trim() || 'https://physics.dongsiwei.com',
  }
}

/** RFC 2047 base64 "encoded-word" for a UTF-8 header value. */
const encodeHeaderValue = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`

/** RFC 5322 mailbox with an encoded display name. */
const formatMailbox = (name: string, address: string): string =>
  `"${encodeHeaderValue(name)}" <${address}>`

/**
 * Base64-encode a body with CRLF line endings and 76-char wrapping.
 * @param value - the raw text.
 * @returns the transfer-encoded payload.
 */
const base64Body = (value: string): string => {
  const normalized = value.replaceAll(/\r?\n/g, CRLF)
  const encoded = Buffer.from(normalized, 'utf8').toString('base64')
  const chunks: string[] = []
  for (let index = 0; index < encoded.length; index += MAX_LINE) {
    chunks.push(encoded.slice(index, index + MAX_LINE))
  }
  return chunks.join(CRLF)
}

/**
 * Build the DATA payload for one message.
 *
 * `Content-Transfer-Encoding: base64` with a UTF-8 body keeps CJK subjects and
 * bodies intact without needing a MIME multipart tree.
 * @param config - mailbox settings.
 * @param message - recipient, subject, body.
 * @returns the header block plus encoded body, CRLF-joined.
 */
export function buildMessage(config: MailConfig, message: MailMessage): string {
  const date = new Date().toUTCString().replace('GMT', '+0000')
  return [
    `From: ${formatMailbox(config.fromName, config.user)}`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${date}`,
    `Message-ID: <${randomUUID()}@${config.user.split('@')[1] ?? 'physicsos'}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(message.text),
  ].join(CRLF)
}

/** One SMTP reply, code plus (possibly multi-line) text. */
interface SmtpReply {
  readonly code: number
  readonly lines: readonly string[]
}

/**
 * A single-use SMTP session.
 *
 * Reads replies line by line (multi-line replies end on `code<space>`), so a
 * greylisting banner or a multi-line AUTH failure cannot desynchronize it.
 */
class SmtpSession {
  private buffer = ''
  private pending: { resolve: (reply: SmtpReply) => void; reject: (error: Error) => void } | undefined

  constructor(private readonly socket: TLSSocket) {
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { this.onData(chunk) })
    socket.on('error', (error: Error) => { this.pending?.reject(error); this.pending = undefined })
    socket.on('close', () => {
      this.pending?.reject(new Error('smtp connection closed'))
      this.pending = undefined
    })
  }

  private accumulated: string[] = []

  private onData(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const index = this.buffer.indexOf(CRLF)
      if (index < 0) return
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + CRLF.length)
      const match = /^(\d{3})([ -])(.*)$/.exec(line)
      if (match === null) continue
      this.accumulated.push(match[3] ?? '')
      /* A hyphen after the code means "more lines follow"; a space ends it. */
      if (match[2] !== '-') {
        const reply: SmtpReply = { code: Number(match[1]), lines: [...this.accumulated] }
        this.accumulated = []
        const waiter = this.pending
        this.pending = undefined
        waiter?.resolve(reply)
      }
    }
  }

  /**
   * Await the next reply.
   * @returns the parsed reply.
   */
  next(): Promise<SmtpReply> {
    if (this.pending !== undefined) throw new Error('smtp reply already awaited')
    return new Promise<SmtpReply>((resolve, reject) => {
      this.pending = { resolve, reject }
    })
  }

  /**
   * Send one command and await its reply.
   * @param line - command text without CRLF (omit to just await a reply).
   * @returns the parsed reply.
   */
  async command(line?: string): Promise<SmtpReply> {
    if (line !== undefined) this.socket.write(`${line}${CRLF}`)
    return this.next()
  }

  /** Politely close the session; failures are ignored by design. */
  async quit(): Promise<void> {
    try {
      await this.command('QUIT')
    } catch {
      /* The message is already accepted at this point; QUIT is a courtesy. */
    } finally {
      this.socket.destroy()
    }
  }
}

/** Wrap a value as an SMTP `AUTH LOGIN` base64 credential. */
const b64 = (value: string): string => Buffer.from(value, 'utf8').toString('base64')

/**
 * Deliver one message over implicit TLS (SMTPS, port 465 — QQ Mail's
 * submission port; the STARTTLS variant on 587 is not offered there).
 * @param config - mailbox settings.
 * @param message - recipient, subject, body.
 * @param timeoutMs - hard deadline for the whole exchange.
 * @returns resolves once the server accepts the DATA payload.
 */
export async function sendMail(
  config: MailConfig,
  message: MailMessage,
  timeoutMs = 20_000,
): Promise<void> {
  const socket = tlsConnect({ host: config.host, port: config.port, servername: config.host })
  const session = new SmtpSession(socket)
  const timer = setTimeout(() => {
    socket.destroy(new Error(`smtp timeout after ${timeoutMs}ms`))
  }, timeoutMs)

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', resolve)
      socket.once('error', reject)
    })

    const greet = await session.command()
    if (greet.code !== 220) throw new Error(`smtp greeting ${greet.code}`)

    const ehlo = await session.command('EHLO physicsos.local')
    if (ehlo.code !== 250) throw new Error(`smtp EHLO ${ehlo.code}`)

    /* QQ Mail advertises AUTH PLAIN and LOGIN; LOGIN is the portable pair. */
    const userReply = await session.command('AUTH LOGIN')
    if (userReply.code !== 334) throw new Error(`smtp AUTH LOGIN ${userReply.code}`)
    const userStep = await session.command(b64(config.user))
    if (userStep.code !== 334) throw new Error(`smtp AUTH user ${userStep.code}`)
    const passStep = await session.command(b64(config.password))
    if (passStep.code !== 235) {
      throw new Error(`smtp AUTH rejected (${passStep.code}): check the 授权码`)
    }

    const mailFrom = await session.command(`MAIL FROM:<${config.user}>`)
    if (mailFrom.code !== 250) throw new Error(`smtp MAIL FROM ${mailFrom.code}`)

    const rcpt = await session.command(`RCPT TO:<${message.to}>`)
    if (rcpt.code !== 250 && rcpt.code !== 251) throw new Error(`smtp RCPT TO ${rcpt.code}`)

    const data = await session.command('DATA')
    if (data.code !== 354) throw new Error(`smtp DATA ${data.code}`)

    /* A line consisting of a single dot would end the payload early. */
    const payload = buildMessage(config, message).replaceAll(`${CRLF}.`, `${CRLF}..`)
    const accepted = await session.command(`${payload}${CRLF}.`)
    if (accepted.code !== 250) throw new Error(`smtp message rejected ${accepted.code}`)

    await session.quit()
  } finally {
    clearTimeout(timer)
    socket.destroy()
  }
}

/**
 * The account-decision notification the auth service asks for.
 *
 * Kept as a narrow seam rather than "send arbitrary mail": the service has
 * exactly one thing to say, and a typed payload is what keeps the template
 * (and its CJK copy) in one place instead of at the call site.
 */
export interface ApprovedNotice {
  readonly to: string
  readonly username: string
  readonly displayName: string
  readonly schoolName: string
}

/** Outbound account notifications, when a mailbox is configured. */
export interface AccountNotifier {
  readonly kind: string
  notifyApproved(notice: ApprovedNotice): Promise<void>
}

/**
 * Compose the approval message body.
 * @param config - mailbox settings (for the site link).
 * @param notice - who to address and which school they joined.
 * @returns subject and plain-text body.
 */
const approvedMessage = (
  config: MailConfig,
  notice: ApprovedNotice,
): Pick<MailMessage, 'subject' | 'text'> => ({
  subject: `PhysicsOS 账号已通过审核：${notice.schoolName}`,
  text: [
    `${notice.displayName} 同学，你好：`,
    '',
    `你申请的学校「${notice.schoolName}」已经通过 PhysicsOS 管理员审核，`,
    '你的账号也已开通，现在可以登录了。',
    '',
    `登录地址：${config.siteUrl}`,
    `账号：${notice.username}`,
    '密码：你在注册时设置的那个密码',
    '',
    '如果忘记了密码，可以在登录页点「忘记密码」提交重置申请，',
    '管理员处理后会与你联系。',
    '',
    '—— PhysicsOS',
  ].join('\n'),
})

/**
 * Build the notifier from the environment.
 *
 * Returns `undefined` when the mailbox is not configured, which is a normal
 * state: approval then activates the account and records that no notice went
 * out, instead of refusing to approve.
 * @param env - process environment.
 * @returns the notifier, or undefined when mail is not configured.
 */
export function createAccountNotifier(env: NodeJS.ProcessEnv): AccountNotifier | undefined {
  const config = readMailConfig(env)
  if (config === undefined) return undefined
  return {
    kind: `smtp:${config.host}:${config.port}`,
    async notifyApproved(notice: ApprovedNotice): Promise<void> {
      await sendMail(config, { to: notice.to, ...approvedMessage(config, notice) })
    },
  }
}
