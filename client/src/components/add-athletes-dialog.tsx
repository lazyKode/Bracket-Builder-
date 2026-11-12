import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FileUp, UserPlus } from "lucide-react";

export interface AthleteEntry { name: string; club?: string | null }

/** "Asha Verma, Iron Arms" (comma, semicolon or tab) -> { name, club }. A header row "name,club" is ignored. */
export function parseAthleteLines(text: string, defaultClub: string): AthleteEntry[] {
  const entries: AthleteEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [first, ...rest] = line.split(/[,;\t]/).map(s => s.trim().replace(/^"|"$/g, ""));
    if (!first) continue;
    if (entries.length === 0 && /^(name|athlete|player)$/i.test(first)) continue;
    entries.push({ name: first, club: rest[0] || defaultClub.trim() || null });
  }
  return entries;
}

export function AddAthletesDialog({ open, onOpenChange, categories, pending, onSubmit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Classes that can still take entries (not started yet). */
  categories: string[];
  pending: boolean;
  onSubmit: (entries: AthleteEntry[], categories: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [club, setClub] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Start clean every time the dialog opens, so an earlier selection can never leak into the next batch.
  useEffect(() => {
    if (open) {
      setText("");
      setClub("");
      setSelected([]);
    }
  }, [open]);

  const entries = useMemo(() => parseAthleteLines(text, club), [text, club]);
  const chosen = categories.length === 1 ? categories : selected.filter(c => categories.includes(c));
  const canSubmit = entries.length > 0 && (categories.length === 0 || chosen.length > 0);

  function toggle(cat: string) {
    setSelected(prev => (prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]));
  }

  function loadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(prev => (prev.trim() ? prev.trimEnd() + "\n" : "") + String(reader.result ?? ""));
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-add-athletes">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary" /> Add athletes</DialogTitle>
          <DialogDescription>
            Paste a list, one athlete per line. Tick several classes to enter the same athletes in each
            (left and right hand, for example).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="athlete-lines">Athletes</Label>
              <button type="button" className="text-[11px] text-primary hover:underline flex items-center gap-1" onClick={() => fileRef.current?.click()}>
                <FileUp className="w-3 h-3" /> Load .csv or .txt
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt,text/plain,text/csv" className="hidden" onChange={loadFile} />
            </div>
            <Textarea
              id="athlete-lines"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={"Asha Verma, Iron Arms\nBela Khan, Grip Club\nChitra Rao"}
              className="min-h-[150px] font-mono text-xs"
              autoFocus
              data-testid="textarea-athletes"
            />
            <p className="text-[11px] text-muted-foreground">Optional club after a comma. Names already in a class are skipped.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="default-club">Club for lines without one <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input id="default-club" value={club} onChange={e => setClub(e.target.value)} placeholder="e.g. Iron Arms" className="h-9" data-testid="input-default-club" />
          </div>

          {categories.length > 1 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Weight classes</Label>
                <button type="button" className="text-[11px] text-primary hover:underline"
                  onClick={() => setSelected(chosen.length === categories.length ? [] : categories)}>
                  {chosen.length === categories.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="rounded-lg border border-border/60 divide-y divide-border/40 max-h-44 overflow-y-auto">
                {categories.map(cat => (
                  <label key={cat} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                    <Checkbox checked={chosen.includes(cat)} onCheckedChange={() => toggle(cat)} data-testid={`checkbox-class-${cat}`} />
                    <span className="truncate">{cat}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <p className="text-xs text-muted-foreground mr-auto" data-testid="text-add-preview">
              {entries.length === 0
                ? "Nothing to add yet"
                : `${entries.length} athlete${entries.length === 1 ? "" : "s"}${chosen.length > 1 ? ` × ${chosen.length} classes = ${entries.length * chosen.length} entries` : ""}`}
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              className="bg-gradient-to-r from-primary to-purple-700"
              disabled={!canSubmit || pending}
              onClick={() => onSubmit(entries, chosen)}
              data-testid="button-submit-athletes"
            >
              {pending ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
