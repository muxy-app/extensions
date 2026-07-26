import { changeCount } from "./pending-changes.js";

export function PendingBar({ changes, onReview, onDiscard, onApply }) {
    const count = changeCount(changes);
    if (!count)
        return null;
    return (
        <div className="pending-bar">
            <span className="text-[var(--font-emphasis)] font-semibold">{`${count} pending change${count === 1 ? "" : "s"}`}</span>
            <div className="flex-1" />
            <button className="btn btn-compact" onClick={onReview}>
                Review
            </button>
            <button className="btn btn-compact" onClick={onDiscard}>
                Discard
            </button>
            <button className="btn btn-compact btn-primary" onClick={onApply}>
                Apply
            </button>
        </div>
    );
}
