"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresh the page while the run is doing work.
 *
 * A server-component refresh rather than a websocket: the run's progress is
 * already a row and a set of counters, and re-rendering the page every few
 * seconds is a fraction of the cost of holding a socket open per viewer for a
 * job measured in minutes. It stops the moment the run reaches a terminal state,
 * so a completed run is not polled forever in an abandoned tab.
 */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  return null;
}
