import { Modal } from "../ui/modal.jsx";
import { Icon } from "../ui/icon.jsx";
import { copyToClipboard } from "../lib/clipboard.js";
import { toast } from "../ui/toast.js";

function prettify(value) {
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object")
            return { text: JSON.stringify(parsed, null, 2), kind: "JSON" };
    } catch {
        return { text: value, kind: "Text" };
    }
    return { text: value, kind: "Text" };
}

export function CellViewerModal({ value, onClose }) {
    const raw = value === null ? "" : String(value);
    const { text, kind } = prettify(raw);
    const copy = () => {
        copyToClipboard(raw);
        toast("Copied");
    };
    return (
        <Modal
            icon="eye"
            title={`Cell (${kind}, ${raw.length} chars)`}
            size="lg"
            onClose={onClose}
            headerActions={
                <button className="icon-btn" title="Copy" onClick={copy}>
                    <Icon name="copy" />
                </button>
            }
        >
            <pre
                className="mono sheet-body"
                style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "var(--font-body)" }}
            >
                {text}
            </pre>
        </Modal>
    );
}
