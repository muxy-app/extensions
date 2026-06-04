import { useCallback, useState } from "react";

export function use_persistent_value<T extends string>(key: string, initial: T) {
  const [value, set] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: T) => {
      set(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        void 0;
      }
    },
    [key],
  );

  return [value, update] as const;
}
