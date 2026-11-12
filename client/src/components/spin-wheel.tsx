import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SpinWheelProps {
  players: { id: string; name: string }[];
  title?: string;
  onResult: (player: { id: string; name: string }) => void;
}

const COLORS = [
  "#7c3aed", "#6d28d9", "#8b5cf6", "#a78bfa",
  "#5b21b6", "#4c1d95", "#9333ea", "#c084fc",
  "#7e22ce", "#6b21a8", "#a855f7", "#d8b4fe",
];

export default function SpinWheel({ players, title, onResult }: SpinWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spinning, setSpinning] = useState(false);
  const [done, setDone] = useState(false);
  const [winner, setWinner] = useState<{ id: string; name: string } | null>(null);
  const angleRef = useRef(0);
  const velocityRef = useRef(0);
  const animFrameRef = useRef<number>(0);

  const segmentAngle = (2 * Math.PI) / players.length;

  const draw = useCallback((angle: number, highlightIdx?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const size = 320;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 12;

    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.shadowColor = "rgba(124, 58, 237, 0.4)";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, 2 * Math.PI);
    ctx.fillStyle = "#1e1b4b";
    ctx.fill();
    ctx.restore();

    for (let i = 0; i < players.length; i++) {
      const start = angle + i * segmentAngle;
      const end = start + segmentAngle;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();

      const isHighlight = highlightIdx === i;
      ctx.fillStyle = isHighlight ? "#fbbf24" : COLORS[i % COLORS.length];
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.save();
      const textAngle = start + segmentAngle / 2;
      const textR = r * 0.65;
      ctx.translate(cx + Math.cos(textAngle) * textR, cy + Math.sin(textAngle) * textR);
      ctx.rotate(textAngle + Math.PI / 2);

      const name = players[i].name;
      const maxLen = players.length > 8 ? 6 : 10;
      const displayName = name.length > maxLen ? name.substring(0, maxLen - 1) + "…" : name;
      const fontSize = players.length > 10 ? 10 : players.length > 6 ? 12 : 14;

      ctx.fillStyle = isHighlight ? "#1e1b4b" : "#fff";
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(displayName, 0, 0);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, 2 * Math.PI);
    ctx.fillStyle = "#1e1b4b";
    ctx.fill();
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, 2 * Math.PI);
    ctx.fillStyle = "#7c3aed";
    ctx.fill();

    const pointerSize = 18;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r - 6);
    ctx.lineTo(cx - pointerSize / 2, cy - r - pointerSize - 6);
    ctx.lineTo(cx + pointerSize / 2, cy - r - pointerSize - 6);
    ctx.closePath();
    ctx.fillStyle = "#fbbf24";
    ctx.fill();
    ctx.strokeStyle = "#92400e";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [players, segmentAngle]);

  useEffect(() => {
    draw(0);
  }, [draw]);

  const spin = useCallback(() => {
    if (spinning || done) return;
    setSpinning(true);

    const totalRotation = Math.PI * 2 * (8 + Math.random() * 6);
    const randomOffset = Math.random() * Math.PI * 2;
    const targetAngle = totalRotation + randomOffset;

    velocityRef.current = targetAngle;
    const startTime = performance.now();
    const duration = 4000 + Math.random() * 1500;

    const easeOut = (t: number) => {
      return 1 - Math.pow(1 - t, 4);
    };

    const animate = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOut(progress);

      angleRef.current = easedProgress * targetAngle;
      draw(angleRef.current);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        const finalAngle = angleRef.current % (Math.PI * 2);
        const pointerAngle = (Math.PI * 2 - finalAngle + Math.PI * 1.5) % (Math.PI * 2);
        const winnerIdx = Math.floor(pointerAngle / segmentAngle) % players.length;

        draw(angleRef.current, winnerIdx);
        setWinner(players[winnerIdx]);
        setSpinning(false);
        setDone(true);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
  }, [spinning, done, draw, players, segmentAngle]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-4" data-testid="spin-wheel-container">
      {title && (
        <h3 className="text-lg font-bold text-center" data-testid="spin-wheel-title">{title}</h3>
      )}
      <p className="text-sm text-muted-foreground text-center">
        {done ? (
          <span className="text-amber-500 font-semibold" data-testid="spin-wheel-result">
            🎉 {winner?.name} gets the bye!
          </span>
        ) : spinning ? (
          "Spinning..."
        ) : (
          "Spin to randomly select who gets the first-round bye"
        )}
      </p>
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="cursor-pointer"
          data-testid="spin-wheel-canvas"
          onClick={!spinning && !done ? spin : undefined}
        />
      </div>
      <div className="flex gap-3">
        {!spinning && !done && (
          <Button
            onClick={spin}
            className="bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90 shadow-md"
            data-testid="button-spin"
          >
            🎰 Spin the Wheel!
          </Button>
        )}
        {done && winner && (
          <Button
            onClick={() => onResult(winner)}
            className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-md"
            data-testid="button-confirm-bye"
          >
            ✓ Continue with {winner.name}'s bye
          </Button>
        )}
      </div>
    </div>
  );
}
