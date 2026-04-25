import { useEffect, useState } from "react";

/**
 * Re-renders the consumer at the requested interval, returning Date.now()
 * each time. Used for elapsed-time displays that don't need millisecond
 * precision. Stops ticking on unmount.
 */
export function useTickingNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
