export function toUtf8Buffer(chunk: Buffer | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
}

export function utf8SafeEnd(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0
  }

  let index = buffer.length
  while (index > 0 && (buffer[index - 1]! & 0xc0) === 0x80) {
    index -= 1
  }
  if (index === 0) {
    return 0
  }

  const lead = buffer[index - 1]!
  const needed = utf8SequenceLength(lead)
  if (needed < 0 || index - 1 + needed > buffer.length) {
    return index - 1
  }
  return buffer.length
}

export function sliceUtf8Bytes(buffer: Buffer, maxBytes: number): Buffer {
  if (maxBytes <= 0) {
    return buffer.subarray(0, 0)
  }
  if (buffer.length <= maxBytes) {
    return buffer.subarray(0, utf8SafeEnd(buffer))
  }
  return buffer.subarray(0, utf8SafeEnd(buffer.subarray(0, maxBytes)))
}

function utf8SequenceLength(lead: number): number {
  if (lead <= 0x7f) {
    return 1
  }
  if ((lead & 0xe0) === 0xc0) {
    return 2
  }
  if ((lead & 0xf0) === 0xe0) {
    return 3
  }
  if ((lead & 0xf8) === 0xf0) {
    return 4
  }
  return -1
}
