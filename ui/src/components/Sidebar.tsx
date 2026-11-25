import {
  Activity,
  Archive,
  Flame,
  Globe2,
  History,
  Info,
  LayoutDashboard,
  Radar,
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
      { id: "proactive", labelKey: "nav.proactive", icon: Radar },
      { id: "history", labelKey: "nav.history", icon: History },
      { id: "quarantine", labelKey: "nav.quarantine", icon: Archive },
    ],
  },
  {
    labelKey: "nav.group.insight",
    items: [
      { id: "network", labelKey: "nav.network", icon: Activity },
      { id: "firewall", labelKey: "nav.firewall", icon: Flame },
      { id: "webguard", labelKey: "nav.webguard", icon: Globe2 },
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

  const statusTone = !engine
    ? "neutral"
    : !engine.installed
      ? "danger"
      : engine.signatureState === "upToDate"
        ? "ok"
        : "warning";
  const statusTitle = !engine
    ? t("engine.checking")
    : engine.installed
      ? t("engine.ready")
      : t("engine.missing");
  const statusDetail = engine?.installed
    ? `ClamAV ${engine.engineVersion ?? ""} · ${t(`signature.${engine.signatureState}` as TranslationKey)}`
    : t("posture.unavailable");

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <Logo size={32} />
        <div className="sidebar__brand-text">
          <strong>CBS Shield</strong>
          <span>by Cybrense</span>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label={t("nav.main")}>
        {NAV_GROUPS.map((group) => (
          <div className="sidebar__group" key={group.labelKey}>
            <span className="sidebar__group-label">{t(group.labelKey)}</span>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar__item${active ? " is-active" : ""}`}
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? "page" : undefined}
                  title={t(item.labelKey)}
                >
                  <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span className="sidebar__item-text">{t(item.labelKey)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar__status"
          onClick={() => onSelect("updates")}
          title={`${statusTitle} — ${statusDetail}`}
        >
          <span className={`sidebar__status-dot is-${statusTone}`} aria-hidden="true" />
          <span className="sidebar__status-text">
            <strong>{statusTitle}</strong>
            <span>{statusDetail}</span>
          </span>
        </button>
        <div className="sidebar__meta">
          <span>v{info?.version ?? "0.9.0-dev"}</span>
          <span className="badge badge--warning">{t("common.experimental")}</span>
        </div>
      </div>
    </aside>
  );
}
