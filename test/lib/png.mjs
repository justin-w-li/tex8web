// The little of PNG that shots.mjs needs: the pixels of a screenshot, and a
// picture made from some of its rows. Chrome writes 8-bit RGB or RGBA,
// not interlaced.
import { deflateSync, inflateSync } from 'node:zlib';

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc = bytes => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// { width, height, channels, rows } of a PNG, rows being its pixels, row by
// row, with no filter bytes
export function decode(png) {
  if (!png.subarray(0, 8).equals(signature)) throw new Error('not a PNG');
  let header;
  const data = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = body;
    else if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const [width, height] = [header.readUInt32BE(0), header.readUInt32BE(4)];
  const channels = { 2: 3, 6: 4 }[header[9]];
  if (header[8] !== 8 || !channels || header[12] !== 0) {
    throw new Error(`unsupported PNG: ${header[8]}-bit, color type ${header[9]}, interlace ${header[12]}`);
  }
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  if (raw.length !== height * (stride + 1)) throw new Error('truncated PNG');
  const rows = Buffer.alloc(height * stride), zeros = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], from = y * (stride + 1) + 1, to = y * stride;
    // (the row above, which the first row has all zero)
    const above = y ? rows : zeros, at = y ? to - stride : 0;
    if (filter === 0) raw.copy(rows, to, from, from + stride);
    else if (filter === 2) {
      for (let x = 0; x < stride; x++) rows[to + x] = raw[from + x] + above[at + x];
    } else if (filter === 1 || filter === 3 || filter === 4) {
      for (let x = 0; x < stride; x++) {
        const left = x >= channels ? rows[to + x - channels] : 0, up = above[at + x];
        let predicted;
        if (filter === 1) predicted = left;
        else if (filter === 3) predicted = (left + up) >> 1;
        else {
          const upLeft = x >= channels ? above[at + x - channels] : 0;
          const p = left + up - upLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upLeft);
          predicted = a <= b && a <= c ? left : b <= c ? up : upLeft;
        }
        rows[to + x] = raw[from + x] + predicted;
      }
    } else throw new Error(`bad PNG filter ${filter}`);
  }
  return { width, height, channels, rows };
}

// the PNG of rows from top down to bottom (exclusive) of a decoded picture
export function encode({ width, channels, rows }, top, bottom) {
  const stride = width * channels, height = bottom - top;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) rows.copy(raw, y * (stride + 1) + 1, (top + y) * stride, (top + y + 1) * stride);
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
