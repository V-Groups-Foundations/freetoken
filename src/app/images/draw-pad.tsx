'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A canvas to draw on: a blank page for a sketch, or over a photo to mark the part to change.
 * Hands back a JPEG data URL of the drawing (photo included) at the canvas's own size.
 */
export function DrawPad({ background, colors, title, hint, onDone, onCancel }: {
  /** a photo to draw over; without one, a white 768×768 page */
  background?: string;
  colors: string[];
  title: string;
  hint: string;
  onDone: (pic: { dataUrl: string; width: number; height: number }) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const history = useRef<ImageData[]>([]);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState(colors[0]);
  const [size, setSize] = useState(background ? 40 : 6);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const blank = () => {
      canvas.width = 768;
      canvas.height = 768;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 768, 768);
      setReady(true);
    };
    if (!background) return blank();
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      setReady(true);
    };
    img.onerror = blank;
    img.src = background;
  }, [background]);

  // pointer position in canvas pixels (the canvas is shown scaled down to fit)
  function at(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  }

  function stroke(from: { x: number; y: number }, to: { x: number; y: number }) {
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  function undo() {
    const last = history.current.pop();
    if (last) canvasRef.current!.getContext('2d')!.putImageData(last, 0, 0);
  }

  function clear() {
    const c = canvasRef.current!;
    const first = history.current[0];
    if (first) c.getContext('2d')!.putImageData(first, 0, 0);
    history.current = [];
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="muted text-xs">{hint}</span>
      </div>
      <canvas
        ref={canvasRef}
        className="max-h-[60vh] w-auto max-w-full touch-none self-start rounded-lg border border-[var(--border)] bg-white"
        style={{ cursor: 'crosshair', visibility: ready ? 'visible' : 'hidden' }}
        onPointerDown={(e) => {
          const c = e.currentTarget;
          history.current.push(c.getContext('2d')!.getImageData(0, 0, c.width, c.height));
          if (history.current.length > 30) history.current.splice(1, 1); // keep the untouched first state for Clear
          c.setPointerCapture(e.pointerId);
          const p = at(e);
          drawing.current = p;
          stroke(p, { x: p.x + 0.1, y: p.y + 0.1 }); // a tap leaves a dot
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = at(e);
          stroke(drawing.current, p);
          drawing.current = p;
        }}
        onPointerUp={() => { drawing.current = null; }}
        onPointerCancel={() => { drawing.current = null; }}
      />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {colors.length > 1 && (
          <div className="flex items-center gap-1.5">
            {colors.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Colour ${c}`}
                className="h-6 w-6 rounded-full border-2" style={{ background: c, borderColor: color === c ? 'var(--brand)' : 'var(--border)' }} />
            ))}
          </div>
        )}
        <label className="flex items-center gap-2">
          <span className="muted">Brush</span>
          <input type="range" min={2} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <button type="button" onClick={undo} className="btn btn-ghost btn-sm">Undo</button>
        <button type="button" onClick={clear} className="btn btn-ghost btn-sm">Clear</button>
        <span className="flex-1" />
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">Cancel</button>
        <button type="button" className="btn btn-primary btn-sm"
          onClick={() => {
            const c = canvasRef.current!;
            onDone({ dataUrl: c.toDataURL('image/jpeg', 0.92), width: c.width, height: c.height });
          }}>
          Use this
        </button>
      </div>
    </div>
  );
}
