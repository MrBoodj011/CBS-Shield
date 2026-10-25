import { Ban, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "./Badge";

interface UnavailablePanelProps {
  title: string;
  icon?: LucideIcon;
  description: string;
  features: string[];
  footer?: ReactNode;
  statusLabel?: string;
}

export function UnavailablePanel({
  title,
  icon: Icon = Ban,
  description,
  features,
  footer,
  statusLabel = "Non disponible",
}: UnavailablePanelProps) {
  return (
    <div className="unavailable">
      <div className="unavailable__head">
        <div className="unavailable__icon">
          <Icon size={28} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <div>
          <div className="unavailable__title">
            <h2>{title}</h2>
            <Badge tone="neutral" dot>
              {statusLabel}
            </Badge>
          </div>
          <p>{description}</p>
        </div>
      </div>

      <div className="unavailable__grid">
        {features.map((feature) => (
          <div key={feature} className="unavailable__item">
            <span className="unavailable__marker" aria-hidden="true" />
            <span>{feature}</span>
          </div>
        ))}
      </div>

      {footer && <div className="unavailable__footer">{footer}</div>}
    </div>
  );
}
