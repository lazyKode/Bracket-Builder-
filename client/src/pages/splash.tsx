import { useState, useEffect, useRef, useCallback } from "react";
import logoImg from "@assets/arm-wrestling-challenge-illustration-removebg-preview_1773901359407.png";

interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
  color: string;
  tx: number;
  ty: number;
}

let sparkleId = 0;

function SparkleOverlay() {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const colors = [
      "#fff",
      "#fbbf24",
      "#f59e0b",
      "#60a5fa",
      "#818cf8",
      "#c084fc",
      "#f87171",
      "#fb923c",
    ];

    const emit = () => {
      const count = 2 + Math.floor(Math.random() * 3);
      const newSparkles: Sparkle[] = [];
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 80;
        newSparkles.push({
          id: sparkleId++,
          x: 45 + Math.random() * 10,
          y: 30 + Math.random() * 15,
          size: 3 + Math.random() * 6,
          duration: 0.6 + Math.random() * 0.8,
          delay: Math.random() * 0.3,
          color: colors[Math.floor(Math.random() * colors.length)],
          tx: Math.cos(angle) * dist,
          ty: Math.sin(angle) * dist,
        });
      }
      setSparkles((prev) => [...prev, ...newSparkles]);
      setTimeout(() => {
        setSparkles((prev) =>
          prev.filter((s) => !newSparkles.find((n) => n.id === s.id))
        );
      }, 1800);
    };

    emit();
    intervalRef.current = setInterval(emit, 200);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {sparkles.map((s) => (
        <div
          key={s.id}
          className="absolute sparkle-particle"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            backgroundColor: s.color,
            boxShadow: `0 0 ${s.size * 2}px ${s.color}, 0 0 ${s.size * 4}px ${s.color}80`,
            borderRadius: "50%",
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
            "--sparkle-tx": `${s.tx}px`,
            "--sparkle-ty": `${s.ty}px`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function LightningBolt({ side }: { side: "left" | "right" }) {
  const [bolts, setBolts] = useState<{ id: number; d: string; opacity: number }[]>([]);
  const boltIdRef = useRef(0);

  useEffect(() => {
    const generate = () => {
      const startX = side === "left" ? 20 + Math.random() * 15 : 65 + Math.random() * 15;
      const startY = 25 + Math.random() * 20;
      let x = startX;
      let y = startY;
      let path = `M ${x} ${y}`;
      const segments = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < segments; i++) {
        x += (Math.random() - 0.5) * 8;
        y += 3 + Math.random() * 5;
        path += ` L ${x} ${y}`;
      }
      const id = boltIdRef.current++;
      setBolts((prev) => [...prev, { id, d: path, opacity: 0.6 + Math.random() * 0.4 }]);
      setTimeout(() => setBolts((prev) => prev.filter((b) => b.id !== id)), 200);
    };

    const interval = setInterval(generate, 300 + Math.random() * 400);
    return () => clearInterval(interval);
  }, [side]);

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      {bolts.map((b) => (
        <path
          key={b.id}
          d={b.d}
          stroke={side === "left" ? "#60a5fa" : "#f59e0b"}
          strokeWidth="0.4"
          fill="none"
          opacity={b.opacity}
          filter="url(#glow)"
        />
      ))}
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

export default function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  const finish = useCallback(() => onFinish(), [onFinish]);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 300);
    const t2 = setTimeout(() => setPhase("exit"), 3500);
    const t3 = setTimeout(finish, 4200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [finish]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden transition-opacity duration-700 ${
        phase === "exit" ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      data-testid="splash-screen"
      onClick={finish}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-gray-950 via-indigo-950/80 to-gray-950" />

      <div className="absolute inset-0 splash-bg-pulse" />

      <div
        className={`relative z-10 flex flex-col items-center transition-all duration-1000 ${
          phase === "enter"
            ? "opacity-0 scale-75"
            : phase === "hold"
            ? "opacity-100 scale-100"
            : "opacity-0 scale-110"
        }`}
      >
        <div className="relative">
          <div className="splash-image-glow absolute inset-0 rounded-2xl" />
          <img
            src={logoImg}
            alt="Arm Wrestling"
            className="relative w-[280px] sm:w-[360px] md:w-[420px] splash-arms-struggle drop-shadow-2xl"
            draggable={false}
          />
          <SparkleOverlay />
          <LightningBolt side="left" />
          <LightningBolt side="right" />

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="splash-impact-ring" />
          </div>
        </div>
      </div>

      <div
        className={`relative z-10 flex flex-col items-center -mt-4 transition-all duration-1000 ${
          phase === "enter"
            ? "opacity-0 translate-y-6"
            : phase === "hold"
            ? "opacity-100 translate-y-0"
            : "opacity-0 -translate-y-6"
        }`}
      >
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-center">
          <span className="splash-text-purple">ARM</span>
          <span className="text-white/15 mx-2 font-light">|</span>
          <span className="splash-text-gold">WRESTLING</span>
        </h1>
        <div className="h-px w-40 mx-auto mt-3 bg-gradient-to-r from-transparent via-purple-400/50 to-transparent" />
        <p className="text-sm text-gray-500 mt-2 tracking-[0.35em] uppercase font-semibold">
          Bracket Builder
        </p>
        <p className="text-sm text-gray-300 mt-4 tracking-[0.3em] uppercase font-bold splash-dev-credit">
          Developed by Alankar
        </p>

        <div className="flex items-center gap-2.5 mt-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full splash-loading-dot-v2"
              style={{ animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </div>
      </div>

      <p className="relative z-10 mt-auto mb-6 text-[11px] text-gray-700 tracking-widest uppercase">
        Tap to skip
      </p>
    </div>
  );
}
