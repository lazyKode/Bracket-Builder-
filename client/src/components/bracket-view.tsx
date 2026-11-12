import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Match, Participant } from "@shared/schema";
import { BracketEngine, COC, isStandardDoubleElim } from "@shared/bracket";
import { categoryMatches, visibleMatches } from "@shared/stats";
import { BYE_H, CARD_H, CARD_W, COL_GAP, HEADER_H, buildColumns, computeLayout, type RoundColumn } from "@/lib/bracket-layout";
import { Trophy, Crown, Sparkles } from "lucide-react";

/** The parts of a tournament the bracket needs; satisfied by both the organiser and the public payload. */
export interface BracketData {
  status: string;
  participants: Participant[];
  matches: Match[];
}

interface BracketViewProps {
  tournament: BracketData;
  /** Omit to render a read-only bracket (spectator view). */
  onSelectWinner?: (matchId: string, winnerId: string) => void;
  onFoul?: (matchId: string, participantId: string) => void;
  foulPending?: boolean;
  weightCategory?: string | null;
  /** Draw only part of the bracket (used by the big-screen slides). */
  show?: "all" | "winners" | "losers";
}

type SlotState = "filled" | "pending" | "dead";

function getParticipant(participants: Participant[], id: string | null | undefined) {
  if (!id) return null;
  return participants.find(p => p.id === id) ?? null;
}

interface MatchCardProps {
  match: Match;
  participants: Participant[];
  isActive: boolean;
  label?: string;
  highlight?: boolean;
  onSelectWinner?: (matchId: string, winnerId: string) => void;
  onFoul?: (matchId: string, participantId: string) => void;
  foulPending?: boolean;
  compact?: boolean;
  slotStates?: [SlotState, SlotState];
}

function MatchCard({ match, participants, isActive, label, highlight, onSelectWinner, onFoul, foulPending, compact, slotStates }: MatchCardProps) {
  const p1 = getParticipant(participants, match.participant1Id);
  const p2 = getParticipant(participants, match.participant2Id);
  const isDone = !!match.winnerId;
  const isReady = !isDone && !!p1 && !!p2;
  const canPlay = isActive && isReady && !!onSelectWinner;
  const onTable = isReady && match.tableNumber != null;

  if (compact) {
    const winner = getParticipant(participants, match.winnerId);
    return (
      <div className="flex items-center rounded border border-border/30 bg-muted/40 px-3" style={{ width: CARD_W, height: BYE_H }} data-testid={`card-bye-${match.id}`}>
        <span className="text-[10px] text-muted-foreground italic truncate">
          {winner ? `${winner.name} — bye` : "bye"}
        </span>
      </div>
    );
  }

  function SlotRow({ participant, slot }: { participant: Participant | null; slot: 1 | 2 }) {
    const isWinner = participant && match.winnerId === participant.id;
    const isLoser = participant && match.winnerId && match.winnerId !== participant.id;
    const isEmpty = !participant;
    const fouls = slot === 1 ? (match.participant1Fouls || 0) : (match.participant2Fouls || 0);
    const foulDQ = isLoser && fouls >= 2;
    const emptyText = slotStates?.[slot - 1] === "dead" ? "bye" : "TBD";

    return (
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 h-8 select-none transition-all",
          slot === 1 ? "border-b border-border/20 rounded-t-lg" : "rounded-b-lg",
          isEmpty && "opacity-40",
          !isEmpty && canPlay && "cursor-pointer hover:bg-primary/[0.08]",
          isWinner && "bg-gradient-to-r from-primary/15 to-primary/5",
          isLoser && "opacity-40",
        )}
        onClick={() => participant && canPlay && onSelectWinner!(match.id, participant.id)}
        data-testid={`slot-match-${match.id}-p${slot}`}
      >
        {participant?.photoUrl ? (
          <img src={participant.photoUrl} alt="" className="w-5 h-5 rounded-full object-cover shrink-0 border border-border/30" />
        ) : (
          <div className={cn(
            "w-5 h-5 rounded-sm flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors",
            isWinner ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}>
            {participant ? participant.seed : "-"}
          </div>
        )}
        <span className={cn(
          "text-xs font-medium flex-1 truncate transition-colors min-w-0",
          isWinner && "text-primary font-semibold",
          isLoser && "text-muted-foreground line-through",
          isEmpty && "text-muted-foreground italic",
        )} title={participant?.club ? `${participant.name} · ${participant.club}` : participant?.name}>
          {participant ? participant.name : emptyText}
        </span>
        {fouls > 0 && (
          <span
            className={cn(
              "text-[9px] font-bold shrink-0 px-1 rounded",
              fouls >= 2 ? "bg-red-500/20 text-red-600" : "bg-amber-500/20 text-amber-600",
            )}
            title={foulDQ ? "Disqualified (2 fouls)" : `${fouls} foul${fouls > 1 ? "s" : ""}`}
            data-testid={`foul-count-${match.id}-p${slot}`}
          >
            {foulDQ ? "DQ" : `F${fouls}`}
          </span>
        )}
        {canPlay && participant && onFoul && (
          <button
            className="w-5 h-5 rounded-sm flex items-center justify-center text-[9px] font-bold shrink-0 bg-red-500/10 hover:bg-red-500/25 text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={`Add foul to ${participant.name}`}
            disabled={foulPending}
            onClick={(e) => { e.stopPropagation(); onFoul(match.id, participant.id); }}
            data-testid={`button-foul-${match.id}-p${slot}`}
          >
            F
          </button>
        )}
        {isWinner && <Trophy className="w-3.5 h-3.5 text-primary shrink-0" />}
      </div>
    );
  }

  const number = match.matchNumber != null ? `#${match.matchNumber}` : null;
  let pill: { text: string; className: string } | null = null;
  if (onTable) {
    pill = { text: `Table ${match.tableNumber}${number ? ` · ${number}` : ""}`, className: "bg-amber-500 text-white shadow-amber-500/30" };
  } else if (isReady && isActive) {
    pill = {
      text: `${number ? `${number} · ` : ""}${onSelectWinner ? "Pick winner" : "Up next"}`,
      className: "bg-gradient-to-r from-primary to-purple-700 text-primary-foreground shadow-primary/30",
    };
  }

  return (
    <div className="flex flex-col items-center">
      {label && (
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
          {label}
        </span>
      )}
      <div
        className={cn(
          "relative rounded-lg border transition-all shadow-sm bg-card",
          isDone ? "border-border/40" : "border-border/60",
          highlight && isDone && "ring-2 ring-primary/30 border-primary/20 shadow-md shadow-primary/5",
          isReady && isActive && "border-primary/30 bg-gradient-to-b from-card to-primary/[0.04] shadow-md shadow-primary/5",
          onTable && "border-amber-500/60 ring-1 ring-amber-500/30",
        )}
        style={{ width: CARD_W, height: CARD_H }}
        data-testid={`card-match-${match.id}`}
      >
        {pill && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 leading-none">
            <span className={cn("inline-block text-[8px] leading-[14px] font-bold uppercase tracking-wider px-2 rounded-full whitespace-nowrap shadow-sm", pill.className)}>
              {pill.text}
            </span>
          </div>
        )}
        {!pill && number && (
          <span className="absolute -top-2 left-2 z-10 text-[8px] leading-[12px] font-mono font-semibold px-1 rounded bg-background text-muted-foreground border border-border/50">
            {number}{match.winMethod === "fouls" ? " · fouls" : ""}
          </span>
        )}
        <SlotRow participant={p1} slot={1} />
        <SlotRow participant={p2} slot={2} />
      </div>
    </div>
  );
}

function SectionHeader({ color, title, subtitle, testId }: { color: string; title: string; subtitle?: string; testId: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className={cn("w-1 h-6 rounded-sm", color)} />
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide" data-testid={testId}>{title}</h3>
        {subtitle && (
          <span className="text-[10px] text-muted-foreground">{subtitle}</span>
        )}
      </div>
    </div>
  );
}

/**
 * One bracket (winners, losers or Champion of Champions) drawn as columns.
 */
function BracketSection({
  columns, participants, isActive, onSelectWinner, onFoul, foulPending, accentColor, engine,
}: {
  columns: RoundColumn[];
  participants: Participant[];
  isActive: boolean;
  onSelectWinner?: (matchId: string, winnerId: string) => void;
  onFoul?: (matchId: string, participantId: string) => void;
  foulPending?: boolean;
  accentColor: string;
  engine: BracketEngine | null;
}) {
  const layout = useMemo(() => computeLayout(columns), [columns]);

  if (!layout) return null;

  return (
    <div className="overflow-x-auto pb-3">
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        <svg className="absolute inset-0 pointer-events-none" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.lines.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="hsl(var(--border))" strokeWidth="1.5" />
          ))}
        </svg>
        {layout.cols.map((col, ci) => (
          <div
            key={col.round}
            className="absolute top-0 flex items-center justify-center gap-1.5"
            style={{ left: ci * (CARD_W + COL_GAP), width: CARD_W, height: HEADER_H - 8 }}
          >
            <div className={cn("w-1.5 h-4 rounded-sm", accentColor)} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              {col.title}
            </span>
          </div>
        ))}
        {layout.cards.map(card => (
          <div key={card.match.id} className="absolute" style={{ left: card.left, top: card.top }}>
            <MatchCard
              match={card.match}
              participants={participants}
              isActive={isActive}
              onSelectWinner={onSelectWinner}
              onFoul={onFoul}
              foulPending={foulPending}
              compact={card.compact}
              slotStates={engine ? [engine.slotState(card.match, 1), engine.slotState(card.match, 2)] : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChampionBanner({ champion, title, subtitle, big }: { champion: Participant; title: string; subtitle: string; big?: boolean }) {
  const gold = "hsl(var(--champion-gold))";
  return (
    <div className={cn("relative flex flex-col items-center rounded-md border overflow-hidden", big ? "py-8" : "py-6")}
      style={{
        background: "linear-gradient(135deg, hsl(var(--champion-gold) / 0.1), hsl(var(--champion-gold) / 0.18), hsl(var(--champion-gold) / 0.1))",
        borderColor: "hsl(var(--champion-gold) / 0.35)",
      }}
    >
      <div className="absolute inset-0 champion-shimmer opacity-25"
        style={{ background: "linear-gradient(90deg, transparent, hsl(var(--champion-gold) / 0.35), transparent)", backgroundSize: "200% 100%" }}
      />
      <div className="absolute top-3 left-6 sparkle-1"><Sparkles className="w-3.5 h-3.5" style={{ color: gold }} /></div>
      <div className="absolute top-5 right-8 sparkle-2"><Sparkles className="w-3 h-3" style={{ color: gold }} /></div>
      <div className="absolute bottom-4 left-10 sparkle-3"><Sparkles className="w-2.5 h-2.5" style={{ color: gold }} /></div>
      <div className="absolute bottom-3 right-12 sparkle-4"><Sparkles className="w-3.5 h-3.5" style={{ color: gold }} /></div>
      <div className="relative z-10 flex flex-col items-center">
        {champion.photoUrl ? (
          <div className="relative mb-3">
            <img src={champion.photoUrl} alt="" className="w-16 h-16 rounded-full object-cover border-2 champion-crown" style={{ borderColor: gold }} />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, hsl(var(--champion-gold)), hsl(var(--champion-gold) / 0.8))" }}>
              <Crown className="w-3.5 h-3.5" style={{ color: "hsl(var(--champion-gold-foreground))" }} />
            </div>
          </div>
        ) : (
          <div className={cn("rounded-full flex items-center justify-center mb-3 champion-crown", big ? "w-16 h-16" : "w-14 h-14")}
            style={{ background: "linear-gradient(135deg, hsl(var(--champion-gold)), hsl(var(--champion-gold) / 0.8))" }}>
            <Crown className={big ? "w-8 h-8" : "w-7 h-7"} style={{ color: "hsl(var(--champion-gold-foreground))" }} />
          </div>
        )}
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] mb-1" style={{ color: gold }}>{title}</p>
        <p className={cn("font-bold", big ? "text-3xl" : "text-2xl")} data-testid={big ? "text-overall-champion" : "text-champion"}>{champion.name}</p>
        <p className="text-xs text-muted-foreground mt-1">{champion.club ? `${champion.club} · ${subtitle}` : subtitle}</p>
      </div>
    </div>
  );
}

export function ChampionOfChampionsBracket({ tournament, onSelectWinner, onFoul, foulPending }: Omit<BracketViewProps, "weightCategory">) {
  const { participants } = tournament;
  const cocMatches = useMemo(() => tournament.matches.filter(m => m.bracket === COC), [tournament.matches]);
  const engine = useMemo(() => (cocMatches.length ? new BracketEngine(cocMatches) : null), [cocMatches]);
  const columns = useMemo(() => buildColumns(cocMatches, visibleMatches(cocMatches), COC), [cocMatches]);
  if (!cocMatches.length) return null;

  const isActive = tournament.status === "finals";
  const championId = engine?.champion();
  const overallChampion = tournament.status === "completed" ? getParticipant(participants, championId) : null;

  return (
    <div className="w-full space-y-6">
      {overallChampion && (
        <ChampionBanner champion={overallChampion} title="Overall Champion" subtitle="Champion of Champions" big />
      )}
      <SectionHeader
        color="bg-amber-500"
        title="Champion of Champions"
        subtitle="Category champions battle for the ultimate title"
        testId="text-coc-bracket-title"
      />
      <BracketSection
        columns={columns}
        participants={participants}
        isActive={isActive}
        onSelectWinner={onSelectWinner}
        onFoul={onFoul}
        foulPending={foulPending}
        accentColor="bg-amber-500"
        engine={engine}
      />
    </div>
  );
}

export function BracketView({ tournament, onSelectWinner, onFoul, foulPending, weightCategory, show = "all" }: BracketViewProps) {
  const { participants } = tournament;
  const allMatches = useMemo(() => categoryMatches(tournament.matches, weightCategory ?? null), [tournament.matches, weightCategory]);
  const standard = useMemo(() => isStandardDoubleElim(allMatches), [allMatches]);
  const engine = useMemo(() => (standard ? new BracketEngine(allMatches) : null), [allMatches, standard]);
  const visible = useMemo(() => visibleMatches(allMatches), [allMatches]);
  const winnersColumns = useMemo(() => buildColumns(allMatches, visible, "winners"), [allMatches, visible]);
  const losersColumns = useMemo(() => buildColumns(allMatches, visible, "losers"), [allMatches, visible]);
  if (!allMatches.length) return null;

  const isActive = tournament.status === "active";
  const gf1 = allMatches.find(m => m.bracket === "grand_final" && m.round === 1);
  const gf2 = allMatches.find(m => m.bracket === "grand_final" && m.round === 2);
  const deciding = gf2?.winnerId ? gf2 : gf1;
  const categoryDone = !!gf1?.winnerId && (gf1.winnerId === gf1.participant1Id || !!gf2?.winnerId);
  const champion = categoryDone ? getParticipant(participants, deciding?.winnerId) : null;
  const gf2Needed = gf1?.winnerId && gf1.winnerId !== gf1.participant1Id;
  const hasLosers = losersColumns.some(c => c.matches.length > 0);
  const showWinners = show !== "losers";
  const showLosers = show !== "winners";
  // On a winners-only slide the grand final appears once someone has reached it.
  const showFinal = show === "all" || (show === "winners" && !!(gf1?.participant1Id || gf1?.participant2Id));

  return (
    <div className="w-full space-y-8">
      {champion && show === "all" && (
        <ChampionBanner champion={champion} title="Champion" subtitle="Double Elimination Winner" />
      )}

      {!standard && tournament.status !== "completed" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm" data-testid="notice-legacy-bracket">
          <p className="font-semibold">This bracket uses the old format</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            It was created before the bracket engine was corrected and could drop players after one loss.
            Restart this category to regenerate it; results cannot be recorded on it.
          </p>
        </div>
      )}

      {showWinners && <div>
        <SectionHeader color="bg-blue-500" title="Winners Bracket" testId="text-winners-bracket-title" />
        <BracketSection
          columns={winnersColumns}
          participants={participants}
          isActive={isActive}
          onSelectWinner={onSelectWinner}
          onFoul={onFoul}
          foulPending={foulPending}
          accentColor="bg-blue-500"
          engine={engine}
        />
      </div>}

      {hasLosers && showLosers && (
        <div>
          <SectionHeader
            color="bg-orange-500"
            title="Losers Bracket"
            subtitle="Lose once, drop here; lose again, eliminated"
            testId="text-losers-bracket-title"
          />
          <BracketSection
            columns={losersColumns}
            participants={participants}
            isActive={isActive}
            onSelectWinner={onSelectWinner}
            onFoul={onFoul}
            foulPending={foulPending}
            accentColor="bg-orange-500"
            engine={engine}
          />
        </div>
      )}

      {gf1 && showFinal && (
        <div>
          <SectionHeader
            color="bg-primary"
            title="Grand Final"
            subtitle="Winners champ has 0 losses; Losers champ has 1 loss"
            testId="text-grand-final-title"
          />
          <div className="flex items-start justify-center gap-8 flex-wrap pt-1">
            <div className="flex flex-col items-center gap-1">
              <MatchCard
                match={gf1}
                participants={participants}
                isActive={isActive}
                label="Game 1"
                highlight
                onSelectWinner={onSelectWinner}
                onFoul={onFoul}
                foulPending={foulPending}
              />
              {gf1.winnerId && gf1.winnerId === gf1.participant1Id && (
                <span className="text-[9px] text-muted-foreground mt-1" data-testid="text-gf1-no-reset">WB champ wins — no reset needed</span>
              )}
              {gf1.winnerId && gf1.winnerId !== gf1.participant1Id && (
                <span className="text-[9px] text-primary font-semibold mt-1" data-testid="text-gf1-reset">LB champ wins — bracket reset!</span>
              )}
            </div>
            {(gf2Needed || gf2?.winnerId) && gf2 && (
              <div className="flex flex-col items-center gap-1">
                <MatchCard
                  match={gf2}
                  participants={participants}
                  isActive={isActive}
                  label="Game 2 (Reset)"
                  highlight
                  onSelectWinner={onSelectWinner}
                  onFoul={onFoul}
                  foulPending={foulPending}
                />
                <span className="text-[9px] text-muted-foreground mt-1">Both have 1 loss — winner takes all</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
