import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Clock, LayoutGrid, Minus, Plus, UserCircle, Hourglass } from "lucide-react";
import type { Match, Participant } from "@shared/schema";
import { MAX_TABLES } from "@shared/constants";
import { buildQueue, progress, shortCategory, type QueueItem } from "@shared/stats";

export interface MatchControlData {
  status: string;
  participants: Participant[];
  matches: Match[];
  weightCategories: string[] | null;
  tableCount: number;
  autoTables: boolean;
}

interface MatchControlProps {
  tournament: MatchControlData;
  /** Organiser callbacks. Leave them all out for the read-only spectator version. */
  onSelectWinner?: (matchId: string, winnerId: string) => void;
  onFoul?: (matchId: string, participantId: string) => void;
  onAssign?: (matchId: string, tableNumber: number | null) => void;
  onSettings?: (settings: { tableCount?: number; autoTables?: boolean }) => void;
  busy?: boolean;
  /** Big-screen sizing. */
  large?: boolean;
  /** Tables above the queue instead of side by side (narrow column on the big screen). */
  stacked?: boolean;
  upNextLimit?: number;
}

function Avatar({ p, large }: { p: Participant | null; large?: boolean }) {
  const dims = large ? "w-10 h-10" : "w-8 h-8";
  if (p?.photoUrl) return <img src={p.photoUrl} alt="" className={cn(dims, "rounded-full object-cover border border-border/50 shrink-0")} />;
  return (
    <div className={cn(dims, "rounded-full bg-muted flex items-center justify-center shrink-0")}>
      <UserCircle className={cn(large ? "w-6 h-6" : "w-4 h-4", "text-muted-foreground")} />
    </div>
  );
}

function TableCard({ table, item, large, onSelectWinner, onFoul, onAssign, busy }: {
  table: number; item: QueueItem | null; large?: boolean;
  onSelectWinner?: MatchControlProps["onSelectWinner"];
  onFoul?: MatchControlProps["onFoul"];
  onAssign?: MatchControlProps["onAssign"];
  busy?: boolean;
}) {
  const interactive = !!onSelectWinner;

  function Side({ p, fouls }: { p: Participant | null; fouls: number }) {
    if (!p || !item) return null;
    const body = (
      <>
        <Avatar p={p} large={large} />
        <span className="min-w-0 flex-1 text-left">
          <span className={cn("block font-semibold truncate", large ? "text-xl" : "text-sm")}>{p.name}</span>
          {p.club && <span className={cn("block text-muted-foreground truncate", large ? "text-sm" : "text-[10px]")}>{p.club}</span>}
        </span>
        {fouls > 0 && (
          <span className={cn("font-bold px-1.5 rounded bg-amber-500/20 text-amber-600 shrink-0", large ? "text-sm" : "text-[10px]")}>F{fouls}</span>
        )}
      </>
    );
    if (!interactive) return <div className="flex items-center gap-2.5 px-3 py-2">{body}</div>;
    return (
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSelectWinner!(item.match.id, p.id)}
          className="flex items-center gap-2.5 px-3 py-2 flex-1 min-w-0 rounded-md hover:bg-primary/10 transition-colors disabled:opacity-60"
          title={`${p.name} wins`}
          data-testid={`button-table-winner-${item.match.id}-${p.id}`}
        >
          {body}
        </button>
        {onFoul && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onFoul(item.match.id, p.id)}
            className="w-6 h-6 rounded-sm text-[10px] font-bold shrink-0 bg-red-500/10 hover:bg-red-500/25 text-red-500 transition-colors disabled:opacity-40"
            title={`Add foul to ${p.name}`}
            data-testid={`button-table-foul-${item.match.id}-${p.id}`}
          >
            F
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card overflow-hidden min-w-0",
        item ? "border-amber-500/50 shadow-md shadow-amber-500/5" : "border-dashed border-border/60",
      )}
      data-testid={`table-card-${table}`}
    >
      <div className={cn("flex items-center gap-2 px-3 py-1.5", item ? "bg-amber-500/10" : "bg-muted/30")}>
        <span className={cn("font-extrabold uppercase tracking-wider shrink-0", large ? "text-base" : "text-[11px]", item ? "text-amber-600" : "text-muted-foreground")}>
          Table {table}
        </span>
        {item && (
          <span className={cn("ml-auto min-w-0 text-muted-foreground truncate", large ? "text-sm" : "text-[10px]")}>
            <span className="font-mono font-semibold text-foreground">#{item.match.matchNumber ?? "–"}</span>
            {" · "}{shortCategory(item.category) || item.category}{" · "}{item.roundLabel}
          </span>
        )}
        {item && onAssign && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0"
            onClick={() => onAssign(item.match.id, null)}
            title="Send this match back to the queue"
            data-testid={`button-unassign-${item.match.id}`}
          >
            back to queue
          </button>
        )}
      </div>
      {item ? (
        <div className="py-1">
          <Side p={item.p1} fouls={item.match.participant1Fouls} />
          <div className={cn("text-center font-bold text-muted-foreground/60 leading-none", large ? "text-xs" : "text-[9px]")}>VS</div>
          <Side p={item.p2} fouls={item.match.participant2Fouls} />
        </div>
      ) : (
        <div className={cn("flex items-center justify-center text-muted-foreground", large ? "h-28 text-base" : "h-[84px] text-xs")}>
          Free
        </div>
      )}
    </div>
  );
}

export function MatchControl({
  tournament, onSelectWinner, onFoul, onAssign, onSettings, busy, large, stacked, upNextLimit = 6,
}: MatchControlProps) {
  const queue = useMemo(() => buildQueue(tournament), [tournament]);
  const prog = useMemo(() => progress(tournament), [tournament]);
  const live = tournament.status === "active" || tournament.status === "finals";
  if (!live) return null;

  const interactive = !!onSelectWinner;
  const manual = interactive && !tournament.autoTables;
  const pct = prog.total ? Math.round((prog.played / prog.total) * 100) : 0;
  const shown = queue.upNext.slice(0, upNextLimit);
  const freeTables = queue.tables.filter(t => !t.item).map(t => t.table);

  return (
    <section className="rounded-xl border border-border/60 bg-card/60 overflow-hidden" data-testid="match-control">
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-primary/10 flex items-center justify-center shrink-0">
          <LayoutGrid className="w-4 h-4 text-amber-600" />
        </div>
        <div className="min-w-0 mr-auto">
          <h3 className={cn("font-bold", large ? "text-xl" : "text-sm")}>{interactive ? "Match control" : "On the tables"}</h3>
          <p className={cn("text-muted-foreground", large ? "text-sm" : "text-[11px]")} data-testid="text-progress">
            {prog.played} of {prog.total} matches played
          </p>
        </div>
        {onSettings && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground mr-1">Tables</span>
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={busy || tournament.tableCount <= 1}
                onClick={() => onSettings({ tableCount: tournament.tableCount - 1 })} data-testid="button-tables-minus" aria-label="Fewer tables">
                <Minus className="w-3 h-3" />
              </Button>
              <span className="w-5 text-center text-sm font-bold tabular-nums" data-testid="text-table-count">{tournament.tableCount}</span>
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={busy || tournament.tableCount >= MAX_TABLES}
                onClick={() => onSettings({ tableCount: tournament.tableCount + 1 })} data-testid="button-tables-plus" aria-label="More tables">
                <Plus className="w-3 h-3" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="auto-tables" checked={tournament.autoTables} disabled={busy}
                onCheckedChange={(checked) => onSettings({ autoTables: checked })} data-testid="switch-auto-tables" />
              <Label htmlFor="auto-tables" className="text-[11px] text-muted-foreground cursor-pointer">Auto-call next match</Label>
            </div>
          </div>
        )}
      </div>
      <div className="h-1 bg-muted">
        <div className="h-full bg-gradient-to-r from-primary to-purple-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      <div className={cn("p-4 grid gap-4 grid-cols-1", !stacked && "lg:grid-cols-[3fr_2fr]")}>
        <div className={cn("grid gap-3 content-start min-w-0", stacked ? queue.tables.length > 3 && "grid-cols-2" : queue.tables.length > 1 && "sm:grid-cols-2")}>
          {queue.tables.map(t => (
            <TableCard key={t.table} table={t.table} item={t.item} large={large}
              onSelectWinner={onSelectWinner} onFoul={onFoul} onAssign={manual ? onAssign : undefined} busy={busy} />
          ))}
        </div>

        <div className="min-w-0" data-testid="up-next">
          <h4 className={cn("font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-2", large ? "text-sm" : "text-[11px]")}>
            <Clock className={large ? "w-4 h-4" : "w-3.5 h-3.5"} />
            Up next
            {queue.upNext.length > shown.length && (
              <span className="font-normal normal-case tracking-normal">· {queue.upNext.length - shown.length} more waiting</span>
            )}
          </h4>
          {shown.length === 0 ? (
            <p className={cn("text-muted-foreground rounded-lg border border-dashed border-border/60 px-3 py-4 text-center", large ? "text-base" : "text-xs")}>
              No matches waiting. The next ones appear as soon as both players are known.
            </p>
          ) : (
            <ol className="rounded-lg border border-border/50 divide-y divide-border/40 overflow-hidden bg-card">
              {shown.map(item => (
                <li key={item.match.id} className={cn("flex items-center gap-2.5 px-3", large ? "py-2.5" : "py-2")} data-testid={`queue-item-${item.match.id}`}>
                  <span className={cn("font-mono font-bold text-primary shrink-0", large ? "text-lg w-12" : "text-xs w-8")}>#{item.match.matchNumber ?? "–"}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-medium truncate", large ? "text-lg" : "text-[13px]")}>
                      {item.p1?.name} <span className="text-muted-foreground font-normal">vs</span> {item.p2?.name}
                    </p>
                    <p className={cn("text-muted-foreground truncate", large ? "text-sm" : "text-[10px]")}>
                      {shortCategory(item.category) || item.category} · {item.roundLabel}
                    </p>
                  </div>
                  {item.waitingOnAthlete && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-500/10 rounded px-1.5 py-0.5 shrink-0" title="One of these athletes is competing on another table right now">
                      <Hourglass className="w-3 h-3" /> athlete busy
                    </span>
                  )}
                  {manual && onAssign && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 shrink-0" disabled={busy} data-testid={`button-assign-${item.match.id}`}>
                          Send to table
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {queue.tables.map(t => (
                          <DropdownMenuItem key={t.table} onClick={() => onAssign(item.match.id, t.table)}>
                            Table {t.table}{freeTables.includes(t.table) ? "" : " (replace current match)"}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              ))}
            </ol>
          )}
          {interactive && (
            <p className="text-[10px] text-muted-foreground mt-2">
              {tournament.autoTables
                ? "Click the winner on a table card. The next match in the queue is called to the free table automatically."
                : "Auto-call is off: send matches to tables yourself."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
