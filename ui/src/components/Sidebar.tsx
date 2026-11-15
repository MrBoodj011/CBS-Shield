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

  return (
    <nav className="nav-rail" aria-label={t("nav.main")}>
      {NAV_GROUPS.map((group) => (
        <div className="nav-rail__group" key={group.labelKey}>
          <span className="nav-rail__group-label">{t(group.labelKey)}</span>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-rail__item ${active ? "is-active" : ""}`}
                onClick={() => onSelect(item.id)}
                aria-current={active ? "page" : undefined}
                title={t(item.labelKey)}
              >
                <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                <span className="nav-rail__item-text">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>
      ))}
      <div className="nav-rail__footer">
        <div className="nav-rail__engine">
          <span
            className={`nav-rail__engine-dot ${engine?.installed ? "is-online" : "is-offline"}`}
            aria-hidden="true"
          />
          <div>
            <strong>
              {engine?.installed ? t("engine.ready") : t("engine.missing")}
            </strong>
            <span>
              {engine?.installed
                ? `ClamAV · ${engine.signatureVersion ?? t("signature.missing")}`
                : t("posture.unavailableHint")}
            </span>
          </div>
        </div>
        <div className="nav-rail__meta">
          <span>v{info?.version ?? "0.9.0-dev"}</span>
          <span className="nav-rail__experimental">{t("common.experimental")}</span>
        </div>
      </div>
    </nav>
  );
}

/* Slim experimental chip on the rail footer. */
const railStyle = document.createElement("style");
railStyle.textContent = `
  .nav-rail__experimental {
    padding: 1px 7px;
    border-radius: 99px;
    border: 1px solid rgba(255, 180, 84, 0.4);
    color: var(--warning);
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
`;
document.head.appendChild(railStyle);
