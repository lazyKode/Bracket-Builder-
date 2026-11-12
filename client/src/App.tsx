import { useState, useCallback } from "react";
import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { EmailContext } from "@/hooks/use-email";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import TournamentPage from "@/pages/tournament";
import SplashScreen from "@/pages/splash";
import AuthPage from "@/pages/auth";
import AthletesPage from "@/pages/athletes";
import LivePage from "@/pages/live";
import { IS_LOCAL } from "@/lib/backend";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/tournament/:id" component={TournamentPage} />
      <Route path="/athletes" component={AthletesPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { user, isLoading } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
  const [email, setEmailState] = useState(() => localStorage.getItem("user_email") || "");

  const handleSplashFinish = useCallback(() => setShowSplash(false), []);
  const [location] = useLocation();

  // The spectator page is public: no splash screen, no login.
  if (location.startsWith("/live/")) {
    return (
      <Switch>
        <Route path="/live/:token" component={LivePage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  // Offline app: no accounts. Show the splash once per launch, then go straight in.
  if (IS_LOCAL && showSplash) {
    return <SplashScreen onFinish={handleSplashFinish} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        {showSplash && <SplashScreen onFinish={handleSplashFinish} />}
        {!showSplash && <AuthPage />}
      </>
    );
  }

  return (
    <EmailContext.Provider value={{ email, setEmail: setEmailState }}>
      <Router />
    </EmailContext.Provider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <AppContent />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
