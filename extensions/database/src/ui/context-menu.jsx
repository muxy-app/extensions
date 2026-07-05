import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ContextMenu({ x, y, items, onClose }) {
    const menuRef = useRef(null);
    const [pos, setPos] = useState({ left: x, top: y, visible: false });

    useLayoutEffect(() => {
        const rect = menuRef.current.getBoundingClientRect();
        let left = x;
        let top = y;
        if (left + rect.width > window.innerWidth)
            left = window.innerWidth - rect.width - 8;
        if (top + rect.height > window.innerHeight)
            top = window.innerHeight - rect.height - 8;
        setPos({ left, top, visible: true });
    }, [x, y]);

    useLayoutEffect(() => {
        const onDown = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target))
                onClose();
        };
        window.addEventListener("mousedown", onDown);
        window.addEventListener("scroll", onClose, { capture: true });
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("scroll", onClose, { capture: true });
        };
    }, [onClose]);

    return createPortal(
        <div
            ref={menuRef}
            className="menu"
            style={{
                position: "fixed",
                left: pos.left,
                top: pos.top,
                zIndex: 60,
                visibility: pos.visible ? "visible" : "hidden",
            }}
        >
            {items.map((item, index) =>
                item.separator ? (
                    <div key={index} style={{ height: "1px", margin: "var(--s2) 0", background: "var(--muxy-border)" }} />
                ) : (
                    <button
                        key={index}
                        className="tree-row w-full text-left"
                        onClick={() => {
                            onClose();
                            item.onClick();
                        }}
                    >
                        {item.label}
                    </button>
                ),
            )}
        </div>,
        document.body,
    );
}
