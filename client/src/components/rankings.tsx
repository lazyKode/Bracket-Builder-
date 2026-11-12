import { Medal, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { TEAM_POINTS, type RankingRow, type TeamRow } from "@shared/stats";

const medalColors: Record<number, string> = {
  1: "text-amber-500",
  2: "text-gray-400",
  3: "text-amber-700 dark:text-amber-600",
};

export function RankingsTable({ rankings, title }: { rankings: RankingRow[]; title: string }) {
  if (!rankings.length) return null;

  return (
    <div className="space-y-2" data-testid={`rankings-${title}`}>
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Medal className="w-3.5 h-3.5 text-primary" />
        {title} — Rankings
      </h4>
      <div className="rounded-lg border border-primary/10 overflow-hidden">
        {rankings.map((r, idx) => (
          <div
            key={r.participantId}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 text-sm",
              idx !== rankings.length - 1 && "border-b border-border/30",
              r.rank === 1 && "bg-amber-500/8",
              r.rank === 2 && "bg-gray-500/5",
              r.rank === 3 && "bg-amber-700/5",
            )}
            data-testid={`ranking-${r.participantId}`}
          >
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
              r.rank <= 3 ? "bg-muted" : "bg-transparent",
            )}>
              {r.rank <= 3 ? (
                <Trophy className={cn("w-3.5 h-3.5", medalColors[r.rank])} />
              ) : (
                <span className="text-muted-foreground">{r.rank}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className={cn("block truncate", r.rank === 1 && "font-bold", r.rank <= 3 && "font-semibold")}>{r.name}</span>
              {r.club && <span className="block text-[10px] text-muted-foreground truncate">{r.club}</span>}
            </div>
            <span className="text-[11px] text-muted-foreground font-mono tabular-nums shrink-0" title="Wins - losses">
              {r.wins}-{r.losses}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono w-6 text-right shrink-0">#{r.rank}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TeamStandingsTable({ teams }: { teams: TeamRow[] }) {
  if (!teams.length) return null;
  return (
    <div className="space-y-2" data-testid="team-standings">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5 text-primary" />
        Team standings
      </h4>
      <div className="rounded-lg border border-primary/10 overflow-hidden">
        <div className="grid grid-cols-[2rem_1fr_3rem_2rem_2rem_2rem] gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
          <span>#</span><span>Club</span><span className="text-right">Pts</span>
          <span className="text-center text-amber-500">G</span><span className="text-center text-gray-400">S</span><span className="text-center text-amber-700">B</span>
        </div>
        {teams.map((t, idx) => (
          <div key={t.club} className="grid grid-cols-[2rem_1fr_3rem_2rem_2rem_2rem] gap-2 px-3 py-2 text-sm border-t border-border/30 items-center" data-testid={`team-row-${t.club}`}>
            <span className="text-muted-foreground text-xs font-mono">{idx + 1}</span>
            <span className={cn("truncate", idx === 0 && t.points > 0 && "font-bold")}>
              {t.club} <span className="text-[10px] text-muted-foreground font-normal">· {t.entries} {t.entries === 1 ? "entry" : "entries"}</span>
            </span>
            <span className="text-right font-mono tabular-nums font-semibold">{t.points}</span>
            <span className="text-center font-mono tabular-nums text-xs">{t.gold}</span>
            <span className="text-center font-mono tabular-nums text-xs">{t.silver}</span>
            <span className="text-center font-mono tabular-nums text-xs">{t.bronze}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Points per class for places 1–{TEAM_POINTS.length}: {TEAM_POINTS.join(" · ")}
      </p>
    </div>
  );
}
