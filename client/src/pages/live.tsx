import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useLiveUpdates } from "@/hooks/use-live";
import { IS_LOCAL } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BracketView, ChampionOfChampionsBracket } from "@/components/bracket-view";
import { MatchControl } from "@/components/match-control";
import { RankingsTable, TeamStandingsTable } from "@/components/rankings";
import { Check, Maximize, MonitorPlay, Search, Trophy, X } from "lucide-react";
import type { Participant, PublicTournament } from "@shared/schema";
import { COC } from "@shared/bracket";
import {
  categoryMatches, computeCategoryRankings, computeTeamStandings, isCategoryComplete, isReadyMatch,
  ordinal, playerRecord, recentResults, shortCategory,
} from "@shared/stats";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: string }) {
  if (status === "setup") return <Badge variant="secondary" className="border-0 bg-slate-500/15 text-slate-600 dark:text-slate-300">Not started</Badge>;
  if (status === "active") return <Badge className="border-0 bg-blue-500/15 text-blue-600 dark:text-blue-300">In progress</Badge>;
  if (status === "awaiting_coc") return <Badge className="border-0 bg-amber-500/15 text-amber-600 dark:text-amber-300">Classes complete</Badge>;
  if (status === "finals") return <Badge className="border-0 bg-amber-500/15 text-amber-600 dark:text-amber-300">Champion of Champions</Badge>;
  if (status === "completed") return <Badge className="border-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">Final results</Badge>;
  return null;
}

function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" data-testid="live-indicator">
      <span className="relative flex h-2 w-2">
        {connected && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />}
        <span className={cn("relative inline-flex rounded-full h-2 w-2", connected ? "bg-emerald-500" : "bg-muted-foreground/50")} />
      </span>
      <span className={connected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{connected ? "Live" : "Reconnecting"}</span>
    </span>
  );
}

function RecentResults({ tournament, limit, large }: { tournament: PublicTournament; limit: number; large?: boolean }) {
  const results = useMemo(() => recentResults(tournament, limit), [tournament, limit]);
  if (!results.length) return null;
  return (
    <div data-testid="recent-results">
      <h3 className={cn("font-bold uppercase tracking-wider text-muted-foreground mb-2", large ? "text-sm" : "text-[11px]")}>Latest results</h3>
      <ol className="rounded-lg border border-border/50 divide-y divide-border/40 bg-card overflow-hidden">
        {results.map(r => {
          const p1Won = r.match.winnerId === r.match.participant1Id;
          const winner = p1Won ? r.p1 : r.p2;
          const loser = p1Won ? r.p2 : r.p1;
          return (
            <li key={r.match.id} className={cn("flex items-center gap-2.5 px-3", large ? "py-2.5" : "py-2")}>
              <span className={cn("font-mono text-muted-foreground shrink-0", large ? "text-base w-12" : "text-[11px] w-8")}>#{r.match.matchNumber ?? "–"}</span>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate", large ? "text-lg" : "text-[13px]")}>
                  <span className="font-semibold">{winner?.name}</span>
                  <span className="text-muted-foreground"> def. {loser?.name}</span>
                  {r.match.winMethod === "fouls" && <span className="text-red-500 text-[10px] font-bold ml-1.5">DQ</span>}
                </p>
                <p className={cn("text-muted-foreground truncate", large ? "text-sm" : "text-[10px]")}>
                  {shortCategory(r.category) || r.category} · {r.roundLabel}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Lets a spectator type a name and see where that athlete stands right now. */
function AthleteLookup({ tournament }: { tournament: PublicTournament }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const hits = q.length < 2 ? [] : tournament.participants.filter(p => p.name.toLowerCase().includes(q)).slice(0, 6);
  const nameOf = (id: string | null) => tournament.participants.find(p => p.id === id)?.name ?? "TBD";

  function statusOf(p: Participant): string {
    const own = categoryMatches(tournament.matches, p.weightCategory).concat(tournament.matches.filter(m => m.bracket === COC));
    const mine = own.filter(m => m.participant1Id === p.id || m.participant2Id === p.id);
    const next = mine.find(isReadyMatch);
    if (next) {
      const opponent = nameOf(next.participant1Id === p.id ? next.participant2Id : next.participant1Id);
      return next.tableNumber != null
        ? `Now on table ${next.tableNumber} vs ${opponent} (match #${next.matchNumber})`
        : `Next: match #${next.matchNumber} vs ${opponent}`;
    }
    if (mine.some(m => !m.winnerId)) return "Through to the next round, waiting for an opponent";
    const rank = computeCategoryRankings(tournament.matches, tournament.participants, p.weightCategory).find(r => r.participantId === p.id)?.rank;
    if (rank) return rank === 1 ? "Champion" : `Finished ${ordinal(rank)}`;
    if (!mine.length) return "Bracket not drawn yet";
    return "Eliminated";
  }

  return (
    <div data-testid="athlete-lookup">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Find an athlete…"
          className="pl-9 pr-9 h-10"
          data-testid="input-athlete-lookup"
        />
        {query && (
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setQuery("")} aria-label="Clear">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {q.length >= 2 && (
        <ul className="mt-2 rounded-lg border border-border/50 divide-y divide-border/40 bg-card overflow-hidden">
          {hits.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No athlete with that name.</li>}
          {hits.map(p => {
            const rec = playerRecord(categoryMatches(tournament.matches, p.weightCategory), p.id);
            return (
              <li key={p.id} className="px-3 py-2.5" data-testid={`lookup-${p.id}`}>
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-sm">{p.name}</span>
                  {p.club && <span className="text-[11px] text-muted-foreground truncate">{p.club}</span>}
                  <span className="ml-auto text-[11px] font-mono text-muted-foreground shrink-0">{rec.wins}-{rec.losses}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{p.weightCategory}</p>
                <p className="text-xs mt-0.5 text-primary font-medium">{statusOf(p)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Scales its content down (or slightly up) so it always fits the box it is given. */
function FitToBox({ children, maxScale = 1.3 }: { children: React.ReactNode; maxScale?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const w = inner.current.scrollWidth;
      const h = inner.current.scrollHeight;
      if (!w || !h) return;
      setScale(Math.min(maxScale, outer.current.clientWidth / w, outer.current.clientHeight / h));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [maxScale]);

  return (
    <div ref={outer} className="w-full h-full overflow-hidden">
      <div ref={inner} className="w-max origin-top-left" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

interface Slide { key: string; title: string; render: () => React.ReactNode }

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const SLIDE_SECONDS = 12;

/** Full-screen layout for a TV or projector: tables and queue on top, rotating brackets and standings below. */
function BigScreen({ tournament, connected, onExit }: { tournament: PublicTournament; connected: boolean; onExit: () => void }) {
  const clock = useClock();
  const categories = tournament.weightCategories ?? [];
  const running = tournament.status === "active" || tournament.status === "finals";
  const hasCoc = tournament.matches.some(m => m.bracket === COC);

  const slides = useMemo<Slide[]>(() => {
    const list: Slide[] = [];
    if (hasCoc) {
      list.push({ key: "coc", title: "Champion of Champions", render: () => <div className="p-2"><ChampionOfChampionsBracket tournament={tournament} /></div> });
    }
    for (const cat of categories) {
      const matches = categoryMatches(tournament.matches, cat);
      if (!matches.length) continue;
      if (isCategoryComplete(tournament.matches, cat)) {
        const rankings = computeCategoryRankings(tournament.matches, tournament.participants, cat).slice(0, 8);
        list.push({ key: `rank-${cat}`, title: `${cat} · final standings`, render: () => <div className="w-[520px] p-2"><RankingsTable rankings={rankings} title={cat} /></div> });
        continue;
      }
      // One slide per half of the bracket keeps the names readable from across the hall.
      list.push({ key: `winners-${cat}`, title: cat, render: () => <div className="p-2"><BracketView tournament={tournament} weightCategory={cat} show="winners" /></div> });
      if (matches.some(m => m.bracket === "losers" && (m.participant1Id || m.participant2Id))) {
        list.push({ key: `losers-${cat}`, title: cat, render: () => <div className="p-2"><BracketView tournament={tournament} weightCategory={cat} show="losers" /></div> });
      }
    }
    const teams = computeTeamStandings(tournament).filter(t => t.points > 0).slice(0, 8);
    if (teams.length) list.push({ key: "teams", title: "Team standings", render: () => <div className="w-[520px] p-2"><TeamStandingsTable teams={teams} /></div> });
    return list;
  }, [tournament, categories, hasCoc]);

  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => setIndex(i => i + 1), SLIDE_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [slides.length]);
  const slide = slides.length ? slides[index % slides.length] : null;
  const tableCount = Math.max(1, tournament.tableCount ?? 1);

  return (
    <div className="dark">
      <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden" data-testid="big-screen">
        <header className="flex items-center gap-4 px-8 py-4 border-b border-border/60 shrink-0">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary via-primary to-purple-700 flex items-center justify-center shadow-lg shadow-primary/30">
            <Trophy className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight truncate" data-testid="text-live-title">{tournament.name}</h1>
          <StatusBadge status={tournament.status} />
          <div className="ml-auto flex items-center gap-5 shrink-0">
            <LiveDot connected={connected} />
            <span className="text-3xl font-bold tabular-nums">{clock}</span>
            <Button size="icon" variant="ghost" className="opacity-40 hover:opacity-100" title="Full screen" aria-label="Full screen"
              onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
              <Maximize className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="opacity-40 hover:opacity-100" onClick={onExit} title="Exit big-screen mode" aria-label="Exit big-screen mode" data-testid="button-exit-tv">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </header>

        <div className={cn("flex-1 min-h-0 grid gap-6 p-6", running ? "grid-cols-[minmax(26rem,32%)_1fr]" : "grid-cols-[1fr_24rem]")}>
          {running && (
            <div className="min-h-0 min-w-0 overflow-hidden flex flex-col gap-5">
              <MatchControl tournament={tournament} large stacked upNextLimit={tableCount <= 2 ? 4 : tableCount <= 4 ? 3 : 2} />
              <div className="min-h-0 overflow-hidden">
                <RecentResults tournament={tournament} limit={tableCount <= 2 ? 4 : 2} large />
              </div>
            </div>
          )}
          <div className="min-h-0 min-w-0 flex flex-col rounded-xl border border-border/60 bg-card/40 p-5">
            {slide ? (
              <>
                <div className="flex items-center gap-3 mb-3 shrink-0">
                  <h2 className="text-2xl font-bold truncate" data-testid="text-slide-title">{slide.title}</h2>
                  {slides.length > 1 && (
                    <div className="ml-auto flex gap-1.5">
                      {slides.map((s, i) => (
                        <span key={s.key} className={cn("h-1.5 rounded-full transition-all", i === index % slides.length ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30")} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-h-0" key={slide.key}>
                  <FitToBox maxScale={1.6}>{slide.render()}</FitToBox>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-xl">Brackets will appear here once the first class starts.</div>
            )}
          </div>
          {!running && (
            <div className="min-h-0 min-w-0 overflow-hidden">
              <RecentResults tournament={tournament} limit={9} large />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LivePage() {
  const { token } = useParams<{ token: string }>();
  const [tv, setTv] = useState(() => new URLSearchParams(window.location.search).get("tv") === "1");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/public", token] });
  const connected = useLiveUpdates(token ? `/api/public/${token}/stream` : null, refresh, refresh);

  const { data: tournament, isLoading, error } = useQuery<PublicTournament>({
    queryKey: ["/api/public", token],
    // Polling is only a fallback for when the live channel is down.
    refetchInterval: connected ? 60000 : 10000,
  });

  useEffect(() => {
    if (tournament?.name) document.title = `${tournament.name} — Live`;
  }, [tournament?.name]);

  function setMode(next: boolean) {
    setTv(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("tv", "1"); else url.searchParams.delete("tv");
    window.history.replaceState(null, "", url.toString());
    if (!next && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Skeleton className="h-10 w-72 mb-6" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (!tournament || error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
            <Trophy className="w-7 h-7 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold mb-1" data-testid="text-live-missing">This live link is not active</h1>
          <p className="text-sm text-muted-foreground">The organiser may have turned sharing off or created a new link. Ask them for the current one.</p>
        </div>
      </div>
    );
  }

  // In the offline app the big screen was opened from the organiser's page: closing it goes back there.
  if (tv) return <BigScreen tournament={tournament} connected={connected} onExit={() => (IS_LOCAL ? window.history.back() : setMode(false))} />;

  const categories = tournament.weightCategories ?? [];
  const hasCategories = categories.length > 0;
  const started = tournament.matches.length > 0;
  const hasCoc = tournament.matches.some(m => m.bracket === COC);
  const teams = computeTeamStandings(tournament).filter(t => t.points > 0);
  const firstLive = categories.find(c => categoryMatches(tournament.matches, c).length && !isCategoryComplete(tournament.matches, c))
    ?? categories.find(c => categoryMatches(tournament.matches, c).length) ?? categories[0];

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-50 relative overflow-hidden">
        <div className="absolute inset-0 gradient-hero pointer-events-none opacity-50" />
        <div className="absolute bottom-0 left-0 right-0 h-[2px] status-bar-glow" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 relative flex-wrap">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary via-primary to-purple-700 flex items-center justify-center shrink-0 shadow-md shadow-primary/20">
            <Trophy className="w-4 h-4 text-primary-foreground" />
          </div>
          <h1 className="font-extrabold text-lg truncate min-w-0" data-testid="text-live-title">{tournament.name}</h1>
          <StatusBadge status={tournament.status} />
          <div className="ml-auto flex items-center gap-3">
            <LiveDot connected={connected} />
            <Button variant="outline" size="sm" className="hidden md:inline-flex border-primary/20" onClick={() => setMode(true)} data-testid="button-enter-tv">
              <MonitorPlay className="w-3.5 h-3.5 mr-1.5" /> Big screen
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {!started && (
          <div className="rounded-xl border border-dashed border-primary/20 p-8 text-center" data-testid="live-not-started">
            <h2 className="font-bold text-lg mb-1">The brackets have not been drawn yet</h2>
            <p className="text-sm text-muted-foreground mb-4">Keep this page open. It updates by itself as soon as the first class starts.</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {categories.map(cat => (
                <Badge key={cat} variant="secondary" className="font-normal">
                  {cat} · {tournament.participants.filter(p => p.weightCategory === cat).length}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {started && (
          <>
            <div className="grid gap-6 lg:grid-cols-[1fr_20rem] items-start">
              <div className="space-y-6 min-w-0">
                <MatchControl tournament={tournament} />
                {tournament.status === "awaiting_coc" && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
                    All running classes are complete. Waiting for the organiser to start the next stage.
                  </p>
                )}
                <AthleteLookup tournament={tournament} />
              </div>
              <RecentResults tournament={tournament} limit={6} />
            </div>

            {hasCoc && <ChampionOfChampionsBracket tournament={tournament} />}

            {hasCategories ? (
              <Tabs defaultValue={firstLive} className="w-full">
                <TabsList className="mb-4 flex-wrap h-auto gap-1" data-testid="tabs-live-categories">
                  {categories.map(cat => (
                    <TabsTrigger key={cat} value={cat} data-testid={`tab-live-${cat}`}>
                      {cat}
                      {isCategoryComplete(tournament.matches, cat) && <Check className="w-3 h-3 ml-1 text-green-500" />}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {categories.map(cat => {
                  const catStarted = categoryMatches(tournament.matches, cat).length > 0;
                  const rankings = computeCategoryRankings(tournament.matches, tournament.participants, cat);
                  return (
                    <TabsContent key={cat} value={cat} className="space-y-6">
                      {!catStarted ? (
                        <p className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                          {cat} has not started yet ({tournament.participants.filter(p => p.weightCategory === cat).length} entered).
                        </p>
                      ) : (
                        <>
                          <BracketView tournament={tournament} weightCategory={cat} />
                          {rankings.length > 0 && <div className="max-w-md"><RankingsTable rankings={rankings} title={cat} /></div>}
                        </>
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            ) : (
              <BracketView tournament={tournament} />
            )}

            {teams.length > 0 && <div className="max-w-md"><TeamStandingsTable teams={teams} /></div>}
          </>
        )}

        <p className="text-center text-[11px] text-muted-foreground pt-4">Arm Wrestling Bracket Builder · live view</p>
      </div>
    </div>
  );
}
