import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Check, Copy, ExternalLink, MonitorPlay, Radio } from "lucide-react";

export function liveUrl(token: string, tv = false): string {
  return `${window.location.origin}/live/${token}${tv ? "?tv=1" : ""}`;
}

function QrCode({ value }: { value: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [value]);
  // The SVG is generated locally from the link; white background keeps it scannable in any theme.
  return <div className="w-36 h-36 bg-white p-1 rounded-md border border-border/60" dangerouslySetInnerHTML={{ __html: svg }} data-testid="qr-live-link" />;
}

export function ShareDialog({ open, onOpenChange, shareToken, viewers, pending, onToggle }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shareToken: string | null;
  viewers: number;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = shareToken ? liveUrl(shareToken) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-share">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Radio className="w-4 h-4 text-primary" /> Live spectator view</DialogTitle>
          <DialogDescription>
            A read-only page that updates the moment you record a result. Anyone with the link can watch; nobody can change anything.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
          <div>
            <Label htmlFor="share-enabled" className="text-sm font-semibold cursor-pointer">Public link</Label>
            <p className="text-[11px] text-muted-foreground">
              {shareToken ? `On${viewers > 0 ? ` · ${viewers} watching now` : ""}` : "Off"}
            </p>
          </div>
          <Switch id="share-enabled" checked={!!shareToken} disabled={pending} onCheckedChange={onToggle} data-testid="switch-share" />
        </div>

        {shareToken && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input readOnly value={url} className="h-9 text-xs font-mono" onFocus={e => e.currentTarget.select()} data-testid="input-live-url" />
              <Button variant="outline" className="h-9 shrink-0" onClick={copy} data-testid="button-copy-live-url">
                {copied ? <Check className="w-4 h-4 mr-1.5 text-emerald-600" /> : <Copy className="w-4 h-4 mr-1.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex gap-4 items-center">
              <QrCode value={url} />
              <div className="space-y-2 flex-1">
                <p className="text-xs text-muted-foreground">Print or show this code at the venue so athletes can follow on their phones.</p>
                <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                  <a href={url} target="_blank" rel="noreferrer" data-testid="link-open-live"><ExternalLink className="w-3.5 h-3.5 mr-2" /> Open spectator page</a>
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                  <a href={liveUrl(shareToken, true)} target="_blank" rel="noreferrer" data-testid="link-open-tv"><MonitorPlay className="w-3.5 h-3.5 mr-2" /> Open big-screen mode</a>
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Turning the link off disconnects everyone; turning it on again creates a new link.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
