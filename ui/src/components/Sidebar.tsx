import {
  Activity,
  Archive,
  Flame,
  LayoutDashboard,
  Settings,
  ShieldCheck,
} from "lucide-react";

import type { AppInfo, EngineStatus, SectionId } from "../types";
import { Logo } from "./Logo";

interface NavItem {
  id: SectionId;
  label: string;
  icon: typeof LayoutDashboard;
  hint?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "antivirus", label: "Antivirus", icon: ShieldCheck },
  { id: "firewall", label: "Firewall", icon: Flame, hint: "P2" },
  { id: "network", label: "Network Monitor", icon: Activity, hint: "P2" },
  { id: "quarantine", label: "Quarantaine", icon: Archive },
  { id: "settings", label: "Paramètres", icon: Settings },
];

interface SidebarProps {
  section: SectionId;
  onSelect: (section: SectionId) => void;
  engine: EngineStatus | null;
  info: AppInfo | null;
}

export function Sidebar({ section, onSelect, engine, info }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo size={38} />
        <div className="brand__text">
          <span className="brand__name">CBS SHIELD</span>
          <span className="brand__vendor">by Cybrense</span>
        </div>
      </div>

      <nav className="nav" aria-label="Sections principales">
        <span className="nav__label">Navigation</span>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const unavailable = item.id === "firewall" || item.id === "network";
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav__item ${active ? "is-active" : ""}`}
              onClick={() => onSelect(item.id)}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
              <span className="nav__text">{item.label}</span>
              {unavailable ? (
                <span className="nav__hint nav__hint--muted">P2</span>
              ) : item.hint ? (
                <span className="nav__hint">{item.hint}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <div className={`engine-mini ${engine?.installed ? "is-online" : "is-offline"}`}>
          <span className="engine-mini__dot" aria-hidden="true" />
          <div>
            <strong>{engine?.installed ? "Moteur ClamAV détecté" : "ClamAV absent"}</strong>
            <span>
              {engine?.installed
                ? `Signatures ${engine.signatureVersion ?? "absentes"}`
                : "Scan indisponible"}
            </span>
          </div>
        </div>
        <div className="sidebar__meta">
          <span>v{info?.version ?? "0.1.0"} · Phase 1</span>
          <span className="sidebar__experimental">Expérimental</span>
        </div>
      </div>
    </aside>
  );
}
