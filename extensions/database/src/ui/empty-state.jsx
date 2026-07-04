import { Icon } from "./icon.jsx";

export function EmptyState({ icon, size = 24, gap = "var(--s4)", children }) {
    return (
        <div className="flex h-full flex-col items-center justify-center text-muted-foreground" style={{ gap }}>
            <Icon name={icon} size={size} />
            {children}
        </div>
    );
}
