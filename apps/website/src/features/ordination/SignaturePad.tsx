'use client';

import { useEffect, useImperativeHandle, useRef, useState, type PointerEvent, type Ref } from 'react';

/**
 * A box to sign in with a finger, a pen or a mouse.
 *
 * Pointer events, so one code path serves all three, and `touch-action: none`
 * on the canvas so a finger signs rather than scrolls the page. The drawing is
 * kept at twice the box's size and exported as a PNG with a transparent
 * background, which is what lets it sit on the form's printed rule without a
 * white rectangle around it.
 */
export interface SignaturePadHandle {
  /** The signature as a `data:image/png` URL, cropped to the ink; empty if nothing was drawn. */
  toDataUrl(): string;
  clear(): void;
}

const WIDTH = 600;
const HEIGHT = 180;

export function SignaturePad({ ref, onChange }: { ref: Ref<SignaturePadHandle>; onChange?: (empty: boolean) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => onChange?.(empty), [empty, onChange]);

  function context(): CanvasRenderingContext2D | null {
    const ctx = canvas.current?.getContext('2d') ?? null;
    if (ctx) {
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0d1a59';
    }
    return ctx;
  }

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * WIDTH,
      y: ((event.clientY - box.top) / box.height) * HEIGHT,
    };
  }

  useImperativeHandle(ref, () => ({
    clear() {
      context()?.clearRect(0, 0, WIDTH, HEIGHT);
      setEmpty(true);
    },
    toDataUrl() {
      const source = canvas.current;
      const ctx = context();
      if (!source || !ctx || empty) return '';
      // Cropped to the ink, so the form scales the signature rather than the
      // blank space around it.
      const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
      let top = HEIGHT, left = WIDTH, right = 0, bottom = 0;
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (data[(y * WIDTH + x) * 4 + 3]! > 0) {
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
          }
        }
      }
      if (right < left) return '';
      const pad = 6;
      const crop = document.createElement('canvas');
      crop.width = Math.min(WIDTH, right - left + pad * 2);
      crop.height = Math.min(HEIGHT, bottom - top + pad * 2);
      crop.getContext('2d')!.drawImage(source, Math.max(0, left - pad), Math.max(0, top - pad), crop.width, crop.height, 0, 0, crop.width, crop.height);
      return crop.toDataURL('image/png');
    },
  }));

  return (
    <canvas
      ref={canvas}
      className="signature-pad"
      width={WIDTH}
      height={HEIGHT}
      aria-label="Sign here"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = true;
        last.current = point(event);
        const ctx = context();
        if (ctx) {
          // A tap is a dot, not nothing.
          ctx.beginPath();
          ctx.arc(last.current.x, last.current.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = '#0d1a59';
          ctx.fill();
        }
        setEmpty(false);
      }}
      onPointerMove={(event) => {
        if (!drawing.current || !last.current) return;
        const ctx = context();
        const next = point(event);
        if (ctx) {
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(next.x, next.y);
          ctx.stroke();
        }
        last.current = next;
      }}
      onPointerUp={() => {
        drawing.current = false;
        last.current = null;
      }}
      onPointerCancel={() => {
        drawing.current = false;
        last.current = null;
      }}
    />
  );
}
