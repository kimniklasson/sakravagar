import { useCallback, useEffect, useState } from "react";
import type { EventStats } from "@/app/api/events/stats/route";
import { fetchLiveEvents } from "../layers";

export function useLiveEventSummary(): {
  eventStats: EventStats | null;
  liveCount: number;
  now: number;
  refreshLiveCount: () => Promise<void>;
  setLiveCount: (count: number) => void;
} {
  const [liveCount, setLiveCount] = useState(0);
  const [eventStats, setEventStats] = useState<EventStats | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refreshEventStats = useCallback(async () => {
    const res = await fetch("/api/events/stats");
    if (!res.ok) {
      console.warn("failed to fetch event stats", await res.text());
      return;
    }
    setEventStats((await res.json()) as EventStats);
  }, []);

  const refreshLiveCount = useCallback(async () => {
    const liveEvents = await fetchLiveEvents();
    setLiveCount(liveEvents.length);
  }, []);

  useEffect(() => {
    void refreshEventStats();
    void refreshLiveCount();
    const id = window.setInterval(() => {
      setNow(Date.now());
      void refreshEventStats();
      void refreshLiveCount();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [refreshEventStats, refreshLiveCount]);

  return { eventStats, liveCount, now, refreshLiveCount, setLiveCount };
}
