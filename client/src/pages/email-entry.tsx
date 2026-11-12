import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, ArrowRight, Trophy, Zap } from "lucide-react";

export default function EmailEntry({ onSubmit }: { onSubmit: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email address");
      return;
    }
    setError("");
    onSubmit(trimmed);
  };

  const handleSkip = () => {
    onSubmit("");
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-background"
      data-testid="email-entry-screen"
    >
      <div className="absolute inset-0 gradient-hero opacity-60" />
      <div className="absolute top-1/4 left-1/3 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/3 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl" />

      <div className="w-full max-w-md mx-4 animate-in fade-in slide-in-from-bottom-4 duration-500 relative z-10">
        <div className="rounded-2xl border border-primary/15 bg-card shadow-2xl shadow-primary/5 p-8">
          <div className="flex flex-col items-center gap-2 mb-8">
            <div className="relative mb-2">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary via-primary to-purple-700 flex items-center justify-center glow-accent">
                <Trophy className="w-8 h-8 text-primary-foreground" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-md">
                <Zap className="w-3 h-3 text-white" />
              </div>
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-center">
              <span className="bg-gradient-to-r from-primary via-purple-500 to-primary bg-clip-text text-transparent">ARM WRESTLING</span>
            </h2>
            <p className="text-sm font-medium text-muted-foreground">Bracket Builder</p>
            <p className="text-sm text-muted-foreground text-center max-w-xs mt-1">
              Enter your email to receive tournament results when each tournament completes
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                className="pl-10 h-11 border-primary/15 focus:border-primary/30"
                data-testid="input-user-email"
                autoFocus
              />
            </div>
            {error && (
              <p className="text-xs text-destructive" data-testid="text-email-error">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full h-11 gap-2 bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90 shadow-lg shadow-primary/20"
              data-testid="button-submit-email"
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </Button>
          </form>

          <button
            type="button"
            onClick={handleSkip}
            className="w-full mt-4 text-sm text-muted-foreground hover:text-primary transition-colors text-center py-2"
            data-testid="button-skip-email"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
