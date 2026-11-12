import { useEffect, useRef, useState } from "react";
import { IS_LOCAL, subscribeLocal } from "@/lib/backend";

/**
 * Subscribes to a server-sent-events stream and calls `onUpdate` whenever the
 * tournament changes (and again after any reconnect, to catch what was missed).
 * Returns whether the live connection is currently up.
 */
export function useLiveUpdates(streamUrl: string | null, onUpdate: () => void, onClosed?: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const updateRef = useRef(onUpdate);
  const closedRef = useRef(onClosed);
  updateRef.current = onUpdate;
  closedRef.current = onClosed;

  useEffect(() => {
    if (!streamUrl) return;
    if (IS_LOCAL) {
      // Offline app: changes are announced inside the app, there is no connection to lose.
      setConnected(true);
      const unsubscribe = subscribeLocal(streamUrl, () => updateRef.current(), () => closedRef.current?.());
      return () => {
        unsubscribe();
        setConnected(false);
      };
    }
    if (typeof EventSource === "undefined") return;
    let first = true;
    const source = new EventSource(streamUrl, { withCredentials: true });
    source.addEventListener("hello", () => {
      setConnected(true);
      if (!first) updateRef.current();
      first = false;
    });
    source.addEventListener("update", () => updateRef.current());
    source.addEventListener("closed", () => closedRef.current?.());
    source.onerror = () => setConnected(false);
    return () => {
      source.close();
      setConnected(false);
    };
  }, [streamUrl]);

  return connected;
}
