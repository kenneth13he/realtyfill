// lib/zip.ts
// A minimal ZIP writer, store-only (no compression).
//
// Why hand-rolled rather than `jszip`/`archiver`: the only thing we ever put
// in an archive is a handful of generated PDFs, and a PDF is already
// compressed — deflating one buys a couple of percent for a real CPU cost on
// a serverless function. Store-only is all this needs, and store-only ZIP is
// a header format, not an algorithm: the bytes below are the whole spec we
// use. That's cheaper to own than a dependency in a repo that has an open
// dependency-audit item (ISSUES.md #10) and a supply chain we'd rather keep
// short.
//
// Deliberate limits, all fine for this use and all worth knowing before
// reusing this anywhere else:
//   - No ZIP64. Sizes and offsets are 32-bit, so this tops out at 4GB total
//     and 65,535 entries. A deal's form set is five PDFs.
//   - No directories, no per-entry permissions, no comments.
//   - Everything is buffered in memory; there is no streaming variant.
//
// Verified by round-tripping through `unzip -t` and `unzip -l`, not by
// reading alone — a malformed archive is the kind of bug that only shows up
// on someone else's machine.

/** Standard CRC-32 (IEEE 802.3), the checksum ZIP entries carry. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS timestamp: two 16-bit fields, seconds in 2-second steps and years
 * counted from 1980. Local time, with no zone recorded anywhere — that's the
 * format, not an oversight.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export interface ZipEntry {
  /** Path inside the archive. Forward slashes only. */
  name: string;
  data: Uint8Array;
}

/**
 * Build a ZIP archive containing `entries`, in order.
 *
 * @param modified stamped on every entry — one archive, one timestamp.
 */
export function createZip(entries: ZipEntry[], modified = new Date()): Uint8Array {
  const { time, date } = dosDateTime(modified);
  const encoder = new TextEncoder();

  // Each entry is written twice: once inline (local header + data) and once
  // in the central directory at the end, which is what a reader actually
  // parses. The two copies must agree, so both are built from this list.
  const prepared = entries.map((entry) => {
    const name = encoder.encode(entry.name);
    return { name, data: entry.data, crc: crc32(entry.data), offset: 0 };
  });

  const localSize = prepared.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  const centralSize = prepared.reduce((n, e) => n + 46 + e.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let pos = 0;

  const u16 = (value: number) => {
    view.setUint16(pos, value, true);
    pos += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(pos, value, true);
    pos += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, pos);
    pos += value.length;
  };

  for (const entry of prepared) {
    entry.offset = pos;
    u32(0x04034b50); // local file header signature
    u16(20); // version needed to extract (2.0)
    // Bit 11 marks the name as UTF-8. Form labels are ASCII today, but the
    // deal label is user-supplied and ends up in the filename, so this is
    // load-bearing the first time someone names a deal with an accent in it.
    u16(0x0800);
    u16(0); // compression method: stored
    u16(time);
    u16(date);
    u32(entry.crc);
    u32(entry.data.length); // compressed size — same as uncompressed, stored
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0); // extra field length
    bytes(entry.name);
    bytes(entry.data);
  }

  const centralStart = pos;
  for (const entry of prepared) {
    u32(0x02014b50); // central directory header signature
    u16(20); // version made by
    u16(20); // version needed to extract
    u16(0x0800);
    u16(0); // stored
    u16(time);
    u16(date);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0); // extra field length
    u16(0); // file comment length
    u16(0); // disk number start
    u16(0); // internal file attributes
    u32(0); // external file attributes
    u32(entry.offset);
    bytes(entry.name);
  }

  u32(0x06054b50); // end of central directory signature
  u16(0); // this disk number
  u16(0); // disk with the central directory
  u16(prepared.length); // entries on this disk
  u16(prepared.length); // entries total
  u32(centralSize); // size of the central directory
  u32(centralStart); // offset of the central directory from the start of the file
  u16(0); // archive comment length

  return out;
}

/**
 * Make `name` safe to use as a filename: no separators, no control
 * characters, no leading dots, and short enough for every filesystem we care
 * about. Returns `fallback` if nothing usable survives.
 */
export function safeFileName(name: string, fallback: string): string {
  const cleaned = name
    // Path separators, the characters Windows refuses, and control
    // characters. This string ends up both inside the archive and in a
    // Content-Disposition header, so it has two sets of rules to satisfy.
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}
