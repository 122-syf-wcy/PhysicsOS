/** Bounded, shell-free print-tool execution shared by export and validation. */
import { spawn } from 'node:child_process'
import { basename } from 'node:path'

export interface PrintProcessResult { readonly stdout: Buffer; readonly stderr: string }
export async function runPrintProcess(
  command: string, args: readonly string[], cwd: string, timeoutMs: number,
  env?: NodeJS.ProcessEnv, maxOutputBytes = 16 * 1024 * 1024,
): Promise<PrintProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, env: env === undefined ? undefined : { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []; let outputBytes = 0; let stderr = ''; let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (error !== undefined) reject(error)
      else resolve({ stdout: Buffer.concat(chunks), stderr })
    }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`${basename(command)} 超过 ${timeoutMs}ms 时限`)) }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > maxOutputBytes) { child.kill('SIGKILL'); finish(new Error(`${basename(command)} 输出超过限额`)); return }
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length) })
    child.on('error', (error) => finish(new Error(`${basename(command)} 无法启动：${error.message}`)))
    child.on('close', (code, signal) => finish(code === 0 ? undefined : new Error(`${basename(command)} 失败（${code ?? signal ?? 'unknown'}）：${stderr.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300)}`)))
  })
}
