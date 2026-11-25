import { Monitor, Moon, Sun } from "lucide-react";

import { useI18n, type Language } from "../lib/i18n";

type ThemeChoice = "dark" | "light" | "system";

interface AppHeaderProps {
  sectionTitle: string;
  sectionSubtitle?: string;
  language: Language;
  theme: ThemeChoice;
  onLanguageChange: (lang: Language) => void;
  onThemeChange: (theme: ThemeChoice) => void;
}

const THEMES: Array<{ id: ThemeChoice; icon: typeof Sun; key: "theme.light" | "theme.dark" | "theme.system" }> = [
  { id: "light", icon: Sun, key: "theme.light" },
  { id: "dark", icon: Moon, key: "theme.dark" },
  { id: "system", icon: Monitor, key: "theme.system" },
];

export function AppHeader({
  sectionTitle,
  sectionSubtitle,
  language,
  theme,
  onLanguageChange,
  onThemeChange,
}: AppHeaderProps) {
  const { t } = useI18n();

  return (
    <header className="app-header">
      <div className="app-header__titles">
        <h1 className="app-header__title">{sectionTitle}</h1>
        {sectionSubtitle && <p className="app-header__subtitle">{sectionSubtitle}</p>}
      </div>

      <div className="app-header__controls">
        <div className="toggle-group" role="group" aria-label={t("shell.theme")}>
          {THEMES.map(({ id, icon: Icon, key }) => (
            <button
              key={id}
              type="button"
              aria-pressed={theme === id}
              aria-label={t(key)}
              title={t(key)}
              onClick={() => theme !== id && onThemeChange(id)}
            >
              <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="toggle-group" role="group" aria-label={t("shell.language")}>
          {(["fr", "en"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              aria-pressed={language === lang}
              aria-label={lang === "fr" ? "Français" : "English"}
              title={lang === "fr" ? "Français" : "English"}
              onClick={() => language !== lang && onLanguageChange(lang)}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
