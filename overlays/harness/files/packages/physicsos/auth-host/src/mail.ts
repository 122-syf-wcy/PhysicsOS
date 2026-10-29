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
  /** Plain-text fallback — every client can render it, and it is what a
      screen reader or a text-only client shows. */
  readonly text: string
  /** Optional rich body; when present the message becomes multipart/alternative. */
  readonly html?: string
}

/** A MIME boundary unique enough that a body line cannot collide with it. */
const boundaryOf = (): string => `=_physicsos_${randomUUID().replaceAll('-', '')}`

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
  const headers = [
    `From: ${formatMailbox(config.fromName, config.user)}`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${date}`,
    `Message-ID: <${randomUUID()}@${config.user.split('@')[1] ?? 'physicsos'}>`,
    'MIME-Version: 1.0',
  ]

  if (message.html === undefined) {
    return [
      ...headers,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Body(message.text),
    ].join(CRLF)
  }

  /* multipart/alternative with the LEAST preferred part first: a client walks
     the parts and renders the last one it understands, so a text-only reader
     stops at plain text and a rich reader goes on to the HTML. */
  const boundary = boundaryOf()
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    'This is a multi-part message in MIME format.',
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(message.text),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(message.html),
    '',
    `--${boundary}--`,
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

/** Escape the five characters that would break out of an HTML text node or attribute. */
const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

/**
 * Compose the branded approval message.
 *
 * The HTML is written the way mail clients need it, not the way the web does:
 * tables for layout (Outlook has no flex/grid), every rule inline (Gmail
 * strips `<style>` in some contexts), a fixed 600px card that falls back to
 * full width on a phone, and CJK-safe system font stacks on both branches.
 * The plain-text part is not a formality — it is what the spam filter scores
 * and what a screen reader may read instead.
 * @param config - mailbox settings (for the site link).
 * @param notice - who to address and which school they joined.
 * @returns subject, plain-text fallback, and the HTML body.
 */
const approvedMessage = (
  config: MailConfig,
  notice: ApprovedNotice,
): Pick<MailMessage, 'subject' | 'text' | 'html'> => {
  const name = escapeHtml(notice.displayName)
  const school = escapeHtml(notice.schoolName)
  const username = escapeHtml(notice.username)
  const site = escapeHtml(config.siteUrl)
  const passwordHint = '你在注册时设置的密码'

  const text = [
    `${notice.displayName} 同学，你好：`,
    '',
    `你申请的学校「${notice.schoolName}」已经通过 PhysicsOS 管理员审核，`,
    '你的账号也已开通，现在可以登录了。',
    '',
    `登录地址：${config.siteUrl}`,
    `账号：${notice.username}`,
    `密码：${passwordHint}`,
    '',
    '如果忘记了密码，可以在登录页点「忘记密码」提交重置申请，',
    '管理员处理后会与你联系。',
    '',
    '—— PhysicsOS',
  ].join('\n')

  /* One reusable row of the details table: label on the left, value on the
     right. Kept as a function so the three rows cannot drift apart. */
  const row = (label: string, value: string, last = false): string => `
              <tr>
                <td style="padding:0 0 ${last ? '0' : '14px'} 0;font-size:13px;line-height:20px;color:#8a8f98;white-space:nowrap;vertical-align:top;width:88px;">${label}</td>
                <td style="padding:0 0 ${last ? '0' : '14px'} 0;font-size:14px;line-height:20px;color:#1b1f24;font-weight:600;vertical-align:top;word-break:break-all;">${value}</td>
              </tr>`

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>PhysicsOS 账号已通过审核</title>
</head>
<body style="margin:0;padding:0;background-color:#eef1f6;-webkit-text-size-adjust:100%;">
  <!-- Preheader: the line mail clients show next to the subject. Hidden in the body. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">你申请的学校已通过审核，账号可以登录了。</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef1f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,0.08);">

          <!-- Brand band -->
          <tr>
            <td style="padding:26px 32px;background-color:#0f172a;background-image:linear-gradient(135deg,#111c33 0%,#1d3557 100%);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#ffffff;letter-spacing:0.2px;">
                    PhysicsOS
                  </td>
                  <td align="right" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:12px;line-height:18px;color:#9fb3d1;">
                    账号审核结果
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Status pill -->
          <tr>
            <td style="padding:32px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:6px 12px;border-radius:999px;background-color:#e7f6ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:12px;line-height:16px;font-weight:600;color:#1a7f43;">
                    已通过审核
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding:18px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
              <h1 style="margin:0;font-size:22px;line-height:32px;font-weight:700;color:#0f172a;">欢迎加入 PhysicsOS</h1>
              <p style="margin:12px 0 0 0;font-size:14px;line-height:24px;color:#4a5568;">
                ${name} 同学，你好：你申请的学校「<strong style="color:#1b1f24;font-weight:600;">${school}</strong>」已经通过平台管理员审核，账号也已开通，现在可以登录了。
              </p>
            </td>
          </tr>

          <!-- Credentials card -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f9fc;border:1px solid #e6eaf2;border-radius:12px;">
                <tr>
                  <td style="padding:20px 20px 18px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${row('学校', school)}
${row('账号', username)}
${row('密码', passwordHint, true)}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="left" style="padding:24px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background-color:#2563eb;">
                    <a href="${site}" style="display:inline-block;padding:13px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:14px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">进入 PhysicsOS</a>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:12px;line-height:20px;color:#8a8f98;">
                按钮无法点击时，请打开 <a href="${site}" style="color:#2563eb;text-decoration:none;">${site}</a>
              </p>
            </td>
          </tr>

          <!-- Note -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e6eaf2;">
                <tr>
                  <td style="padding-top:18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:13px;line-height:22px;color:#6b7280;">
                    忘记了密码？在登录页点「忘记密码」提交重置申请，管理员处理后会与你联系。<br>
                    这封邮件由系统自动发送，请勿直接回复。
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:12px;line-height:18px;color:#98a2b3;">
              PhysicsOS 物理学习平台
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject: `PhysicsOS 账号已通过审核：${notice.schoolName}`, text, html }
}

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
