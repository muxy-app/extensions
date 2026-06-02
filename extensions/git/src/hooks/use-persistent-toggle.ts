import { useCallback, useState } from "react";

const PREFIX = "muxy.git.section.";

export function use_persistent_toggle(key: string, initial: boolean) {
  const storageKey = PREFIX + key;

  const [value, set_value] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });

  const toggle = useCallback(() => {
    set_value((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        void 0;
      }
      return next;
    });
  }, [storageKey]);

  return [value, toggle] as const;
}
