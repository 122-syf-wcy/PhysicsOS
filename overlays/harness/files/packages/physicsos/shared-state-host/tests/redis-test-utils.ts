import net from 'node:net'

export const redisUrl = process.env['PHYSICSOS_TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379/15'

export const probeRedis = async (): Promise<boolean> => {
  const parsed = new URL(redisUrl)
  return await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: parsed.hostname, port: Number(parsed.port || 6379) })
    const finish = (value: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(250, () =>{  finish(false) })
    socket.once('connect', () =>{  finish(true) })
    socket.once('error', () =>{  finish(false) })
  })
}
