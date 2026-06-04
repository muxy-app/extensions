import { StrictMode, useEffect, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/global.css";

function fit(el: HTMLElement) {
  void muxy.popover?.resize(el.scrollWidth, el.scrollHeight).catch(() => undefined);
}

export function PopoverShell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => fit(el));
    observer.observe(el);
    fit(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-fit">
      {children}
    </div>
  );
}

export function mount_popover(node: ReactNode) {
  document.body.classList.add("popover-body");
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<StrictMode>{node}</StrictMode>);
}
