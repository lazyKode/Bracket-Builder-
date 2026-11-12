import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { History, Undo2 } from "lucide-react";
import type { MatchEventSummary } from "@shared/schema";
import { scopeLabel, shortCategory } from "@shared/stats";
import { cn } from "@/lib/utils";

export interface EventsResponse { events: MatchEventSummary[]; viewers: number }

export function useEvents(tournamentId: string | undefined, enabled: boolean) {
  return useQuery<EventsResponse>({
    queryKey: ["/api/tournaments", tournamentId, "events"],
    enabled: !!tournamentId && enabled,
  });
}

function timeOf(value: string | Date) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "Undo" (latest action, with a confirmation) and "History" (rewind any bracket to an earlier point). */
export function UndoControls({ events, onUndo, pending }: {
  events: MatchEventSummary[];
  onUndo: (eventId: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const latest = events[0];

  // How many newer actions in the same bracket go with each event.
  const laterInScope = (e: MatchEventSummary) => events.filter(x => x.scope === e.scope && x.seq > e.seq).length;

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="border-primary/20 hover:bg-primary/5" disabled={!latest || pending} data-testid="button-undo">
            <Undo2 className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Undo</span>
          </Button>
        </AlertDialogTrigger>
        {latest && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Undo the last action?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="block font-medium text-foreground" data-testid="text-undo-summary">{latest.summary}</span>
                <span className="block mt-1">{scopeLabel(latest.scope)} goes back to how it was just before this. Nothing else changes.</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={() => onUndo(latest.id)} data-testid="button-undo-confirm">Undo</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
      <Button size="icon" variant="outline" className="border-primary/20 hover:bg-primary/5" onClick={() => setOpen(true)}
        disabled={!events.length} title="Result history" aria-label="Result history" data-testid="button-history">
        <History className="w-4 h-4" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirmId(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col" data-testid="dialog-history">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="w-4 h-4 text-primary" /> Result history</DialogTitle>
            <DialogDescription>
              Rewind a bracket to just before any result. Later results in that same bracket are removed with it; other brackets are not touched.
            </DialogDescription>
          </DialogHeader>
          <ol className="overflow-y-auto -mx-2 px-2 divide-y divide-border/40">
            {events.map(e => {
              const later = laterInScope(e);
              const confirming = confirmId === e.id;
              return (
                <li key={e.id} className={cn("py-2.5 flex items-start gap-3", confirming && "bg-amber-500/5 -mx-2 px-2 rounded")} data-testid={`event-${e.id}`}>
                  <span className="text-[10px] text-muted-foreground font-mono mt-0.5 w-14 shrink-0 whitespace-nowrap">{timeOf(e.createdAt)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">{e.summary}</p>
                    <p className="text-[10px] text-muted-foreground">{shortCategory(scopeLabel(e.scope)) || scopeLabel(e.scope)}{e.kind === "foul" ? " · foul" : ""}</p>
                    {confirming && (
                      <p className="text-[11px] text-amber-700 mt-1">
                        {later === 0 ? "Undo this action?" : `This also removes ${later} later action${later === 1 ? "" : "s"} in this bracket.`}
                      </p>
                    )}
                  </div>
                  {confirming ? (
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={pending}
                        onClick={() => { onUndo(e.id); setConfirmId(null); }} data-testid={`button-rewind-confirm-${e.id}`}>
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" disabled={pending}
                      onClick={() => setConfirmId(e.id)} data-testid={`button-rewind-${e.id}`}>
                      {later === 0 ? "Undo" : "Rewind here"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="text-[10px] text-muted-foreground">The last 40 actions per bracket are kept.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
