'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { digitizeSignature, suggestThreshold } from './digitize';

/**
 * Upload a photo or scan of a signature and keep only the ink.
 *
 * The image is read into a canvas, every pixel darker than the slider becomes
 * black and the rest transparent (see `digitize.ts`), and the preview shows
 * exactly the PNG that will be saved. Nothing leaves the browser until Save.
 */
export interface SignatureUploadHandle {
  /** The digitized signature as a `data:image/png` URL; empty if there is none. */
  toDataUrl(): string;
  clear(): void;
}

/** Longest side the photo is worked on at; a phone photo is far larger than needed. */
const WORK_MAX = 1400;
/** Widest the saved PNG is; the form prints it a few centimetres wide. */
const OUT_MAX_WIDTH = 600;
const OUT_MAX_HEIGHT = 200;

interface Source {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function SignatureUpload({ ref, onChange }: { ref: Ref<SignatureUploadHandle>; onChange?: (empty: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [threshold, setThreshold] = useState(128);
  const [result, setResult] = useState('');
  const [problem, setProblem] = useState('');

  useEffect(() => onChange?.(!result), [result, onChange]);

  useEffect(() => {
    if (!source) {
      setResult('');
      return;
    }
    const ink = digitizeSignature(source.data, source.width, source.height, threshold);
    if (!ink) {
      setResult('');
      setProblem('No ink found at this setting. Move the slider to the right.');
      return;
    }
    setProblem('');
    const full = document.createElement('canvas');
    full.width = ink.width;
    full.height = ink.height;
    full.getContext('2d')!.putImageData(new ImageData(ink.data, ink.width, ink.height), 0, 0);
    const scale = Math.min(1, OUT_MAX_WIDTH / ink.width, OUT_MAX_HEIGHT / ink.height);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(ink.width * scale));
    out.height = Math.max(1, Math.round(ink.height * scale));
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(full, 0, 0, out.width, out.height);
    setResult(out.toDataURL('image/png'));
  }, [source, threshold]);

  useImperativeHandle(ref, () => ({
    toDataUrl: () => result,
    clear() {
      setSource(null);
      setProblem('');
      if (input.current) input.current.value = '';
    },
  }));

  async function load(file: File | undefined) {
    if (!file) return;
    setProblem('');
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, WORK_MAX / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setThreshold(suggestThreshold(data));
      setSource({ data, width: canvas.width, height: canvas.height });
    } catch {
      setSource(null);
      setProblem('That file could not be read as an image. Try a JPG or PNG.');
    }
  }

  return (
    <div className="signature-upload">
      <label className="camp-field">
        <span className="camp-field__label">Photo or scan of the signature</span>
        <input
          ref={input}
          className="input"
          type="file"
          accept="image/*"
          onChange={(event) => void load(event.target.files?.[0])}
        />
        <span className="camp-field__hint">
          Sign in dark ink on plain white paper, then photograph it straight on in good light.
        </span>
      </label>
      {source ? (
        <label className="camp-field">
          <span className="camp-field__label">Ink sensitivity</span>
          <input
            type="range"
            min={20}
            max={240}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          />
          <span className="camp-field__hint">
            Left keeps only the darkest strokes; right picks up fainter ink, and shadows with it.
          </span>
        </label>
      ) : null}
      {problem ? <p className="note">{problem}</p> : null}
      {result ? (
        <figure className="signature-on-file signature-upload__preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL; there is nothing for next/image to optimise. */}
          <img src={result} alt="Digitized signature" />
          <figcaption>What will be saved: black ink, no background.</figcaption>
        </figure>
      ) : null}
    </div>
  );
}
