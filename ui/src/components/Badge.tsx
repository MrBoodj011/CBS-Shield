import type { ReactNode } from "react";

import type { Tone } from "../lib/format";

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  subtle?: boolean;
  className?: string;
}

export function Badge({
  tone = "neutral",
  children,
  dot = false,
  subtle = false,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`badge badge--${tone} ${subtle ? "badge--subtle" : ""} ${className}`.trim()}
    >
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
