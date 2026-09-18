'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/** False during the static render and the first client render, true after mount (avoids hydration mismatches). */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Seconds to add to the local clock to get the chain's clock (latest block timestamp minus local time). The contract
 * decides every deadline with block.timestamp, so countdowns follow the chain when the two disagree. 0 by default.
 */
export const ClockOffsetContext = createContext(0);

/** Current time in unix seconds on the chain's clock, updated every `intervalMs`. Null until mounted. */
export function useNow(intervalMs = 1_000): number | null {
  const offset = useContext(ClockOffsetContext);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now === null ? null : now + offset;
}
