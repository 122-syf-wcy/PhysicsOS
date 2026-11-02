/** Deterministic store-only ZIP; generated files are frozen at submission time. */
export function zipBytes(files) {
  const local = []
  const central = []
  let offset = 0
  for (const [path, body] of files) {
    if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\\')) throw new Error('Invalid archive path')
    const name = Buffer.from(path)
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body)
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(0x5d62, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, data)
    const index = Buffer.alloc(46)
    index.writeUInt32LE(0x02014b50)
    index.writeUInt16LE(20, 4)
    index.writeUInt16LE(20, 6)
    index.writeUInt16LE(0x800, 8)
    index.writeUInt16LE(0x5d62, 14)
    index.writeUInt32LE(crc, 16)
    index.writeUInt32LE(data.length, 20)
    index.writeUInt32LE(data.length, 24)
    index.writeUInt16LE(name.length, 28)
    index.writeUInt32LE(offset, 42)
    central.push(index, name)
    offset += 30 + name.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}
