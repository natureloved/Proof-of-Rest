"use client";

import { useEffect, useRef } from "react";

type Phase = "idle" | "active" | "cooldown";

export function Vitals({ phase }: { phase: Phase }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.width = canvas.clientWidth * dpr;
      h = canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const color =
      phase === "active" ? "#FFB547" : phase === "cooldown" ? "#7CFC9B" : "#2c4a37";

    const draw = () => {
      // Slow the clock right down when the user prefers reduced motion so the
      // trace is essentially still rather than animating.
      timeRef.current += reduceMotion ? 0.002 : 0.05;
      const time = timeRef.current;
      ctx.clearRect(0, 0, w, h);

      // baseline
      ctx.strokeStyle = "rgba(124,252,155,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const u = x / w;
        let y: number;
        if (phase === "active") {
          // jagged, erratic amber waveform
          y =
            h / 2 +
            Math.sin(u * 40 + time * 6) * (h * 0.32) +
            Math.sin(u * 97 + time * 11) * (h * 0.12) +
            (reduceMotion ? 0 : (Math.random() - 0.5) * h * 0.06);
        } else if (phase === "cooldown") {
          // calm, slow green sine
          y = h / 2 + Math.sin(u * 6 + time * 1.5) * (h * 0.22);
        } else {
          y = h / 2 + Math.sin(u * 3 + time * 0.5) * (h * 0.04);
        }
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [phase]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="h-20 w-full rounded-lg border border-forest-600 bg-forest-900/60"
    />
  );
}
