import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEmail } from "@/hooks/use-email";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Plus, Trash2, ArrowRight, Users, Calendar, Zap, Crown, LogOut, Radio, BarChart3 } from "lucide-react";
import type { Tournament, WeightClass, AgeCategory, Hand as HandType, Gender } from "@shared/schema";
import { IS_LOCAL } from "@/lib/backend";
import { LocalDataMenu } from "@/components/local-data-menu";

function StatusBadge({ status }: { status: string }) {
  if (status === "setup") return <Badge variant="secondary" className="border-0 bg-slate-500/15 text-slate-600 dark:text-slate-400" data-testid="badge-status">Setup</Badge>;
  if (status === "active") return <Badge className="border-0 bg-blue-500/15 text-blue-600 dark:text-blue-400" data-testid="badge-status">In Progress</Badge>;
  if (status === "awaiting_coc") return <Badge className="border-0 bg-amber-500/15 text-amber-600 dark:text-amber-400" data-testid="badge-status">Awaiting CoC</Badge>;
  if (status === "finals") return <Badge className="border-0 bg-amber-500/15 text-amber-600 dark:text-amber-400" data-testid="badge-status">Finals</Badge>;
  if (status === "completed") return <Badge className="border-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" data-testid="badge-status">Completed</Badge>;
  return null;
}

function TournamentCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="mt-4 flex items-center gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

const AGE_CATEGORIES: { value: AgeCategory; label: string }[] = [
  { value: "youth", label: "Youth" },
  { value: "subjuniors", label: "Sub-Juniors" },
  { value: "juniors", label: "Juniors" },
  { value: "seniors", label: "Seniors" },
  { value: "masters", label: "Masters" },
];

export default function Home() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [wcNames, setWcNames] = useState("");
  const [wcAge, setWcAge] = useState<AgeCategory | "">("");
  const [wcHand, setWcHand] = useState<HandType | "">("");
  const [wcGender, setWcGender] = useState<Gender | "">("");

  const { data: tournaments, isLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const { email: userEmail } = useEmail();

  function buildWeightClasses(): WeightClass[] {
    if (!wcAge || !wcHand || !wcGender) return [];
    return wcNames
      .split(",")
      .map(n => n.trim())
      .filter(n => n.length > 0)
      .map(n => ({
        name: n,
        ageCategory: wcAge as AgeCategory,
        hand: wcHand as HandType,
        gender: wcGender as Gender,
      }));
  }

  const parsedClasses = buildWeightClasses();
  const canCreate = name.trim() && parsedClasses.length >= 1;

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tournaments", {
        name,
        size: 128,
        weightClasses: parsedClasses,
        email: userEmail || undefined,
      });
      return res.json();
    },
    onSuccess: (data: Tournament) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments"] });
      setDialogOpen(false);
      setName("");
      setWcNames("");
      setWcAge("");
      setWcHand("");
      setWcGender("");
      toast({ title: "Tournament created", description: "Now add players to your weight classes." });
      navigate(`/tournament/${data.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/tournaments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments"] });
      toast({ title: "Tournament deleted" });
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    createMutation.mutate();
  }

  const formatDate = (date: string | Date) =>
    new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden gradient-hero">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl" />
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] status-bar-glow" />
        <div className="max-w-5xl mx-auto px-6 py-8 relative">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div className="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br from-primary via-primary to-purple-700 flex items-center justify-center glow-accent">
                <Trophy className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight" data-testid="text-app-title">
                  <span className="bg-gradient-to-r from-primary via-purple-500 to-primary bg-clip-text text-transparent">ARM WRESTLING</span>
                </h1>
                <p className="text-sm text-muted-foreground font-medium">Double Elimination Bracket Builder</p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
              {IS_LOCAL && <LocalDataMenu />}
              {user && !IS_LOCAL && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground hidden sm:inline" data-testid="text-username">
                    {user.username}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => logout()}
                    className="text-muted-foreground hover:text-foreground"
                    data-testid="button-logout"
                  >
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>
              )}
            <Link href="/athletes">
              <Button variant="outline" className="border-primary/20 hover:bg-primary/5" data-testid="button-athlete-records">
                <BarChart3 className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Athlete records</span>
              </Button>
            </Link>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90 shadow-lg shadow-primary/20" data-testid="button-create-tournament">
                  <Plus className="w-4 h-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">New Tournament</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-primary" />
                    Create Tournament
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="tournament-name">Tournament Name</Label>
                    <Input
                      id="tournament-name"
                      placeholder="e.g. Spring Championship 2026"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      data-testid="input-tournament-name"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wc-names">Weight Classes <span className="text-destructive">*</span></Label>
                    <Input
                      id="wc-names"
                      placeholder="e.g. 60kg, 70kg, 80kg, 90kg"
                      value={wcNames}
                      onChange={e => setWcNames(e.target.value)}
                      data-testid="input-wc-names"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Separate multiple weight classes with commas
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Age Category</Label>
                      <Select value={wcAge} onValueChange={(v) => setWcAge(v as AgeCategory)}>
                        <SelectTrigger className="h-9 text-sm" data-testid="select-wc-age">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {AGE_CATEGORIES.map(ac => (
                            <SelectItem key={ac.value} value={ac.value}>{ac.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Gender</Label>
                      <Select value={wcGender} onValueChange={(v) => setWcGender(v as Gender)}>
                        <SelectTrigger className="h-9 text-sm" data-testid="select-wc-gender">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="boys">Boys</SelectItem>
                          <SelectItem value="girls">Girls</SelectItem>
                          <SelectItem value="men">Men</SelectItem>
                          <SelectItem value="women">Women</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Hand</Label>
                    <Select value={wcHand} onValueChange={(v) => setWcHand(v as HandType)}>
                      <SelectTrigger className="h-9 text-sm" data-testid="select-wc-hand">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">Left Hand</SelectItem>
                        <SelectItem value="right">Right Hand</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {parsedClasses.length > 0 && (
                    <div className="rounded-lg bg-primary/5 border border-primary/10 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                        {parsedClasses.length} weight {parsedClasses.length === 1 ? "class" : "classes"} will be created
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {parsedClasses.map((wc, idx) => (
                          <Badge key={idx} className="bg-primary/10 text-primary border-0 text-xs" data-testid={`weight-class-preview-${idx}`}>
                            {wc.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1 bg-gradient-to-r from-primary to-purple-700"
                      disabled={createMutation.isPending || !canCreate}
                      data-testid="button-submit-tournament"
                    >
                      {createMutation.isPending ? "Creating..." : "Create Tournament"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <TournamentCardSkeleton key={i} />)}
          </div>
        ) : !tournaments || tournaments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/15 via-primary/10 to-amber-500/10 flex items-center justify-center">
                <Crown className="w-10 h-10 text-primary" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-2">No tournaments yet</h2>
            <p className="text-muted-foreground text-sm mb-8 max-w-sm">
              Create your first double elimination arm wrestling tournament and start building brackets.
            </p>
            <Button
              onClick={() => setDialogOpen(true)}
              className="bg-gradient-to-r from-primary to-purple-700 shadow-lg shadow-primary/20 px-6"
              data-testid="button-create-first"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Create Your First Tournament
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                {tournaments.length} {tournaments.length === 1 ? "Tournament" : "Tournaments"}
              </h2>
            </div>
            {tournaments.map(t => (
              <Card key={t.id} className="card-vibrant overflow-visible rounded-xl" data-testid={`card-tournament-${t.id}`}>
                <CardContent className="p-0 relative">
                  <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-gradient-to-b from-primary via-purple-500 to-primary/30" />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-5 pl-6">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-purple-500/5 hidden sm:flex items-center justify-center shrink-0 border border-primary/10">
                      <Trophy className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-[11rem]">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-bold text-base break-words min-w-0" data-testid={`text-tournament-name-${t.id}`}>{t.name}</span>
                        <StatusBadge status={t.status} />
                        {t.shareToken && !IS_LOCAL && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600" title="Public live link is on">
                            <Radio className="w-3 h-3" /> Live link on
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground flex-wrap">
                        {t.weightCategories && t.weightCategories.length > 0 && (
                          <span className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-primary/60" />
                            {t.weightCategories.length} weight {t.weightCategories.length === 1 ? "class" : "classes"}
                          </span>
                        )}
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-primary/60" />
                          {formatDate(t.createdAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-auto">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="hover:bg-destructive/10 hover:text-destructive"
                            disabled={deleteMutation.isPending}
                            aria-label={`Delete ${t.name}`}
                            data-testid={`button-delete-tournament-${t.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {t.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Its athletes, brackets and results are removed for good.
                              {IS_LOCAL && " It only exists on this device, so save a backup first if you may want it again."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep it</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMutation.mutate(t.id)} data-testid={`button-delete-confirm-${t.id}`}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <Link href={`/tournament/${t.id}`}>
                        <Button size="sm" className="bg-gradient-to-r from-primary to-purple-700 hover:from-primary/90 hover:to-purple-700/90 shadow-md shadow-primary/15" data-testid={`button-open-tournament-${t.id}`}>
                          Open
                          <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
