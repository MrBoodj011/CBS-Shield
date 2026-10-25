import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import type { Tone } from "../lib/format";

interface ModalProps {
  open: boolean;
  title: string;
  eyebrow?: string;
  tone?: Tone;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  wide?: boolean;
}

export function Modal({
  open,
  title,
  eyebrow,
  tone = "info",
  onClose,
  children,
  footer,
  busy = false,
  wide = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`modal modal--${tone} ${wide ? "modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal__head">
          <div>
            {eyebrow && <span className="modal__eyebrow">{eyebrow}</span>}
            <h2 id="modal-title">{title}</h2>
          </div>
          <button
            type="button"
            className="button button--ghost button--icon"
            onClick={onClose}
            disabled={busy}
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>
        {children && <div className="modal__body">{children}</div>}
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
