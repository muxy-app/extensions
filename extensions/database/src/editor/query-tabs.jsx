import { Icon } from "../ui/icon.jsx";

export function QueryTabs({ tabs, activeId, onSwitch, onClose, onAdd }) {
    return (
        <div className="pane-header-row query-tabs-row" style={{ borderColor: "var(--muxy-border)" }}>
            {tabs.map((tab) => {
                const active = tab.id === activeId;
                return (
                    <div
                        key={tab.id}
                        className={`query-tab ${active ? "active" : ""}`}
                        onClick={() => onSwitch(tab.id)}
                    >
                        {tab.title}
                        {tabs.length > 1 ? (
                            <button
                                className="icon-btn tab-close-btn"
                                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                            >
                                <Icon name="x" />
                            </button>
                        ) : null}
                    </div>
                );
            })}
            <button className="icon-btn" title="New query tab" onClick={onAdd}>
                <Icon name="plus" />
            </button>
        </div>
    );
}
