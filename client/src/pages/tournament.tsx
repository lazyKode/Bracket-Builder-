import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiFetch, IS_LOCAL } from "@/lib/backend";
import { usesShareSheet } from "@/lib/save-file";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BracketView, ChampionOfChampionsBracket } from "@/components/bracket-view";
import SpinWheel from "@/components/spin-wheel";
import { MatchControl } from "@/components/match-control";
import { RankingsTable, TeamStandingsTable } from "@/components/rankings";
import { UndoControls, useEvents } from "@/components/undo-history";
import { AddAthletesDialog, type AthleteEntry } from "@/components/add-athletes-dialog";
import { ShareDialog } from "@/components/share-dialog";
import { useLiveUpdates } from "@/hooks/use-live";
import { exportMatchesCsv, exportResultsCsv, exportResultsPdf, printBrackets, printResults } from "@/lib/export";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Trophy, ArrowLeft, Plus, Trash2, Play, RotateCcw,
  Users, Edit2, X, Check, ChevronDown, ChevronUp, Crown, Zap, Printer,
  Camera, Upload, UserCircle, PanelLeftClose, PanelLeft, RefreshCw,
  Download, FileText, Link2, MonitorPlay, Radio, Table2, UserPlus,
} from "lucide-react";
import type { TournamentWithDetails, Participant, SeedingMode } from "@shared/schema";
import { computeCategoryRankings, computeTeamStandings, getCategoryChampion, isCategoryComplete as categoryIsComplete } from "@shared/stats";
import { cn } from "@/lib/utils";

const SEEDING_HELP: Record<SeedingMode, string> = {
  sequential: "Paired in list order (1v2, 3v4…). With an odd count the spin wheel picks who gets the bye.",
  ranked: "List order is the ranking: 1 meets the lowest seed, top seeds are kept apart and get any byes.",
  random: "The list is shuffled when the class starts. With an odd count the spin wheel picks the bye.",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "setup") return <Badge variant="secondary" className="border-0 bg-slate-500/15 text-slate-600 dark:text-slate-400">Setup</Badge>;
  if (status === "active") return <Badge className="border-0 bg-blue-500/15 text-blue-600 dark:text-blue-400">In Progress</Badge>;
  if (status === "awaiting_coc") return <Badge className="border-0 bg-amber-500/15 text-amber-600 dark:text-amber-400">Awaiting CoC</Badge>;
  if (status === "finals") return <Badge className="border-0 bg-amber-500/15 text-amber-600 dark:text-amber-400">Finals</Badge>;
  if (status === "completed") return <Badge className="border-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Completed</Badge>;
  return null;
}

function CollapsibleSection({
  title, count, defaultOpen, children, isOpen, onToggle, status,
}: {
  title: string; count: number; total?: number; defaultOpen?: boolean;
  isOpen?: boolean; onToggle?: () => void;
  children: React.ReactNode;
  status?: "ready" | "started" | "complete" | "needs-players";
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const toggle = onToggle ?? (() => setInternalOpen(o => !o));
  const contentRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(0);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (innerRef.current) {
      if (!initializedRef.current && open) {
        contentRef.current!.style.transition = "none";
        setHeight(innerRef.current.scrollHeight);
        requestAnimationFrame(() => {
          if (contentRef.current) contentRef.current.style.transition = "";
        });
        initializedRef.current = true;
      } else {
        setHeight(open ? innerRef.current.scrollHeight : 0);
        initializedRef.current = true;
      }
    }
  }, [open, count]);

  const borderColor = status === "complete" ? "border-emerald-500/30" : status === "started" ? "border-blue-500/30" : status === "ready" ? "border-amber-500/30" : "border-primary/10";
  const topBarColor = status === "complete" ? "bg-emerald-500" : status === "started" ? "bg-blue-500" : status === "ready" ? "bg-amber-500" : "bg-primary/30";

  return (
    <div className={cn("border rounded-lg overflow-hidden", borderColor)} data-testid={`collapsible-${title}`}>
      <div className={cn("h-0.5", topBarColor)} />
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
        data-testid={`toggle-${title}`}
      >
        <ChevronDown className={cn("w-4 h-4 text-primary/60 transition-transform duration-200", open && "rotate-180")} />
        <span className="text-[13px] font-semibold flex-1 truncate">{title}</span>
        {status === "complete" && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
        {status === "started" && <Play className="w-3 h-3 text-blue-500 shrink-0 fill-blue-500" />}
        <Badge className={cn(
          "font-mono text-[10px] h-5 px-1.5 shrink-0 border-0",
          status === "complete" ? "bg-emerald-500/10 text-emerald-600" :
          status === "started" ? "bg-blue-500/10 text-blue-600" :
          count >= 2 ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground"
        )}>
          {count}
        </Badge>
      </button>
      <div
        ref={contentRef}
        style={{ height: `${height}px` }}
        className="transition-[height] duration-200 ease-in-out overflow-hidden"
      >
        <div ref={innerRef} className="px-3 py-2 border-t border-border/30">
          {children}
        </div>
      </div>
    </div>
  );
}

function ParticipantPhoto({ participant, size = "sm" }: { participant: Participant; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "w-10 h-10" : size === "md" ? "w-7 h-7" : "w-6 h-6";
  const iconDims = size === "lg" ? "w-5 h-5" : size === "md" ? "w-3.5 h-3.5" : "w-3 h-3";

  if (participant.photoUrl) {
    return (
      <img
        src={participant.photoUrl}
        alt={participant.name}
        className={`${dims} rounded-full object-cover shrink-0 border border-border/50`}
        data-testid={`img-participant-photo-${participant.id}`}
      />
    );
  }
  return (
    <div className={`${dims} rounded-full bg-muted flex items-center justify-center shrink-0`} data-testid={`placeholder-participant-photo-${participant.id}`}>
      <UserCircle className={`${iconDims} text-muted-foreground`} />
    </div>
  );
}

function PhotoUploadButton({ participant, tournamentId }: { participant: Participant; tournamentId: string }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  const photoMutation = useMutation({
    mutationFn: async (photoData: string) => {
      const res = await apiRequest("POST", `/api/participants/${participant.id}/photo`, { photoData });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId] });
      toast({ title: "Photo updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removePhotoMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/participants/${participant.id}/photo`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId] });
      toast({ title: "Photo removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 5MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 200;
        let w = img.width, h = img.height;
        if (w > h) { h = (h / w) * maxSize; w = maxSize; }
        else { w = (w / h) * maxSize; h = maxSize; }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        photoMutation.mutate(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function startCamera(mode: "user" | "environment") {
    try {
      stream?.getTracks().forEach(t => t.stop());
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: 300, height: 300 } });
      setStream(mediaStream);
      setFacingMode(mode);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play();
        }
      }, 100);
      return true;
    } catch {
      toast({ title: "Camera access denied", variant: "destructive" });
      return false;
    }
  }

  async function openCamera() {
    const ok = await startCamera(facingMode);
    if (ok) setCameraOpen(true);
  }

  async function flipCamera() {
    const newMode = facingMode === "user" ? "environment" : "user";
    await startCamera(newMode);
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    const video = videoRef.current;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 200, 200);
    photoMutation.mutate(canvas.toDataURL("image/jpeg", 0.8));
    closeCamera();
  }

  function closeCamera() {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setCameraOpen(false);
  }

  return (
    <>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} data-testid={`input-photo-upload-${participant.id}`} />
      <canvas ref={canvasRef} className="hidden" />
      <div className="flex items-center gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => fileInputRef.current?.click()}
          disabled={photoMutation.isPending}
          title="Upload photo"
          data-testid={`button-upload-photo-${participant.id}`}
        >
          <Upload className="w-3 h-3 text-muted-foreground" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={openCamera}
          disabled={photoMutation.isPending}
          title="Take photo"
          data-testid={`button-camera-photo-${participant.id}`}
        >
          <Camera className="w-3 h-3 text-muted-foreground" />
        </Button>
        {participant.photoUrl && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => removePhotoMutation.mutate()}
            disabled={removePhotoMutation.isPending}
            title="Remove photo"
            data-testid={`button-remove-photo-${participant.id}`}
          >
            <X className="w-3 h-3 text-red-400" />
          </Button>
        )}
      </div>
      <Dialog open={cameraOpen} onOpenChange={(open) => { if (!open) closeCamera(); }}>
        <DialogContent className="sm:max-w-sm" data-testid={`dialog-camera-${participant.id}`}>
          <DialogHeader>
            <DialogTitle className="text-center text-sm">Take Photo — {participant.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <video ref={videoRef} autoPlay playsInline muted className="w-48 h-48 rounded-full object-cover border-2 border-primary/30" />
              <Button
                size="icon"
                variant="secondary"
                className="absolute bottom-1 right-1 h-8 w-8 rounded-full shadow-md"
                onClick={flipCamera}
                title={facingMode === "user" ? "Switch to rear camera" : "Switch to front camera"}
                data-testid={`button-flip-camera-${participant.id}`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{facingMode === "user" ? "Front camera" : "Rear camera"}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={capturePhoto} disabled={photoMutation.isPending} data-testid={`button-capture-photo-${participant.id}`}>
                <Camera className="w-3.5 h-3.5 mr-1.5" />
                Capture
              </Button>
              <Button size="sm" variant="outline" onClick={closeCamera}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditableParticipant({
  participant, tournamentId, canEdit, index, linkedCount = 1, onMove, canMoveUp, canMoveDown,
}: {
  participant: Participant; tournamentId: string; canEdit: boolean; index?: number;
  /** In how many classes this athlete is entered. */
  linkedCount?: number;
  onMove?: (direction: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(participant.name);
  const [club, setClub] = useState(participant.club ?? "");

  const updateMutation = useMutation({
    mutationFn: async (updates: { name: string; club: string | null }) => {
      const res = await apiRequest("PATCH", `/api/participants/${participant.id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId] });
      setEditing(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/participants/${participant.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function cancel() {
    setValue(participant.name);
    setClub(participant.club ?? "");
    setEditing(false);
  }

  function handleSave() {
    const name = value.trim();
    const nextClub = club.trim() || null;
    if (name && (name !== participant.name || nextClub !== (participant.club ?? null))) {
      updateMutation.mutate({ name, club: nextClub });
    } else {
      cancel();
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") cancel();
  }

  return (
    <div className="flex items-center gap-2 py-1.5" data-testid={`row-participant-${participant.id}`}>
      {index !== undefined && (
        <div className="flex flex-col items-center w-4 shrink-0 leading-none">
          {canEdit && onMove && (
            <button type="button" className="text-muted-foreground/60 hover:text-primary disabled:opacity-20 disabled:hover:text-muted-foreground/60"
              disabled={!canMoveUp} onClick={() => onMove(-1)} title="Move up (higher seed)" aria-label="Move up"
              data-testid={`button-move-up-${participant.id}`}>
              <ChevronUp className="w-3 h-3" />
            </button>
          )}
          <span className="text-[10px] font-bold text-muted-foreground text-center" data-testid={`text-participant-index-${participant.id}`}>{index}</span>
          {canEdit && onMove && (
            <button type="button" className="text-muted-foreground/60 hover:text-primary disabled:opacity-20 disabled:hover:text-muted-foreground/60"
              disabled={!canMoveDown} onClick={() => onMove(1)} title="Move down (lower seed)" aria-label="Move down"
              data-testid={`button-move-down-${participant.id}`}>
              <ChevronDown className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
      <ParticipantPhoto participant={participant} size="sm" />
      {editing ? (
        <>
          <div className="flex-1 min-w-0 space-y-1">
            <Input
              value={value}
              onChange={e => setValue(e.target.value)}
              className="h-7 text-xs"
              placeholder="Name"
              autoFocus
              onKeyDown={onKey}
              data-testid={`input-edit-participant-${participant.id}`}
            />
            <Input
              value={club}
              onChange={e => setClub(e.target.value)}
              className="h-7 text-xs"
              placeholder="Club / team (optional)"
              onKeyDown={onKey}
              data-testid={`input-edit-club-${participant.id}`}
            />
          </div>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSave} disabled={updateMutation.isPending} data-testid={`button-save-participant-${participant.id}`}>
            <Check className="w-3 h-3 text-green-600" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancel}>
            <X className="w-3 h-3 text-muted-foreground" />
          </Button>
        </>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <span className="flex items-center gap-1 text-xs font-medium" data-testid={`text-participant-name-${participant.id}`}>
              <span className="truncate">{participant.name}</span>
              {linkedCount > 1 && (
                <span className="shrink-0 text-primary/70" title={`Entered in ${linkedCount} classes — never called to two tables at once`}>
                  <Link2 className="w-3 h-3" />
                </span>
              )}
            </span>
            {participant.club && (
              <span className="block text-[10px] text-muted-foreground truncate" data-testid={`text-participant-club-${participant.id}`}>{participant.club}</span>
            )}
          </div>
          {canEdit && (
            <>
              <PhotoUploadButton participant={participant} tournamentId={tournamentId} />
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(true)} title="Edit name and club" data-testid={`button-edit-participant-${participant.id}`}>
                <Edit2 className="w-3 h-3 text-muted-foreground" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} data-testid={`button-delete-participant-${participant.id}`}>
                <Trash2 className="w-3 h-3 text-muted-foreground" />
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ResultsSummary({ tournament }: { tournament: TournamentWithDetails }) {
  const hasCategories = tournament.weightCategories && tournament.weightCategories.length > 0;
  const teams = computeTeamStandings(tournament);

  return (
    <div className="space-y-4" data-testid="results-summary">
      <CollapsibleSection
        title="Rankings & Results"
        count={tournament.participants.length}
        defaultOpen={false}
      >
        <div className="grid gap-4 md:grid-cols-2 mt-2">
          {hasCategories
            ? tournament.weightCategories!.map(cat => (
              <RankingsTable key={cat} rankings={computeCategoryRankings(tournament.matches, tournament.participants, cat)} title={cat} />
            ))
            : <RankingsTable rankings={computeCategoryRankings(tournament.matches, tournament.participants, null)} title="Tournament" />}
          <TeamStandingsTable teams={teams} />
        </div>
      </CollapsibleSection>
    </div>
  );
}

export default function TournamentPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [initialCategorySet, setInitialCategorySet] = useState(false);
  const [spinWheelOpen, setSpinWheelOpen] = useState(false);
  const [spinCategory, setSpinCategory] = useState<string | null>(null);
  const [spinPlayers, setSpinPlayers] = useState<{ id: string; name: string }[]>([]);
  const [cocSpinOpen, setCocSpinOpen] = useState(false);
  const [cocSpinPlayers, setCocSpinPlayers] = useState<{ id: string; name: string }[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [, navigate] = useLocation();

  // Live channel: any change (from this or another device) refreshes the page at once.
  const live = useLiveUpdates(id ? `/api/tournaments/${id}/stream` : null, () => {
    queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id] });
  });
  const refreshEvents = () => queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id, "events"] });
  const applyDetails = (data: TournamentWithDetails) => {
    queryClient.setQueryData(["/api/tournaments", id], data);
    refreshEvents();
  };
  const onError = (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" });

  const { data: eventsData } = useEvents(id, true);
  const events = eventsData?.events ?? [];

  const { data: tournament, isLoading } = useQuery<TournamentWithDetails>({
    queryKey: ["/api/tournaments", id],
    // Polling is only a fallback for when the live channel is down.
    refetchInterval: live ? 60000 : 15000,
    queryFn: async () => {
      const res = await apiFetch("GET", `/api/tournaments/${id}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  const addParticipantMutation = useMutation({
    mutationFn: async ({ name, weightCategory }: { name: string; weightCategory?: string }) => {
      const body: Record<string, string> = { name };
      if (weightCategory) body.weightCategory = weightCategory;
      const res = await apiRequest("POST", `/api/tournaments/${id}/participants`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const startMutation = useMutation({
    mutationFn: async (byeData?: Record<string, string>) => {
      const res = await apiRequest("POST", `/api/tournaments/${id}/start`, byeData ? { byeRecipients: byeData } : undefined);
      return res.json();
    },
    onSuccess: (data: TournamentWithDetails) => {
      applyDetails(data);
      toast({ title: "Bracket started!", description: "Click players to advance them through rounds." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const startCategoryMutation = useMutation({
    mutationFn: async ({ category, byeRecipientId }: { category: string; byeRecipientId?: string }) => {
      const res = await apiRequest("POST", `/api/tournaments/${id}/start-category`, { category, byeRecipientId });
      return res.json();
    },
    onSuccess: (data: TournamentWithDetails) => {
      applyDetails(data);
      toast({ title: "Category started!", description: "Click players to advance them through rounds." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleStartCategory = (cat: string) => {
    if (!tournament) return;
    const catPlayers = tournament.participants.filter(p => p.weightCategory === cat);
    if (tournament.seedingMode !== "ranked" && catPlayers.length % 2 !== 0 && catPlayers.length >= 3) {
      setSpinCategory(cat);
      setSpinPlayers(catPlayers.map(p => ({ id: p.id, name: p.name })));
      setSpinWheelOpen(true);
    } else {
      startCategoryMutation.mutate({ category: cat });
    }
  };

  const handleStartBracket = () => {
    if (!tournament) return;
    if (tournament.seedingMode !== "ranked" && tournament.participants.length % 2 !== 0 && tournament.participants.length >= 3) {
      setSpinCategory("__default");
      setSpinPlayers(tournament.participants.map(p => ({ id: p.id, name: p.name })));
      setSpinWheelOpen(true);
    } else {
      startMutation.mutate(undefined);
    }
  };

  const handleSpinResult = (player: { id: string; name: string }) => {
    setSpinWheelOpen(false);
    if (spinCategory && spinCategory !== "__default") {
      startCategoryMutation.mutate({ category: spinCategory, byeRecipientId: player.id });
    } else {
      startMutation.mutate({ __default: player.id });
    }
  };

  const startCocMutation = useMutation({
    mutationFn: async (byeRecipientId?: string) => {
      const res = await apiRequest("POST", `/api/tournaments/${id}/start-coc`, byeRecipientId ? { byeRecipientId } : undefined);
      return res.json();
    },
    onSuccess: (data: TournamentWithDetails) => {
      applyDetails(data);
      toast({ title: "Champion of Champions!", description: "Category champions will now battle for the ultimate title." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleStartCoc = () => {
    if (!tournament) return;
    const allMatches = tournament.matches;
    const champions: { id: string; name: string }[] = [];
    for (const cat of tournament.weightCategories || []) {
      const gf = allMatches.find(m => m.bracket === "grand_final" && m.round === 1 && m.weightCategory === cat && m.winnerId);
      if (gf) {
        const gf2 = allMatches.find(m => m.bracket === "grand_final" && m.round === 2 && m.weightCategory === cat && m.winnerId);
        const champId = gf2?.winnerId || gf.winnerId;
        if (champId) {
          const p = tournament.participants.find(pp => pp.id === champId);
          if (p) champions.push({ id: p.id, name: p.name });
        }
      }
    }

    if (champions.length % 2 !== 0 && champions.length >= 3) {
      setCocSpinPlayers(champions);
      setCocSpinOpen(true);
    } else {
      startCocMutation.mutate(undefined);
    }
  };

  const handleCocSpinResult = (player: { id: string; name: string }) => {
    setCocSpinOpen(false);
    startCocMutation.mutate(player.id);
  };

  const skipCocMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/tournaments/${id}/skip-coc`);
      return res.json();
    },
    onSuccess: (data: any) => {
      applyDetails(data);
      toast({ title: "Tournament complete!", description: "All results have been finalized." });

      if (data.emailStatus?.sent) {
        toast({ title: "Results emailed!", description: `Results sent to ${data.emailStatus.email}` });
      } else if (data.emailStatus?.error) {
        const errorMsg = data.emailStatus.error.includes("403")
          ? "Could not deliver email. Verify your domain at resend.com to send to all recipients."
          : data.emailStatus.error;
        toast({ title: "Email not sent", description: errorMsg, variant: "destructive" });
      }
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/tournaments/${id}/reset`);
      return res.json();
    },
    onSuccess: (data: TournamentWithDetails) => {
      applyDetails(data);
      toast({ title: "Tournament reset" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const winnerMutation = useMutation({
    mutationFn: async ({ matchId, winnerId }: { matchId: string; winnerId: string }) => {
      const res = await apiRequest("POST", `/api/matches/${matchId}/winner`, { winnerId });
      return res.json();
    },
    onSuccess: (data: any) => {
      applyDetails(data);

      if (data.status === "completed") {
        const cocMatches = data.matches.filter((m: any) => m.bracket === "champion_of_champions");
        if (cocMatches.length > 0) {
          const maxRound = Math.max(...cocMatches.map((m: any) => m.round));
          const finalMatch = cocMatches.find((m: any) => m.round === maxRound && m.matchIndex === 0);
          const overallChamp = finalMatch?.winnerId ? data.participants.find((p: any) => p.id === finalMatch.winnerId) : null;
          if (overallChamp) {
            toast({ title: `${overallChamp.name} is the Overall Champion!`, description: "Champion of Champions!" });
          }
        } else {
          toast({ title: "Tournament complete!", description: "All results have been finalized." });
        }

        if (data.emailStatus?.sent) {
          toast({ title: "Results emailed!", description: `Results sent to ${data.emailStatus.email}` });
        } else if (data.emailStatus?.error) {
          const errorMsg = data.emailStatus.error.includes("403")
            ? "Could not deliver email. Verify your domain at resend.com to send to all recipients."
            : data.emailStatus.error;
          toast({ title: "Email not sent", description: errorMsg, variant: "destructive" });
        }
      }
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const foulMutation = useMutation({
    mutationFn: async ({ matchId, participantId }: { matchId: string; participantId: string }) => {
      const res = await apiRequest("POST", `/api/matches/${matchId}/foul`, { participantId });
      const json = await res.json();
      return { ...json, _foulMatchId: matchId, _foulParticipantId: participantId };
    },
    onSuccess: (data: any) => {
      const { _foulMatchId, _foulParticipantId, ...tournamentData } = data;
      applyDetails(tournamentData);

      const foulledMatch = (tournamentData.matches as any[]).find((m: any) => m.id === _foulMatchId);
      if (foulledMatch?.winnerId) {
        const dqPlayer = tournamentData.participants.find((p: any) => p.id === _foulParticipantId);
        if (dqPlayer) {
          toast({ title: "Player Disqualified", description: `${dqPlayer.name} received 2 fouls and loses the match.`, variant: "destructive" });
        }
      }

      if (tournamentData.status === "completed") {
        if (tournamentData.emailStatus?.sent) {
          toast({ title: "Results emailed!", description: `Results sent to ${tournamentData.emailStatus.email}` });
        }
      }
    },
    onError: (err: Error) => toast({ title: "Foul Error", description: err.message, variant: "destructive" }),
  });

  const settingsMutation = useMutation({
    mutationFn: async (settings: { tableCount?: number; autoTables?: boolean; seedingMode?: SeedingMode }) => {
      const res = await apiRequest("PATCH", `/api/tournaments/${id}/settings`, settings);
      return res.json();
    },
    onSuccess: applyDetails,
    onError,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ matchId, tableNumber }: { matchId: string; tableNumber: number | null }) => {
      const res = await apiRequest("POST", `/api/matches/${matchId}/table`, { tableNumber });
      return res.json();
    },
    onSuccess: applyDetails,
    onError,
  });

  const undoMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const res = await apiRequest("POST", `/api/tournaments/${id}/undo`, { eventId });
      return res.json();
    },
    onSuccess: (data: TournamentWithDetails) => {
      applyDetails(data);
      toast({ title: "Undone", description: "The bracket is back to how it was before that result." });
    },
    onError,
  });

  const restartCategoryMutation = useMutation({
    mutationFn: async (category: string | null) => {
      const res = await apiRequest("POST", `/api/tournaments/${id}/restart-category`, { category });
      return res.json();
    },
    onSuccess: (data: TournamentWithDetails) => {
      applyDetails(data);
      toast({ title: "Class restarted", description: "Its bracket was cleared. Edit the entries if needed, then start it again." });
    },
    onError,
  });

  const bulkAddMutation = useMutation({
    mutationFn: async ({ entries, categories }: { entries: AthleteEntry[]; categories: string[] }) => {
      const res = await apiRequest("POST", `/api/tournaments/${id}/participants/bulk`, { entries, weightCategories: categories });
      return res.json();
    },
    onSuccess: (data: { added: number; skipped: number; tournament: TournamentWithDetails }) => {
      applyDetails(data.tournament);
      setAddOpen(false);
      toast({
        title: `${data.added} ${data.added === 1 ? "entry" : "entries"} added`,
        description: data.skipped ? `${data.skipped} skipped (already entered or class full).` : undefined,
      });
    },
    onError,
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ weightCategory, orderedIds }: { weightCategory: string | null; orderedIds: string[] }) => {
      const res = await apiRequest("POST", `/api/tournaments/${id}/participants/reorder`, { weightCategory, orderedIds });
      return res.json();
    },
    onSuccess: applyDetails,
    onError,
  });

  const shareMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", `/api/tournaments/${id}/share`, { enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id] });
    },
    onError,
  });

  // Offline app: there is nobody to share a link with, but the big-screen view
  // still works on this device (mirror it to a TV with AirPlay or a cable).
  async function openBigScreen() {
    try {
      let token = tournament?.shareToken ?? null;
      if (!token) {
        const res = await apiRequest("POST", `/api/tournaments/${id}/share`, { enabled: true });
        token = (await res.json()).shareToken;
        queryClient.invalidateQueries({ queryKey: ["/api/tournaments", id] });
      }
      if (token) navigate(`/live/${token}/tv`);
    } catch (err: any) {
      onError(err);
    }
  }

  function moveParticipant(list: Participant[], index: number, direction: -1 | 1, weightCategory: string | null) {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const ids = list.map(p => p.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderMutation.mutate({ weightCategory, orderedIds: ids });
  }

  useEffect(() => {
    if (!initialCategorySet && tournament?.weightCategories?.length) {
      setOpenCategory(tournament.weightCategories[0]);
      setInitialCategorySet(true);
    }
  }, [tournament, initialCategorySet]);

  function handleAddParticipant(e: React.FormEvent, category?: string) {
    e.preventDefault();
    const draft = category ? (categoryDrafts[category] || "") : newName;
    if (!draft.trim()) return;
    addParticipantMutation.mutate(
      { name: draft.trim(), weightCategory: category || undefined },
      {
        onSuccess: () => {
          if (category) {
            setCategoryDrafts(prev => ({ ...prev, [category]: "" }));
          } else {
            setNewName("");
          }
        },
      }
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b bg-card/50">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <Skeleton className="h-8 w-64" />
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Tournament not found</h2>
          <Link href="/">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Back to tournaments
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const isSetup = tournament.status === "setup";
  const isActive = tournament.status === "active" || tournament.status === "finals";
  const isCompleted = tournament.status === "completed";
  const isAwaitingCoc = tournament.status === "awaiting_coc";
  const participantCount = tournament.participants.length;
  const hasCategories = tournament.weightCategories && tournament.weightCategories.length > 0;
  const spotsLeft = hasCategories ? 0 : tournament.size - participantCount;
  const hasUnstartedCategories = hasCategories && tournament.weightCategories!.some(cat => !tournament.matches.some(m => m.weightCategory === cat));
  const sidebarAvailable = isSetup || ((isActive || isAwaitingCoc) && hasUnstartedCategories);
  const showSidebar = sidebarAvailable && !sidebarCollapsed;

  const isCategoryComplete = (cat: string) => categoryIsComplete(tournament.matches, cat);
  const unstartedCategories = hasCategories
    ? tournament.weightCategories!.filter(cat => !tournament.matches.some(m => m.weightCategory === cat))
    : [];
  const championCount = hasCategories
    ? tournament.weightCategories!.filter(cat => getCategoryChampion(tournament.matches, cat)).length
    : 0;
  const hasMatches = tournament.matches.length > 0;
  const seedingMode = (tournament.seedingMode as SeedingMode) ?? "sequential";
  const linkedCountOf = (p: Participant) =>
    p.athleteId ? tournament.participants.filter(x => x.athleteId === p.athleteId).length : 1;
  const selectWinner = (matchId: string, winnerId: string) => winnerMutation.mutate({ matchId, winnerId });
  const addFoul = (matchId: string, participantId: string) => foulMutation.mutate({ matchId, participantId });
  const resultPending = winnerMutation.isPending || foulMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-50 relative overflow-hidden">
        <div className="absolute inset-0 gradient-hero pointer-events-none opacity-50" />
        <div className="absolute bottom-0 left-0 right-0 h-[2px] status-bar-glow" />
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-x-4 gap-y-2 relative flex-wrap">
          <Link href="/">
            <Button size="icon" variant="ghost" className="hover:bg-primary/10" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary via-primary to-purple-700 flex items-center justify-center shrink-0 shadow-md shadow-primary/20">
              <Trophy className="w-4.5 h-4.5 text-primary-foreground" />
            </div>
            <h1 className="font-extrabold text-lg truncate" data-testid="text-tournament-title">{tournament.name}</h1>
            <StatusBadge status={tournament.status} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isSetup && !hasCategories && (
              <Button
                className="bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90 shadow-md shadow-primary/20"
                onClick={handleStartBracket}
                disabled={startMutation.isPending || participantCount < 2}
                data-testid="button-start-bracket"
              >
                <Play className="w-4 h-4 mr-1.5" />
                {startMutation.isPending ? "Starting..." : "Start Bracket"}
              </Button>
            )}
            {IS_LOCAL ? (
              hasMatches && (
                <Button variant="outline" className="border-primary/20 hover:bg-primary/5" onClick={openBigScreen} data-testid="button-big-screen">
                  <MonitorPlay className="w-4 h-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Big screen</span>
                </Button>
              )
            ) : (
              <Button
                variant="outline"
                className={cn("border-primary/20 hover:bg-primary/5", tournament.shareToken && "border-emerald-500/40 text-emerald-700")}
                onClick={() => setShareOpen(true)}
                data-testid="button-share"
              >
                <Radio className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">{tournament.shareToken ? "Live" : "Go live"}</span>
              </Button>
            )}
            {hasMatches && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="border-primary/20 hover:bg-primary/5" data-testid="button-export">
                    <Download className="w-4 h-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() => exportResultsPdf(tournament).catch(() => toast({ title: "Could not create the PDF", variant: "destructive" }))}
                    data-testid="menu-export-pdf"
                  >
                    <FileText className="w-4 h-4 mr-2" /> Results (PDF)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportResultsCsv(tournament)} data-testid="menu-export-results-csv">
                    <Table2 className="w-4 h-4 mr-2" /> Results (CSV)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMatchesCsv(tournament)} data-testid="menu-export-matches-csv">
                    <Table2 className="w-4 h-4 mr-2" /> Match log (CSV)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => { if (!printResults(tournament)) toast({ title: "Allow pop-ups to print", variant: "destructive" }); }}
                    data-testid="button-print-results"
                  >
                    <Printer className="w-4 h-4 mr-2" /> {usesShareSheet() ? "Results page (to print)" : "Print results"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => { if (!printBrackets(tournament)) toast({ title: "Allow pop-ups to print", variant: "destructive" }); }}
                    data-testid="menu-print-brackets"
                  >
                    <Printer className="w-4 h-4 mr-2" /> {usesShareSheet() ? "Bracket sheets (to print)" : "Print bracket sheets"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {hasMatches && (
              <UndoControls events={events} onUndo={(eventId) => undoMutation.mutate(eventId)} pending={undoMutation.isPending} />
            )}
            {(isActive || isCompleted || isAwaitingCoc) && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="border-primary/20 hover:bg-primary/5" data-testid="button-reset-tournament">
                    <RotateCcw className="w-4 h-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">Reset</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset tournament?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will clear all match results and return to setup mode. Participants will be kept.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
                      Reset
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className={cn("flex gap-8", showSidebar ? "flex-col lg:flex-row" : "flex-col")}>
          {sidebarAvailable && sidebarCollapsed && (
            <div className="mb-4">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="group flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 border-dashed border-primary/30 bg-primary/[0.03] hover:bg-primary/[0.08] hover:border-primary/50 transition-all duration-200 cursor-pointer"
                data-testid="button-expand-sidebar"
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <PanelLeft className="w-4 h-4 text-primary" />
                </div>
                <div className="text-left">
                  <span className="block text-sm font-semibold text-foreground">Show Participants Panel</span>
                  <span className="block text-[11px] text-muted-foreground">Edit rosters & manage weight classes</span>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground -rotate-90 ml-auto group-hover:text-primary transition-colors" />
              </button>
            </div>
          )}
          {showSidebar && (
            <div className="lg:w-80 shrink-0 space-y-3">
              <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-primary via-purple-500 to-primary/50" />
                <div className="px-4 py-3 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-purple-500/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold">Participants</h3>
                    <p className="text-[11px] text-muted-foreground">{participantCount} total across {hasCategories ? tournament.weightCategories!.length : 1} {hasCategories ? "categories" : "bracket"}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground shrink-0 border-border/60"
                    onClick={() => setSidebarCollapsed(true)}
                    data-testid="button-collapse-sidebar"
                    title="Collapse panel to see full bracket"
                  >
                    <PanelLeftClose className="w-3.5 h-3.5" />
                    <span className="font-bold text-[11px]">HIDE</span>
                  </Button>
                </div>

                {hasCategories && (() => {
                  const totalCats = tournament.weightCategories!.length;
                  const startedCats = tournament.weightCategories!.filter(cat => tournament.matches.some(m => m.weightCategory === cat)).length;
                  const completedCats = tournament.weightCategories!.filter(cat => isCategoryComplete(cat)).length;
                  const progressPct = totalCats > 0 ? Math.round(((startedCats) / totalCats) * 100) : 0;
                  return (
                    <div className="px-4 pb-3 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">
                          {completedCats > 0 && <span className="text-emerald-600">{completedCats} done</span>}
                          {completedCats > 0 && (startedCats - completedCats) > 0 && " · "}
                          {(startedCats - completedCats) > 0 && <span className="text-blue-600">{startedCats - completedCats} active</span>}
                          {startedCats > 0 && (totalCats - startedCats) > 0 && " · "}
                          {(totalCats - startedCats) > 0 && <span className="text-muted-foreground">{totalCats - startedCats} pending</span>}
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-purple-500 rounded-full transition-all duration-500"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}

                {(isSetup || unstartedCategories.length > 0) && (
                  <div className="px-4 pb-3 space-y-2.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-primary/30 text-primary hover:bg-primary/5 gap-1.5"
                      onClick={() => setAddOpen(true)}
                      data-testid="button-add-athletes"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Add athletes (paste a list, several classes)
                    </Button>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground shrink-0">Seeding</span>
                        <Select
                          value={seedingMode}
                          onValueChange={(v) => settingsMutation.mutate({ seedingMode: v as SeedingMode })}
                          disabled={settingsMutation.isPending}
                        >
                          <SelectTrigger className="h-7 text-xs flex-1" data-testid="select-seeding">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sequential">Registration order</SelectItem>
                            <SelectItem value="ranked">Ranked (1 v lowest)</SelectItem>
                            <SelectItem value="random">Random draw</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-snug" data-testid="text-seeding-help">{SEEDING_HELP[seedingMode]}</p>
                    </div>
                  </div>
                )}

                <Separator />

                <div className="p-3 space-y-2">
                  {hasCategories ? (
                    <>
                      {tournament.weightCategories!.map((cat) => {
                        const catParticipants = tournament.participants.filter(p => p.weightCategory === cat);
                        const catStarted = tournament.matches.some(m => m.weightCategory === cat);
                        const catComplete = isCategoryComplete(cat);
                        const canStartCat = !catStarted && catParticipants.length >= 2;
                        const catStatus: "complete" | "started" | "ready" | "needs-players" =
                          catComplete ? "complete" : catStarted ? "started" : catParticipants.length >= 2 ? "ready" : "needs-players";
                        return (
                          <CollapsibleSection
                            key={cat}
                            title={cat}
                            count={catParticipants.length}
                            status={catStatus}
                            isOpen={openCategory === cat}
                            onToggle={() => setOpenCategory(prev => prev === cat ? null : cat)}
                          >
                            {catParticipants.length > 0 ? (
                              <div className="space-y-0.5">
                                {catParticipants.map((p, idx) => (
                                  <div key={p.id} className={cn(idx > 0 && "border-t border-border/20")}>
                                    <EditableParticipant
                                      participant={p} tournamentId={id!} canEdit={!catStarted} index={idx + 1}
                                      linkedCount={linkedCountOf(p)}
                                      onMove={seedingMode === "random" ? undefined : (dir) => moveParticipant(catParticipants, idx, dir, cat)}
                                      canMoveUp={idx > 0} canMoveDown={idx < catParticipants.length - 1}
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="py-3 text-center">
                                <UserCircle className="w-8 h-8 mx-auto text-muted-foreground/40 mb-1" />
                                <p className="text-[11px] text-muted-foreground">No participants yet</p>
                              </div>
                            )}
                            {(isSetup || (!catStarted && (isActive || isAwaitingCoc))) && !catStarted && (
                              <form
                                onSubmit={(e) => handleAddParticipant(e, cat)}
                                className="flex gap-2 mt-2 pt-2 border-t border-border/30"
                                data-testid={`form-add-participant-${cat}`}
                              >
                                <Input
                                  placeholder="Add participant…"
                                  value={categoryDrafts[cat] || ""}
                                  onChange={e => setCategoryDrafts(prev => ({ ...prev, [cat]: e.target.value }))}
                                  className="flex-1 h-8 text-xs bg-muted/30 border-border/40 focus:bg-background"
                                  data-testid={`input-add-participant-${cat}`}
                                />
                                <Button
                                  type="submit"
                                  size="icon"
                                  className="h-8 w-8 shrink-0"
                                  disabled={addParticipantMutation.isPending || !(categoryDrafts[cat] || "").trim()}
                                  data-testid={`button-add-participant-${cat}`}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </Button>
                              </form>
                            )}
                            {canStartCat && (
                              <Button
                                size="sm"
                                className="w-full mt-2.5 bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90 shadow-sm shadow-primary/20 gap-1.5"
                                onClick={() => handleStartCategory(cat)}
                                disabled={startCategoryMutation.isPending}
                                data-testid={`button-start-category-${cat}`}
                              >
                                <Play className="w-3 h-3" />
                                {startCategoryMutation.isPending ? "Starting…" : "Start This Category"}
                              </Button>
                            )}
                            {catStarted && !catComplete && (
                              <div className="flex items-center gap-1.5 mt-2 py-1 px-2 rounded-md bg-blue-500/5 text-[10px] text-blue-600 font-medium">
                                <Play className="w-3 h-3 fill-blue-500" />
                                <span>In progress</span>
                              </div>
                            )}
                            {catComplete && (
                              <div className="flex items-center gap-1.5 mt-2 py-1 px-2 rounded-md bg-emerald-500/5 text-[10px] text-emerald-600 font-medium">
                                <Check className="w-3 h-3" />
                                <span>Complete</span>
                              </div>
                            )}
                          </CollapsibleSection>
                        );
                      })}

                      {(() => {
                        const unstartedCats = tournament.weightCategories!.filter(
                          cat => !tournament.matches.some(m => m.weightCategory === cat)
                        );
                        const startableCats = unstartedCats.filter(
                          cat => tournament.participants.filter(p => p.weightCategory === cat).length >= 2
                        );
                        return startableCats.length > 1 ? (
                          <Button
                            className="w-full mt-1 bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90 shadow-md shadow-primary/20 gap-1.5"
                            onClick={() => {
                              for (const cat of startableCats) {
                                const catPlayers = tournament.participants.filter(p => p.weightCategory === cat);
                                if (catPlayers.length % 2 === 0 || catPlayers.length < 3) {
                                  startCategoryMutation.mutate({ category: cat });
                                }
                              }
                              const oddCats = startableCats.filter(cat => {
                                const count = tournament.participants.filter(p => p.weightCategory === cat).length;
                                return count % 2 !== 0 && count >= 3;
                              });
                              if (oddCats.length > 0) {
                                handleStartCategory(oddCats[0]);
                              }
                            }}
                            disabled={startMutation.isPending || startCategoryMutation.isPending}
                            data-testid="button-start-bracket-sidebar"
                          >
                            <Zap className="w-4 h-4" />
                            {startMutation.isPending || startCategoryMutation.isPending ? "Starting..." : `Start All ${startableCats.length} Categories`}
                          </Button>
                        ) : null;
                      })()}
                    </>
                  ) : (
                    <>
                      {participantCount === 0 ? (
                        <div className="py-6 text-center">
                          <UserCircle className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
                          <p className="text-sm text-muted-foreground">No participants yet</p>
                          <p className="text-[11px] text-muted-foreground/70 mt-0.5">Add players below to get started</p>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          {tournament.participants.map((p, idx) => (
                            <div key={p.id} className={cn(idx > 0 && "border-t border-border/20")}>
                              <EditableParticipant
                                participant={p} tournamentId={id!} canEdit={isSetup} index={idx + 1}
                                onMove={seedingMode === "random" ? undefined : (dir) => moveParticipant(tournament.participants, idx, dir, null)}
                                canMoveUp={idx > 0} canMoveDown={idx < tournament.participants.length - 1}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      {isSetup && (
                        <form onSubmit={(e) => handleAddParticipant(e)} className="flex gap-2 mt-3">
                          <Input
                            placeholder="Participant name…"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="flex-1 h-9 text-sm bg-muted/30 border-border/40 focus:bg-background"
                            data-testid="input-add-participant"
                          />
                          <Button
                            type="submit"
                            size="icon"
                            disabled={addParticipantMutation.isPending || !newName.trim()}
                            data-testid="button-add-participant"
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                        </form>
                      )}
                      {participantCount > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-2">
                          Empty spots will automatically get byes
                        </p>
                      )}
                      {participantCount >= 2 && (
                        <Button
                          className="w-full mt-3 bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90 shadow-md shadow-primary/20 gap-1.5"
                          onClick={handleStartBracket}
                          disabled={startMutation.isPending}
                          data-testid="button-start-bracket-sidebar"
                        >
                          <Zap className="w-4 h-4" />
                          {startMutation.isPending ? "Starting..." : "Start Bracket"}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl bg-gradient-to-br from-primary/5 via-transparent to-amber-500/5 border border-border/40 p-4 text-[13px] text-muted-foreground space-y-2">
                <p className="font-bold text-foreground text-xs uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  How It Works
                </p>
                <div className="flex gap-2.5 items-start"><span className="font-bold text-primary text-xs mt-px">1</span><span>Add players to each weight class</span></div>
                <div className="flex gap-2.5 items-start"><span className="font-bold text-primary text-xs mt-px">2</span><span>Start categories when ready</span></div>
                <div className="flex gap-2.5 items-start"><span className="font-bold text-primary text-xs mt-px">3</span><span>Click a player to pick the winner</span></div>
                <div className="flex gap-2.5 items-start"><span className="font-bold text-primary text-xs mt-px">4</span><span>Losers drop to the losers bracket</span></div>
                <div className="flex gap-2.5 items-start"><span className="font-bold text-primary text-xs mt-px">5</span><span>Lose twice and you're out</span></div>
                <div className="flex gap-2.5 items-start"><span className="font-bold text-primary text-xs mt-px">6</span><span>Grand Final decides the champion</span></div>
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0">
            {isSetup && tournament.matches.length === 0 && !sidebarCollapsed && (
              <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-dashed border-primary/20 bg-gradient-to-br from-primary/[0.02] via-transparent to-amber-500/[0.02]">
                <div className="relative mb-5">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 via-primary/10 to-purple-500/5 flex items-center justify-center">
                    <Trophy className="w-8 h-8 text-primary" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-md">
                    <Zap className="w-3 h-3 text-white" />
                  </div>
                </div>
                <h3 className="font-bold text-lg mb-1">Bracket Preview</h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  {participantCount < 2
                    ? "Add at least 2 participants to start the bracket."
                    : "All set! Click 'Start Bracket' to generate the matches."}
                </p>
              </div>
            )}

            {isSetup && sidebarCollapsed && hasCategories && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold text-base">Weight Categories</h2>
                  {(() => {
                    const startableCats = tournament.weightCategories!.filter(cat => {
                      const catStarted = tournament.matches.some(m => m.weightCategory === cat);
                      const catPlayers = tournament.participants.filter(p => p.weightCategory === cat);
                      return !catStarted && catPlayers.length >= 2;
                    });
                    return startableCats.length > 1 ? (
                      <Button
                        size="sm"
                        className="bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90"
                        onClick={() => {
                          for (const cat of startableCats) {
                            const catPlayers = tournament.participants.filter(p => p.weightCategory === cat);
                            if (catPlayers.length % 2 === 0 || catPlayers.length < 3) {
                              startCategoryMutation.mutate({ category: cat });
                            }
                          }
                          const oddCats = startableCats.filter(cat => {
                            const count = tournament.participants.filter(p => p.weightCategory === cat).length;
                            return count % 2 !== 0 && count >= 3;
                          });
                          if (oddCats.length > 0) {
                            handleStartCategory(oddCats[0]);
                          }
                        }}
                        disabled={startCategoryMutation.isPending}
                        data-testid="button-start-all-categories-inline"
                      >
                        <Zap className="w-3.5 h-3.5 mr-1.5" />
                        Start All {startableCats.length} Categories
                      </Button>
                    ) : null;
                  })()}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {tournament.weightCategories!.map(cat => {
                    const catParticipants = tournament.participants.filter(p => p.weightCategory === cat);
                    const catStarted = tournament.matches.some(m => m.weightCategory === cat);
                    return (
                      <Card key={cat} className="border-primary/10">
                        <CardContent className="p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <Trophy className="w-4 h-4 text-primary" />
                            <span className="font-semibold text-sm truncate">{cat}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mb-4">
                            {catParticipants.length} participant{catParticipants.length !== 1 ? "s" : ""}
                          </p>
                          {!catStarted && catParticipants.length >= 2 ? (
                            <Button
                              size="sm"
                              className="w-full bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90"
                              onClick={() => handleStartCategory(cat)}
                              disabled={startCategoryMutation.isPending}
                              data-testid={`button-start-category-card-${cat}`}
                            >
                              <Play className="w-3.5 h-3.5 mr-1.5" />
                              {startCategoryMutation.isPending ? "Starting…" : "Start Category"}
                            </Button>
                          ) : !catStarted ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full"
                              onClick={() => { setSidebarCollapsed(false); setOpenCategory(cat); }}
                            >
                              <Plus className="w-3.5 h-3.5 mr-1.5" />
                              Add Participants
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                              <Check className="w-3 h-3" />
                              <span>Bracket started</span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {(isActive || isCompleted || isAwaitingCoc) && (
              <div>
                {isActive && (
                  <div className="mb-8">
                    <MatchControl
                      tournament={tournament}
                      onSelectWinner={selectWinner}
                      onFoul={addFoul}
                      onAssign={(matchId, tableNumber) => assignMutation.mutate({ matchId, tableNumber })}
                      onSettings={(settings) => settingsMutation.mutate(settings)}
                      busy={resultPending || settingsMutation.isPending || assignMutation.isPending}
                    />
                  </div>
                )}
                <div className="flex items-center gap-3 mb-6">
                  <div>
                    <h2 className="font-semibold text-base">
                      {isCompleted ? "Tournament Results" : tournament.status === "finals" ? "Champion of Champions" : isAwaitingCoc ? "All Categories Complete" : "Tournament Bracket"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {tournament.status === "finals"
                        ? "Category champions are battling — pick winners to crown the overall champion"
                        : isAwaitingCoc
                          ? "Decide whether to hold a Champion of Champions round"
                          : isActive
                            ? "Click a player to advance them as the winner of their match"
                            : "Final rankings and results"}
                    </p>
                  </div>
                </div>

                {isCompleted && (
                  <>
                    <ResultsSummary tournament={tournament} />
                    <Separator className="my-8" />
                  </>
                )}

                {isAwaitingCoc && hasCategories && (
                  <>
                    <div className="mb-6 p-4 rounded-md border border-amber-500/30 bg-amber-500/5">
                      <div className="flex items-center gap-3 mb-3">
                        <Crown className="w-5 h-5 text-amber-500 shrink-0" />
                        <div>
                          <p className="font-semibold text-sm" data-testid="text-awaiting-title">
                            {unstartedCategories.length > 0 ? "Every class that was started is complete" : "All weight class brackets are complete!"}
                          </p>
                          {unstartedCategories.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {unstartedCategories.length} {unstartedCategories.length === 1 ? "class has" : "classes have"} not started.
                              Start {unstartedCategories.length === 1 ? "it" : "them"} from the participants panel, or finish the tournament here.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {championCount >= 2 && (
                        <Button
                          size="sm"
                          className="bg-amber-500 hover:bg-amber-600 text-white"
                          onClick={handleStartCoc}
                          disabled={startCocMutation.isPending || skipCocMutation.isPending}
                          data-testid="button-start-coc-inline"
                        >
                          <Crown className="w-3.5 h-3.5 mr-1.5" />
                          {startCocMutation.isPending ? "Starting…" : "Start Champion of Champions"}
                        </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => skipCocMutation.mutate()}
                          disabled={skipCocMutation.isPending || startCocMutation.isPending}
                          data-testid="button-skip-coc-inline"
                        >
                          {skipCocMutation.isPending ? "Ending…" : "End Tournament"}
                        </Button>
                      </div>
                    </div>
                    <div className="mb-8">
                      <CollapsibleSection
                        title="Category Rankings"
                        count={(tournament.weightCategories ?? []).length}
                        defaultOpen={false}
                      >
                        <div className="grid gap-4 md:grid-cols-2 mt-2">
                          {(tournament.weightCategories ?? []).map(cat => {
                            const rankings = computeCategoryRankings(tournament.matches, tournament.participants, cat);
                            return <RankingsTable key={cat} rankings={rankings} title={cat} />;
                          })}
                          <TeamStandingsTable teams={computeTeamStandings(tournament)} />
                        </div>
                      </CollapsibleSection>
                    </div>
                    <Separator className="my-8" />
                  </>
                )}

                {hasCategories ? (
                  <>
                    {tournament.matches.some(m => m.bracket === "champion_of_champions") && (
                      <div className="mb-8">
                        <ChampionOfChampionsBracket
                          tournament={tournament}
                          onSelectWinner={selectWinner}
                          onFoul={addFoul}
                          foulPending={resultPending}
                        />
                        <Separator className="my-8" />
                      </div>
                    )}
                    <Tabs defaultValue={tournament.weightCategories![0]} className="w-full">
                      <TabsList className="mb-4 flex-wrap h-auto gap-1" data-testid="tabs-weight-categories">
                        {tournament.weightCategories!.map(cat => {
                          const catComplete = isCategoryComplete(cat);
                          const catStarted = tournament.matches.some(m => m.weightCategory === cat);
                          return (
                            <TabsTrigger key={cat} value={cat} className="relative" data-testid={`tab-category-${cat}`}>
                              {cat}
                              {catComplete && (
                                <Check className="w-3 h-3 ml-1 text-green-500" />
                              )}
                              {!catStarted && !catComplete && (
                                <span className="w-2 h-2 ml-1 rounded-full bg-amber-400 inline-block" />
                              )}
                            </TabsTrigger>
                          );
                        })}
                      </TabsList>
                      {tournament.weightCategories!.map(cat => {
                        const catComplete = isCategoryComplete(cat);
                        const catStarted = tournament.matches.some(m => m.weightCategory === cat);
                        const catParticipants = tournament.participants.filter(p => p.weightCategory === cat);
                        const rankings = catComplete ? computeCategoryRankings(tournament.matches, tournament.participants, cat) : [];
                        return (
                          <TabsContent key={cat} value={cat}>
                            {!catStarted ? (
                              <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-primary/20 bg-gradient-to-br from-primary/[0.02] via-transparent to-amber-500/[0.02]">
                                <div className="relative mb-5">
                                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/15 via-primary/10 to-purple-500/5 flex items-center justify-center">
                                    <Trophy className="w-7 h-7 text-primary" />
                                  </div>
                                </div>
                                <h3 className="font-bold text-lg mb-1" data-testid={`text-category-ready-${cat}`}>{cat}</h3>
                                <p className="text-sm text-muted-foreground mb-4">
                                  {catParticipants.length < 2
                                    ? `${catParticipants.length} participant${catParticipants.length !== 1 ? "s" : ""} — need at least 2 to start`
                                    : `${catParticipants.length} participants ready`}
                                </p>
                                {catParticipants.length >= 2 && (
                                  <Button
                                    className="bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90 shadow-md shadow-primary/20"
                                    onClick={() => handleStartCategory(cat)}
                                    disabled={startCategoryMutation.isPending}
                                    data-testid={`button-start-category-inline-${cat}`}
                                  >
                                    <Play className="w-4 h-4 mr-2" />
                                    {startCategoryMutation.isPending ? "Starting…" : "Start This Category"}
                                  </Button>
                                )}
                                {catParticipants.length < 2 && (
                                  <Button
                                    variant="outline"
                                    onClick={() => { setSidebarCollapsed(false); setOpenCategory(cat); }}
                                    data-testid={`button-add-players-${cat}`}
                                  >
                                    <Plus className="w-4 h-4 mr-2" />
                                    Add Participants
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <>
                                {!isCompleted && (
                                  <div className="flex justify-end mb-2">
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="sm" className="h-7 text-[11px] text-muted-foreground hover:text-destructive" data-testid={`button-restart-category-${cat}`}>
                                          <RotateCcw className="w-3 h-3 mr-1.5" />
                                          Restart this class
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Restart {cat}?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            This clears every result in this class only and lets you edit its entries and draw it again.
                                            Other classes keep their results. This cannot be undone.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => restartCategoryMutation.mutate(cat)} disabled={restartCategoryMutation.isPending}>
                                            Restart class
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </div>
                                )}
                                {catComplete && rankings.length > 0 && (
                                  <div className="mb-6">
                                    <CollapsibleSection
                                      title={`${cat} — Rankings`}
                                      count={rankings.length}
                                      defaultOpen={false}
                                    >
                                      <RankingsTable rankings={rankings} title={`${cat}`} />
                                    </CollapsibleSection>
                                  </div>
                                )}
                                <BracketView
                                  tournament={tournament}
                                  onSelectWinner={selectWinner}
                                  onFoul={addFoul}
                                  foulPending={resultPending}
                                  weightCategory={cat}
                                />
                              </>
                            )}
                          </TabsContent>
                        );
                      })}
                    </Tabs>
                  </>
                ) : (
                  <BracketView
                    tournament={tournament}
                    onSelectWinner={selectWinner}
                    onFoul={addFoul}
                    foulPending={resultPending}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={spinWheelOpen} onOpenChange={setSpinWheelOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-spin-wheel">
          <DialogHeader>
            <DialogTitle className="text-center">
              {spinCategory && spinCategory !== "__default"
                ? `Bye Selection — ${spinCategory}`
                : "Random Bye Selection"}
            </DialogTitle>
          </DialogHeader>
          {spinPlayers.length > 0 && (
            <SpinWheel
              key={`spin-${spinCategory}`}
              players={spinPlayers}
              title={spinCategory && spinCategory !== "__default" ? spinCategory : undefined}
              onResult={handleSpinResult}
            />
          )}
        </DialogContent>
      </Dialog>

      <AddAthletesDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        categories={hasCategories ? unstartedCategories : []}
        pending={bulkAddMutation.isPending}
        onSubmit={(entries, categories) => bulkAddMutation.mutate({ entries, categories })}
      />

      {!IS_LOCAL && <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        shareToken={tournament.shareToken ?? null}
        viewers={eventsData?.viewers ?? 0}
        pending={shareMutation.isPending}
        onToggle={(enabled) => shareMutation.mutate(enabled)}
      />}

      <Dialog open={cocSpinOpen} onOpenChange={setCocSpinOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-coc-spin-wheel">
          <DialogHeader>
            <DialogTitle className="text-center">Champion of Champions — Bye Selection</DialogTitle>
          </DialogHeader>
          {cocSpinPlayers.length > 0 && (
            <SpinWheel
              key="coc-spin"
              players={cocSpinPlayers}
              title="Category Champions"
              onResult={handleCocSpinResult}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
