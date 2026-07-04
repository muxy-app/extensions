import { changeCount } from "./pending-changes.js";

export function PendingBar({ changes, onReview, onDiscard, onApply }) {
    const count = changeCount(changes);
    if (!count)
        return null;
    return (
        <div
            className="flex items-center gap-[var(--s4)] border-t px-[var(--s5)] py-[var(--s3)]"
            style={{ borderColor: "var(--muxy-border)", background: "var(--muxy-accent-soft)" }}
        >
            <span className="text-[var(--font-emphasis)] font-semibold">{`${count} pending change${count === 1 ? "" : "s"}`}</span>
            <div className="flex-1" />
            <button className="btn" onClick={onReview}>
                Review
            </button>
            <button className="btn" onClick={onDiscard}>
                Discard
            </button>
            <button className="btn btn-primary" onClick={onApply}>
                Apply
            </button>
        </div>
    );
}
