/**
 * Turns a photo or scan of a signature into ink on nothing.
 *
 * Pure functions over RGBA pixels, so they can be tested without a canvas.
 * Every pixel darker than the threshold becomes solid black; everything else
 * becomes transparent, with a short ramp at the edge so strokes are not
 * jagged. The result is cropped to the ink, which is what the printed form
 * scales.
 */

/** How far either side of the threshold the edge fades over, in grey levels. */
const SOFT = 24;

function luminance(data: Uint8ClampedArray, i: number): number {
  // A pixel that was already transparent (a PNG cut-out) counts as paper.
  const alpha = data[i + 3]! / 255;
  const grey = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  return grey * alpha + 255 * (1 - alpha);
}

/**
 * The grey level that best splits ink from paper (Otsu's method), as a
 * starting point for the slider. Clamped so a nearly blank image still lands
 * somewhere sensible.
 */
export function suggestThreshold(data: Uint8ClampedArray): number {
  const histogram = new Array<number>(256).fill(0);
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) histogram[Math.round(luminance(data, i))]! += 1;
  let sum = 0;
  for (let level = 0; level < 256; level++) sum += level * histogram[level]!;
  let sumBack = 0, weightBack = 0, best = 0, bestLevel = 128;
  for (let level = 0; level < 256; level++) {
    weightBack += histogram[level]!;
    if (weightBack === 0) continue;
    const weightFore = pixels - weightBack;
    if (weightFore === 0) break;
    sumBack += level * histogram[level]!;
    const meanBack = sumBack / weightBack;
    const meanFore = (sum - sumBack) / weightFore;
    const between = weightBack * weightFore * (meanBack - meanFore) ** 2;
    if (between > best) {
      best = between;
      bestLevel = level;
    }
  }
  return Math.min(220, Math.max(40, bestLevel));
}

export interface InkImage {
  width: number;
  height: number;
  /** RGBA: black, with alpha for the ink. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Black ink on transparent, cropped to the ink with `pad` pixels around it.
 * `null` when nothing is darker than the threshold.
 */
export function digitizeSignature(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
  pad = 6,
): InkImage | null {
  const alpha = new Uint8ClampedArray(width * height);
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const grey = luminance(source, p * 4);
      // Fully ink below threshold - SOFT, fully paper at threshold, a ramp between.
      const a = grey >= threshold ? 0 : grey <= threshold - SOFT ? 255 : Math.round(((threshold - grey) / SOFT) * 255);
      if (a === 0) continue;
      alpha[p] = a;
      // Only solid ink decides the crop, so faint specks of paper texture do not widen it.
      if (a >= 128) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const outWidth = right - left + 1;
  const outHeight = bottom - top + 1;
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      data[(y * outWidth + x) * 4 + 3] = alpha[(y + top) * width + (x + left)]!;
    }
  }
  return { width: outWidth, height: outHeight, data };
}
