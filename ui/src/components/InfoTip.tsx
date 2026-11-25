import { Info } from "lucide-react";
import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../lib/i18n";

interface InfoTipProps {
  children: ReactNode;
  /** Accessible label of the trigger; defaults to "More information". */
  label?: string;
  /** Optional short text shown next to the icon; `true` = localized "Details". */
  text?: string | true;
  className?: string;
}

const BUBBLE_WIDTH = 320;
const MARGIN = 12;

/**
 * Small "ⓘ" trigger that reveals secondary explanations on hover, focus or
 * click. The explanation stays in the DOM (linked through aria-describedby)
 * so assistive technologies and tests still reach it; it is only hidden
 * visually until requested. The bubble is portalled to <body> and fixed, so
 * it is never clipped or offset by panels, tables or animated containers.
 */
export function InfoTip({ children, label, text, className = "" }: InfoTipProps) {
  const { language } = useI18n();
  const label_ = text === true ? (language === "en" ? "Details" : "Détails") : text;
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const bubbleHeight = bubbleRef.current?.offsetHeight ?? 0;
    const width = Math.min(BUBBLE_WIDTH, window.innerWidth - MARGIN * 2);
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN));
    let top = rect.bottom + 8;
    if (bubbleHeight && top + bubbleHeight > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, rect.top - bubbleHeight - 8);
    }
    setPosition({ top, left });
  }, []);

  const visible = open || pinned;

  useLayoutEffect(() => {
    if (!visible) return undefined;
    place();
    const close = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return;
      if (
        event.type === "pointerdown" &&
        (triggerRef.current?.contains(event.target as Node) ||
          bubbleRef.current?.contains(event.target as Node))
      ) {
        return;
      }
      setPinned(false);
      setOpen(false);
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [visible, place]);

  return (
    <span
      className={`infotip ${className}`.trim()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`infotip__trigger${label_ ? " infotip__trigger--text" : ""}`}
        aria-label={label_ ? undefined : (label ?? (language === "en" ? "More information" : "Plus d'informations"))}
        aria-describedby={id}
        aria-expanded={visible}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setPinned((value) => !value)}
      >
        <Info size={15} strokeWidth={2} aria-hidden="true" />
        {label_ && <span>{label_}</span>}
      </button>
      {createPortal(
        <span
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className={`infotip__bubble${visible ? " is-open" : ""}`}
          style={visible && position ? { top: position.top, left: position.left } : undefined}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {children}
        </span>,
        document.body,
      )}
    </span>
  );
}
