import { Modal } from "../ui/modal.jsx";
import { Icon } from "../ui/icon.jsx";

export function ReviewSheet({ statements, onClose, onApply }) {
    return (
        <Modal icon="code" title="Review changes" size="xl" onClose={onClose}
            footer={
                <>
                    <button className="btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={onApply}>
                        <Icon name="check" />
                        {`Apply ${statements.length} statement${statements.length === 1 ? "" : "s"}`}
                    </button>
                </>
            }
        >
            <pre className="mono sheet-body" style={{ fontSize: "var(--font-body)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {statements.join("\n")}
            </pre>
        </Modal>
    );
}
