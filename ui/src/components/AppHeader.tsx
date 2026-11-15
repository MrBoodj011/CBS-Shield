import { Globe, Moon, Sun } from "lucide-react";

import { useI18n, type Language } from "../lib/i18n";

interface AppHeaderProps {
  sectionTitle: string;
  sectionSubtitle?: string;
  language: Language;
  theme: "dark" | "light" | "system";
  onLanguageChange: (lang: Language) => void;
  onThemeChange: (theme: "dark" | "light" | "system") => void;
}

export function AppHeader({
  sectionTitle,
  sectionSubtitle,
  language,
  theme,
  onLanguageChange,
  onThemeChange,
}: AppHeaderProps) {
  const { t } = useI18n();
  const themeLabel =
    theme === "dark"
      ? "Sombre"
      : theme === "light"
      ? "Clair"
      : "Système";
  const langLabel = language === "fr" ? "Français" : "English";

  return (
    <header className="app-header" aria-label={t("nav.main")}>
      <div className="app-header__brand">
        <div className="app-header__mark">CS</div>
        <div className="app-header__name">
          <span className="app-name">CBS SHIELD</span>
          <span className="app-vendor">by Cybrense</span>
        </div>
      </div>

      <div className="app-header__section">
        <span className="app-header__eyebrow">{t("nav.main")}</span>
        <h1 className="app-header__title">{sectionTitle}</h1>
        {sectionSubtitle && <p className="app-header__subtitle">{sectionSubtitle}</p>}
      </div>

      <div className="app-header__controls">
        <button
          type="button"
          className="button button--ghost button--small"
          aria-pressed={theme === "dark" ? "true" : "false"}
          aria-label={themeLabel}
          onClick={() => {
            const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
            onThemeChange(next);
          }}
          title={themeLabel}
        >
          {theme === "dark" ? (
            <>
              <Sun size={14} />
              <span>Sombre</span>
            </>
          ) : theme === "light" ? (
            <>
              <Moon size={14} />
              <span>Clair</span>
            </>
          ) : (
            <>
              <Globe size={14} />
              <span>Système</span>
            </>
          )}
        </button>
        <button
          type="button"
          className="button button--ghost button--small"
          aria-pressed={language === "fr" ? "true" : "false"}
          aria-label={langLabel}
          onClick={() => onLanguageChange(language === "fr" ? "en" : "fr")}
          title={langLabel}
        >
          {language === "fr" ? "FR" : "EN"}
        </button>
      </div>
    </header>
  );
}

/* Hidden text for accessibility of icon-only theme toggle. */
const style = document.createElement("style");
style.textContent = `
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
`;
document.head.appendChild(style);
