import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon size={26} strokeWidth={1.6} aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}
