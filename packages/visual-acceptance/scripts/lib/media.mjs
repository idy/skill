import { readFile, readdir, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { check, sha256 } from './contracts.mjs';

// Fully decode pixels. A valid header alone is insufficient evidence of a usable image.
export function decodeImage(bytes) {
  check(bytes.length <= 32 * 1024 * 1024, 'Image exceeds 32 MiB');
  let decoded, mimeType, ext;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    // Bound allocations before invoking the decoder.
    check(bytes.length >= 24 && bytes.readUInt32BE(16) * bytes.readUInt32BE(20) <= 40_000_000, 'Image dimensions exceed 40 megapixels');
    decoded = PNG.sync.read(bytes, { checkCRC: true }); mimeType = 'image/png'; ext = 'png';
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    decoded = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256 }); mimeType = 'image/jpeg'; ext = 'jpg';
  } else throw new Error('Unsupported or corrupt image; expected PNG or JPEG');
  check(decoded.width > 0 && decoded.height > 0 && decoded.data?.length === decoded.width * decoded.height * 4, 'Image decode failed');
  // Encoded hashes identify immutable files; eligibility compares a format-independent
  // decoded raster. Include dimensions and a versioned RGBA8 domain, not PNG/JPEG metadata.
  const dimensions = Buffer.alloc(8);
  dimensions.writeUInt32BE(decoded.width, 0); dimensions.writeUInt32BE(decoded.height, 4);
  const pixelSha256 = createHash('sha256').update('visual-acceptance:rgba8:v1\0').update(dimensions).update(decoded.data).digest('hex');
  return { width: decoded.width, height: decoded.height, mimeType, ext, pixelSha256 };
}
export async function hashArtifact(path) {
  const info = await lstat(path); check(!info.isSymbolicLink(), 'Artifact symlinks are not supported; supply immutable bytes');
  if (info.isFile()) { const bytes = await readFile(path); return { sha256: sha256(bytes), bytes: bytes.length, kind: 'file' }; }
  check(info.isDirectory(), 'Artifact must be a file or directory');
  const files = [];
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const p = join(dir, name), stat = await lstat(p); check(!stat.isSymbolicLink(), `Artifact symlink: ${relative(path, p)}`);
      if (stat.isDirectory()) await walk(p);
      else { check(stat.isFile(), 'Artifact contains non-regular file'); const data = await readFile(p); files.push({ path: relative(path, p).split('\\').join('/'), sha256: sha256(data), bytes: data.length }); }
    }
  }
  await walk(path); check(files.length > 0, 'Empty artifact directory');
  return { sha256: sha256(JSON.stringify(files)), bytes: files.reduce((n, f) => n + f.bytes, 0), kind: 'directory', files };
}
