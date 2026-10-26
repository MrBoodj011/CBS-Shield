import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { Tone } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  eyebrow?: string;
  tone?: Tone;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  requireCheckbox?: string;
  requirePhrase?: string;
  phraseLabel?: string;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  eyebrow,
  tone = "warning",
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onClose,
  requireCheckbox,
  requirePhrase,
  phraseLabel,
  children,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const [phrase, setPhrase] = useState("");

  useEffect(() => {
    if (open) {
      setChecked(false);
      setPhrase("");
    }
  }, [open]);

  const checkboxOk = !requireCheckbox || checked;
  const phraseOk = !requirePhrase || phrase === requirePhrase;
  const canConfirm = checkboxOk && phraseOk && !busy;

  return (
    <Modal
      open={open}
      title={title}
      eyebrow={eyebrow}
      tone={tone}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="button"
            className={`button ${tone === "danger" ? "button--danger" : "button--primary"}`}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm__description">{description}</div>
      {children}
      {requireCheckbox && (
        <label className="confirm__check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            disabled={busy}
          />
          <span>{requireCheckbox}</span>
        </label>
      )}
      {requirePhrase && (
        <label className="field">
          <span className="field__label">
            {phraseLabel ?? t("confirm.typePhrase", { phrase: requirePhrase })}
          </span>
          <input
            className="input"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            placeholder={requirePhrase}
          />
        </label>
      )}
    </Modal>
  );
}
