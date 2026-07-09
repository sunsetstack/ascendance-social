import { useCallback, useRef } from "react";

export function useRecentEventIds(limit = 500): (eventId: unknown) => boolean {
  const seenIdsRef = useRef<string[]>([]);
  const seenIdSetRef = useRef<Set<string>>(new Set());

  return useCallback(
    (eventId: unknown): boolean => {
      if (typeof eventId !== "string" || eventId.length === 0) {
        return true;
      }

      if (seenIdSetRef.current.has(eventId)) {
        return false;
      }

      seenIdSetRef.current.add(eventId);
      seenIdsRef.current.push(eventId);

      while (seenIdsRef.current.length > limit) {
        const oldestId = seenIdsRef.current.shift();
        if (oldestId) {
          seenIdSetRef.current.delete(oldestId);
        }
      }

      return true;
    },
    [limit],
  );
}
