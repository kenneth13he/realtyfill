// tests/zip.test.ts
// lib/zip.ts writes a binary format by hand, byte by byte. Reading it back
// with our own code would only prove it's self-consistent, so the real check
// here is the last one: write an archive to disk and hand it to the system's
// `unzip`, which shares no code with us and is what a realtor's computer will
// effectively be doing.

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createZip, safeFileName } from "../lib/zip";

const text = (s: string) => new TextEncoder().encode(s);

describe("createZip", () => {
  test("produces an archive the system unzip accepts and reads back", () => {
    const zip = createZip([
      { name: "2229E.pdf", data: text("first file contents") },
      { name: "Form 400.pdf", data: text("second file, a different length") },
    ]);

    const dir = mkdtempSync(join(tmpdir(), "realtyfill-zip-"));
    const path = join(dir, "set.zip");
    writeFileSync(path, zip);

    // -t verifies every entry's CRC against its stored bytes, which is the
    // part most likely to be wrong in a hand-written writer.
    execFileSync("unzip", ["-t", path]);

    execFileSync("unzip", ["-q", path, "-d", dir]);
    assert.equal(readFileSync(join(dir, "2229E.pdf"), "utf8"), "first file contents");
    assert.equal(readFileSync(join(dir, "Form 400.pdf"), "utf8"), "second file, a different length");
  });

  test("writes a well-formed empty archive", () => {
    // An archive with no entries is exactly 22 bytes: the end-of-central-
    // directory record and nothing else. Not round-tripped through `unzip`
    // like the others — unzip exits non-zero on an empty archive by design
    // ("Empty zipfile"), so its exit code says nothing about our bytes.
    assert.equal(createZip([]).length, 22);
  });

  test("stores binary contents byte for byte", () => {
    const dir = mkdtempSync(join(tmpdir(), "realtyfill-zip-"));

    // Every byte value, including the NULs and 0x50s that a naive writer
    // scanning for signatures would trip over.
    const bytes = new Uint8Array(256).map((_, i) => i);
    const binary = join(dir, "binary.zip");
    writeFileSync(binary, createZip([{ name: "all-bytes.bin", data: bytes }]));
    execFileSync("unzip", ["-q", binary, "-d", dir]);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, "all-bytes.bin"))), bytes);
  });
});

describe("safeFileName", () => {
  test("strips path separators so a deal label can't escape the filename", () => {
    assert.equal(safeFileName("../../etc/passwd", "forms"), ".. .. etc passwd".replace(/^\.+/, "").trim());
    assert.equal(safeFileName("a/b\\c", "forms"), "a b c");
  });

  test("falls back when nothing usable is left", () => {
    assert.equal(safeFileName("///", "forms"), "forms");
    assert.equal(safeFileName("   ", "forms"), "forms");
  });

  test("keeps ordinary labels intact", () => {
    assert.equal(safeFileName("12 Elm St — Unit 4", "forms"), "12 Elm St — Unit 4");
  });
});
