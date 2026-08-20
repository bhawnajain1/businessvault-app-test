// Tiny hand-rolled ZIP writer (STORED method — no compression).
// Grug approach: no new deps, ~200 lines, produces spec-compliant .zip that
// Windows/macOS/Linux archive tools all accept.
//
// Format ref: PKZIP APPNOTE, sections 4.3.7 (local file header),
// 4.3.12 (central directory header), 4.3.16 (end-of-central-directory).
// We use general purpose bit 3 = 0 (sizes known up front), method = 0 (stored).

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear());
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}

interface Entry {
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
  dosDate: number;
  dosTime: number;
}

export interface ZipEntryInput {
  path: string;
  content: Uint8Array | string | Blob;
  modifiedAt?: Date;
}

const enc = new TextEncoder();

async function toBytes(c: Uint8Array | string | Blob): Promise<Uint8Array> {
  if (typeof c === 'string') return enc.encode(c);
  if (c instanceof Uint8Array) return c;
  const buf = await c.arrayBuffer();
  return new Uint8Array(buf);
}

// Grow-a-buffer writer. We know sizes end-to-end for STORED zips so we could
// pre-compute, but the growth cost is trivial vs code clarity.
class ByteSink {
  private chunks: Uint8Array[] = [];
  private len = 0;
  push(b: Uint8Array): void {
    this.chunks.push(b);
    this.len += b.length;
  }
  u16(v: number): void {
    const b = new Uint8Array(2);
    b[0] = v & 0xff;
    b[1] = (v >>> 8) & 0xff;
    this.push(b);
  }
  u32(v: number): void {
    const b = new Uint8Array(4);
    b[0] = v & 0xff;
    b[1] = (v >>> 8) & 0xff;
    b[2] = (v >>> 16) & 0xff;
    b[3] = (v >>> 24) & 0xff;
    this.push(b);
  }
  size(): number {
    return this.len;
  }
  toBlob(mime = 'application/zip'): Blob {
    return new Blob(this.chunks as BlobPart[], { type: mime });
  }
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

export async function buildZip(entries: ZipEntryInput[]): Promise<Blob> {
  const sink = new ByteSink();
  const catalogue: Entry[] = [];
  const now = new Date();

  for (const e of entries) {
    const nameBytes = enc.encode(e.path);
    const data = await toBytes(e.content);
    const crc = crc32(data);
    const dt = dosDateTime(e.modifiedAt ?? now);
    const offset = sink.size();

    // Local file header
    sink.u32(SIG_LOCAL);
    sink.u16(20); // version needed
    sink.u16(0x0800); // general purpose — bit 11 = UTF-8 filenames
    sink.u16(0); // method: stored
    sink.u16(dt.time);
    sink.u16(dt.date);
    sink.u32(crc);
    sink.u32(data.length); // compressed size
    sink.u32(data.length); // uncompressed size
    sink.u16(nameBytes.length);
    sink.u16(0); // extra
    sink.push(nameBytes);
    sink.push(data);

    catalogue.push({
      nameBytes,
      data,
      crc,
      offset,
      dosDate: dt.date,
      dosTime: dt.time,
    });
  }

  const centralStart = sink.size();
  for (const e of catalogue) {
    sink.u32(SIG_CENTRAL);
    sink.u16(20); // version made by
    sink.u16(20); // version needed
    sink.u16(0x0800); // GPF: UTF-8 filenames
    sink.u16(0); // method: stored
    sink.u16(e.dosTime);
    sink.u16(e.dosDate);
    sink.u32(e.crc);
    sink.u32(e.data.length);
    sink.u32(e.data.length);
    sink.u16(e.nameBytes.length);
    sink.u16(0); // extra
    sink.u16(0); // comment
    sink.u16(0); // disk number
    sink.u16(0); // internal attrs
    sink.u32(0); // external attrs
    sink.u32(e.offset);
    sink.push(e.nameBytes);
  }
  const centralEnd = sink.size();

  // End of central directory
  sink.u32(SIG_EOCD);
  sink.u16(0); // this disk
  sink.u16(0); // disk with CD start
  sink.u16(catalogue.length); // entries on this disk
  sink.u16(catalogue.length); // total entries
  sink.u32(centralEnd - centralStart); // CD size
  sink.u32(centralStart); // CD offset
  sink.u16(0); // comment length

  return sink.toBlob();
}
