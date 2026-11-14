/** Small byte helpers for the Pyth and Wormhole wire formats (no Node `Buffer`). */

export class ByteReader {
  private offset = 0;
  private readonly view: DataView;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly what: string,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private need(n: number): number {
    if (n < 0 || this.offset + n > this.bytes.length)
      throw new Error(`${this.what} is truncated.`);
    const at = this.offset;
    this.offset += n;
    return at;
  }

  take(n: number): Uint8Array {
    const at = this.need(n);
    return this.bytes.slice(at, at + n);
  }

  u8(): number {
    return this.view.getUint8(this.need(1));
  }
  u16(): number {
    return this.view.getUint16(this.need(2), false);
  }
  u32(): number {
    return this.view.getUint32(this.need(4), false);
  }
  i32(): number {
    return this.view.getInt32(this.need(4), false);
  }
  u64(): bigint {
    return this.view.getBigUint64(this.need(8), false);
  }
  i64(): bigint {
    return this.view.getBigInt64(this.need(8), false);
  }

  rest(): Uint8Array {
    return this.take(this.remaining);
  }

  end(): void {
    if (this.remaining !== 0)
      throw new Error(`${this.what} has ${this.remaining} trailing bytes.`);
  }
}

/** Big-endian writer (Pyth wire and VAA formats). */
export class ByteWriter {
  private readonly parts: Uint8Array[] = [];

  bytes(value: Uint8Array): this {
    this.parts.push(Uint8Array.from(value));
    return this;
  }

  private fixed(size: number, write: (view: DataView) => void): this {
    const out = new Uint8Array(size);
    write(new DataView(out.buffer));
    this.parts.push(out);
    return this;
  }

  u8(value: number): this {
    return this.fixed(1, (v) => v.setUint8(0, checkedInt(value, 0xff)));
  }
  u16(value: number): this {
    return this.fixed(2, (v) => v.setUint16(0, checkedInt(value, 0xffff)));
  }
  u32(value: number): this {
    return this.fixed(4, (v) => v.setUint32(0, checkedInt(value, 0xffffffff)));
  }
  i32(value: number): this {
    return this.fixed(4, (v) => v.setInt32(0, value));
  }
  u64(value: bigint): this {
    return this.fixed(8, (v) => v.setBigUint64(0, value));
  }
  i64(value: bigint): this {
    return this.fixed(8, (v) => v.setBigInt64(0, value));
  }

  toBytes(): Uint8Array {
    return concatBytes(this.parts);
  }
}

function checkedInt(value: number, max: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new Error(`Value ${value} does not fit the field.`);
  return value;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Little-endian u32 / u64 for Borsh-encoded instruction data. */
export function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, checkedInt(value, 0xffffffff), true);
  return out;
}
export function u64le(value: bigint): Uint8Array {
  if (value < 0n || value >= 2n ** 64n) throw new Error("u64 out of range.");
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean))
    throw new Error("Invalid hex string.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1)
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function fromBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0)
    throw new Error("Invalid base64 data.");
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
