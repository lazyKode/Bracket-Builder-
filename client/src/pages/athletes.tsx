import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ChevronDown, Crown, Search, Trophy, UserCircle, Users } from "lucide-react";
import { ordinal, type AthleteSummary } from "@shared/stats";
import { cn } from "@/lib/utils";

function winRate(a: AthleteSummary): string {
  const total = a.wins + a.losses;
  return total ? `${Math.round((a.wins / total) * 100)}%` : "–";
}

export default function AthletesPage() {
  const [search, setSearch] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { data: athletes, isLoading } = useQuery<AthleteSummary[]>({ queryKey: ["/api/athletes"], staleTime: 0 });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return athletes ?? [];
    return (athletes ?? []).filter(a => a.name.toLowerCase().includes(q) || a.clubs.some(c => c.toLowerCase().includes(q)));
  }, [athletes, search]);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-50 relative overflow-hidden">
        <div className="absolute inset-0 gradient-hero pointer-events-none opacity-50" />
        <div className="absolute bottom-0 left-0 right-0 h-[2px] status-bar-glow" />
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4 relative">
          <Link href="/">
            <Button size="icon" variant="ghost" className="hover:bg-primary/10" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary via-primary to-purple-700 flex items-center justify-center shrink-0 shadow-md shadow-primary/20">
            <Users className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="font-extrabold text-lg" data-testid="text-athletes-title">Athlete records</h1>
            <p className="text-[11px] text-muted-foreground">Across all of your tournaments, matched by name</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="relative max-w-sm mb-5">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or club…" className="pl-9" data-testid="input-athlete-search" />
        </div>

        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : !athletes?.length ? (
          <div className="rounded-xl border border-dashed border-primary/20 p-12 text-center">
            <UserCircle className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <h2 className="font-bold text-lg mb-1">No athletes yet</h2>
            <p className="text-sm text-muted-foreground">Records appear here once you add athletes to a tournament.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 bg-card overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]" data-testid="table-athletes">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40 text-left">
                  <th className="px-4 py-2.5 font-semibold">Athlete</th>
                  <th className="px-2 py-2.5 font-semibold text-center">Events</th>
                  <th className="px-2 py-2.5 font-semibold text-center">W-L</th>
                  <th className="px-2 py-2.5 font-semibold text-center">Win %</th>
                  <th className="px-2 py-2.5 font-semibold text-center text-amber-500" title="Class wins">Gold</th>
                  <th className="px-2 py-2.5 font-semibold text-center text-gray-400">Silver</th>
                  <th className="px-2 py-2.5 font-semibold text-center text-amber-700">Bronze</th>
                  <th className="px-2 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const open = openKey === a.key;
                  return (
                    <Fragment key={a.key}>
                      <tr
                        className={cn("border-t border-border/40 cursor-pointer hover:bg-muted/30 transition-colors", open && "bg-primary/[0.04]")}
                        onClick={() => setOpenKey(open ? null : a.key)}
                        data-testid={`row-athlete-${a.key}`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            {a.photoUrl ? (
                              <img src={a.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-border/50 shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                                <UserCircle className="w-4 h-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-semibold truncate flex items-center gap-1.5">
                                {a.name}
                                {a.overallTitles > 0 && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-amber-600 font-bold" title="Champion of Champions titles">
                                    <Crown className="w-3 h-3" />{a.overallTitles}
                                  </span>
                                )}
                              </p>
                              {a.clubs.length > 0 && <p className="text-[11px] text-muted-foreground truncate">{a.clubs.join(", ")}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 text-center tabular-nums" title={`${a.entries} class entries`}>{a.tournaments}</td>
                        <td className="px-2 text-center font-mono tabular-nums">{a.wins}-{a.losses}</td>
                        <td className="px-2 text-center tabular-nums text-muted-foreground">{winRate(a)}</td>
                        <td className="px-2 text-center tabular-nums font-semibold">{a.gold || ""}</td>
                        <td className="px-2 text-center tabular-nums">{a.silver || ""}</td>
                        <td className="px-2 text-center tabular-nums">{a.bronze || ""}</td>
                        <td className="px-2"><ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")} /></td>
                      </tr>
                      {open && (
                        <tr className="bg-primary/[0.02]">
                          <td colSpan={8} className="px-4 pb-3 pt-1">
                            <ul className="divide-y divide-border/30" data-testid={`history-${a.key}`}>
                              {a.results.map((r, i) => (
                                <li key={i} className="flex items-center gap-3 py-1.5 text-[13px]">
                                  <span className="w-20 text-[11px] text-muted-foreground shrink-0">{new Date(r.date).toLocaleDateString()}</span>
                                  <Link href={`/tournament/${r.tournamentId}`} className="font-medium hover:text-primary hover:underline truncate">{r.tournamentName}</Link>
                                  <span className="text-muted-foreground truncate hidden sm:inline">{r.category}</span>
                                  <span className="ml-auto font-mono text-[11px] text-muted-foreground shrink-0">{r.wins}-{r.losses}</span>
                                  <span className={cn("w-24 text-right shrink-0 flex items-center justify-end gap-1", r.rank && r.rank <= 3 && "font-semibold")}>
                                    {r.overallChampion && <Crown className="w-3 h-3 text-amber-500" />}
                                    {r.rank === 1 && <Trophy className="w-3 h-3 text-amber-500" />}
                                    {r.rank ? `${ordinal(r.rank)} of ${r.fieldSize}` : "in progress"}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No athlete matches "{search}".</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
