import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HardDriveDownload, HardDriveUpload, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { localBackend } from "@/lib/backend";
import { saveBlob } from "@/lib/save-file";

/**
 * Offline app only. Everything is stored on this device, so the organiser
 * needs a way to keep a copy elsewhere and to bring it back.
 */
export function LocalDataMenu() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveBackup() {
    setBusy(true);
    try {
      const backup = await (await localBackend()).exportBackup();
      const day = new Date().toISOString().slice(0, 10);
      await saveBlob(new Blob([JSON.stringify(backup)], { type: "application/json" }), `bracket-builder-backup-${day}.json`);
    } catch (err: any) {
      toast({ title: "Could not create the backup", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPendingRestore({ name: file.name, text: String(reader.result ?? "") });
    reader.onerror = () => toast({ title: "Could not read that file", variant: "destructive" });
    reader.readAsText(file);
  }

  async function restore() {
    if (!pendingRestore) return;
    setBusy(true);
    try {
      const result = await (await localBackend()).importBackup(pendingRestore.text);
      await queryClient.invalidateQueries();
      toast({ title: "Backup restored", description: `${result.tournaments} tournament${result.tournaments === 1 ? "" : "s"}, ${result.athletes} entries.` });
    } catch (err: any) {
      toast({ title: "Could not restore", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
      setPendingRestore(null);
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={pickFile} data-testid="input-restore-backup" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="border-primary/20 hover:bg-primary/5" disabled={busy} data-testid="button-local-data">
            <Smartphone className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">On this device</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="font-normal text-xs text-muted-foreground leading-snug">
            Tournaments are stored only on this device and work with no internet. Save a backup after each event.
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={saveBackup} data-testid="menu-save-backup">
            <HardDriveDownload className="w-4 h-4 mr-2" /> Save a backup file
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileRef.current?.click()} data-testid="menu-restore-backup">
            <HardDriveUpload className="w-4 h-4 mr-2" /> Restore from a backup file
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={!!pendingRestore} onOpenChange={(open) => { if (!open) setPendingRestore(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace everything on this device?</AlertDialogTitle>
            <AlertDialogDescription>
              Restoring <span className="font-medium text-foreground">{pendingRestore?.name}</span> removes every tournament
              currently on this device and puts the backup's tournaments in their place. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={restore} disabled={busy} data-testid="button-restore-confirm">Replace with backup</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
