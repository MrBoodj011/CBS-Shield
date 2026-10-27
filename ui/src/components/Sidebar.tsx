import {
  Activity,
  Archive,
  Flame,
  History,
  Info,
  LayoutDashboard,
  RefreshCw,
  Settings,
  ShieldCheck,
} from "lucide-react";

import { useI18n, type TranslationKey } from "../lib/i18n";
import type { AppInfo, EngineStatus, SectionId } from "../types";
import { Logo } from "./Logo";

interface NavItem {
  id: SectionId;
  labelKey: TranslationKey;
  icon: typeof LayoutDashboard;
}

interface NavGroup {
  labelKey: TranslationKey;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "nav.group.protection",
    items: [
      { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { id: "antivirus", labelKey: "nav.antivirus", icon: ShieldCheck },
      { id: "history", labelKey: "nav.history", icon: History },
      { id: "quarantine", labelKey: "nav.quarantine", icon: Archive },
    ],
  },
  {
    labelKey: "nav.group.insight",
    items: [
      { id: "network", labelKey: "nav.network", icon: Activity },
      { id: "firewall", labelKey: "nav.firewall", icon: Flame },
    ],
  },
  {
    labelKey: "nav.group.system",
    items: [
      { id: "updates", labelKey: "nav.updates", icon: RefreshCw },
      { id: "settings", labelKey: "nav.settings", icon: Settings },
      { id: "about", labelKey: "nav.about", icon: Info },
    ],
  },
];

interface SidebarProps {
  section: SectionId;
  onSelect: (section: SectionId) => void;
  engine: EngineStatus | null;
  info: AppInfo | null;
}

export function Sidebar({ section, onSelect, engine, info }: SidebarProps) {
  const { t } = useI18n();

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo size={38} />
        <div className="brand__text">
          <span className="brand__name">CBS SHIELD</span>
          <span className="brand__vendor">by Cybrense</span>
        </div>
      </div>

      <nav className="nav" aria-label={t("nav.main")}>
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.labelKey}>
            <span className="nav-group__label">{t(group.labelKey)}</span>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav__item ${active ? "is-active" : ""}`}
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? "page" : undefined}
                  title={t(item.labelKey)}
                >
                  <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
                  <span className="nav__text">{t(item.labelKey)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className={`engine-mini ${engine?.installed ? "is-online" : "is-offline"}`}>
          <span className="engine-mini__dot" aria-hidden="true" />
          <div>
            <strong>{engine?.installed ? t("engine.ready") : t("engine.missing")}</strong>
            <span>
              {engine?.installed
                ? `ClamAV · ${engine.signatureVersion ?? t("signature.missing")}`
                : t("posture.unavailableHint")}
            </span>
          </div>
        </div>
        <div className="sidebar__meta">
          <span>v{info?.version ?? "0.7.0-dev"}</span>
          <span className="sidebar__experimental">{t("common.experimental")}</span>
        </div>
      </div>
    </aside>
  );
}
