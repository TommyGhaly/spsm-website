/**
 * The pixel dimensions of a webp file, without a dependency.
 *
 * Used by seed-emulator.mjs, which uploads the site's own webp images into the
 * Storage emulator as gallery photographs. Those documents carry `width` and
 * `height`, and the gallery packer reads them to decide how wide a photograph
 * should sit — so an invented number produces a layout that is locally wrong in
 * a way that looks like a packing bug.
 *
 * A decoder is not needed for this. A webp file is a RIFF container, and all
 * three of its image chunks state the size in their first few bytes.
 */
import { readFileSync } from 'node:fs';

/**
 * @param {string} path a `.webp` file
 * @returns {{ width: number, height: number }}
 * @throws if the file is not webp, or uses a chunk shape this does not know.
 *   Throwing rather than guessing: a silent fallback of 1000×1000 would make
 *   every photograph square and the packing impossible to trust.
 */
export function webpSize(path) {
  const buffer = readFileSync(path);

  if (buffer.length < 30) throw new Error(`${path}: too short to be a webp file.`);
  if (buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WEBP') {
    throw new Error(`${path}: not a RIFF/WEBP file.`);
  }

  const chunk = buffer.toString('latin1', 12, 16);

  /*
   * Extended format. The size lives in the VP8X chunk's own canvas fields
   * rather than in the frame that follows it, which is why this is checked
   * first — an animated or alpha-carrying file has a VP8X *and* a VP8 chunk,
   * and reading the second gives the frame rather than the canvas.
   *
   * Both are stored minus one, in 24 bits, little-endian.
   */
  if (chunk === 'VP8X') {
    return {
      width: (buffer.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (buffer.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  }

  // Lossy. The keyframe header opens with the 3-byte start code 0x9d012a, then
  // two 16-bit fields whose low 14 bits are the dimensions.
  if (chunk === 'VP8 ') {
    // Chunk data begins at 20: a 3-byte frame tag, then the 3-byte start code,
    // then the two dimension fields.
    if (buffer.readUIntLE(23, 3) !== 0x2a019d) {
      throw new Error(`${path}: VP8 keyframe start code missing.`);
    }
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  /*
   * Lossless. One signature byte, then 14 bits of width-1 and 14 of height-1,
   * packed across the following four bytes with no byte alignment — hence the
   * 32-bit read and the shifts rather than two field reads.
   */
  if (chunk === 'VP8L') {
    if (buffer[20] !== 0x2f) throw new Error(`${path}: VP8L signature missing.`);
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  throw new Error(`${path}: unrecognised webp chunk "${chunk}".`);
}
