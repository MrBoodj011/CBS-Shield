import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Keeps keyboard focus inside a dialog, focuses it on open and restores the
 * previously focused control on close. Escape handling intentionally remains
 * with each dialog so busy states can refuse to close.
 */
export function useFocusTrap<T extends HTMLElement>(
  open: boolean,
  lockScroll = true,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = ref.current;
    if (!container) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";

    const initial = window.setTimeout(() => {
      if (container.contains(document.activeElement)) return;
      container.focus({ preventScroll: true });
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!active || active === container || !container.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(initial);
      document.removeEventListener("keydown", onKeyDown);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      previous?.focus({ preventScroll: true });
    };
  }, [open, lockScroll]);

  return ref;
}
