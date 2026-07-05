import { Icon } from "./icon.jsx";

export function EmptyState({ icon, title, description, children }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-[var(--s4)] px-[var(--s7)] text-center">
            <span className="text-muted-foreground">
                <Icon name={icon} size={24} />
            </span>
            {title ? <div className="text-[var(--font-emphasis)] font-semibold">{title}</div> : null}
            {description ? <div className="max-w-80 text-[var(--font-footnote)] text-muted-foreground">{description}</div> : null}
            {children}
        </div>
    );
}
