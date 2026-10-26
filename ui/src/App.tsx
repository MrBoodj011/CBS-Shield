import { useCallback, useEffect, useRef, useState } from "react";

import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { useToast } from "./components/Toasts";
import { api, errorMessage } from "./lib/api";
import { I18nProvider, translate, type Language, type TranslationKey } from "./lib/i18n";
import { About } from "./sections/About";
import { Antivirus } from "./sections/Antivirus";
import { Dashboard } from "./sections/Dashboard";
import { Firewall } from "./sections/Firewall";
import { History } from "./sections/History";
import { NetworkMonitor } from "./sections/NetworkMonitor";
import { Quarantine } from "./sections/Quarantine";
import { Settings } from "./sections/Settings";
import { Updates } from "./sections/Updates";
import type {
  AppInfo,
  DashboardStats,
  EngineStatus,
  QuarantineRecord,
  ScanRecord,
  SectionId,
  SettingsView,
  SignatureInventory,
} from "./types";

const SECTION_META: Record<SectionId, { title: TranslationKey; subtitle: TranslationKey }> = {
  dashboard: {
    title: "section.dashboard.title",
    subtitle: "section.dashboard.subtitle",
  },
  antivirus: {
    title: "section.antivirus.title",
    subtitle: "section.antivirus.subtitle",
  },
  history: {
    title: "section.history.title",
    subtitle: "section.history.subtitle",
  },
  quarantine: {
    title: "section.quarantine.title",
    subtitle: "section.quarantine.subtitle",
  },
  network: {
    title: "section.network.title",
    subtitle: "section.network.subtitle",
  },
  firewall: {
    title: "section.firewall.title",
    subtitle: "section.firewall.subtitle",
  },
  settings: {
    title: "section.settings.title",
    subtitle: "section.settings.subtitle",
  },
  updates: {
    title: "section.updates.title",
    subtitle: "section.updates.subtitle",
  },
  about: {
    title: "section.about.title",
    subtitle: "section.about.subtitle",
  },
};

export default function App() {
  const toast = useToast();
  const [section, setSection] = useState<SectionId>("dashboard");
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [inventory, setInventory] = useState<SignatureInventory | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineRecord[]>([]);
  const [quarantineLoading, setQuarantineLoading] = useState(true);
  const [offline, setOffline] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const mainRef = useRef<HTMLDivElement | null>(null);

  const refreshEngine = useCallback(
    async (notify = false) => {
      setEngineLoading(true);
      try {
        const status = await api.engineStatus();
        setEngine(status);
        setOffline(null);
        api
          .signatureInventory()
          .then(setInventory)
          .catch(() => undefined);
        if (notify) {
          toast({
            tone: status.installed ? "success" : "error",
            title: status.installed ? "Diagnostic terminé" : "ClamAV introuvable",
            message: status.message,
          });
        }
      } catch (error) {
        const message = errorMessage(error);
        if (notify) {
          toast({ tone: "error", title: "Diagnostic impossible", message });
        }
        setOffline((current) => current ?? message);
      } finally {
        setEngineLoading(false);
      }
    },
    [toast],
  );

  const refreshHistory = useCallback(async () => {
    const [statsResult, scansResult] = await Promise.allSettled([
      api.dashboardStats(),
      api.listScans(20),
    ]);
    if (statsResult.status === "fulfilled") setStats(statsResult.value);
    if (scansResult.status === "fulfilled") setScans(scansResult.value);

    const failure =
      statsResult.status === "rejected"
        ? statsResult.reason
        : scansResult.status === "rejected"
          ? scansResult.reason
          : null;
    if (failure) {
      setOffline((current) => current ?? errorMessage(failure));
    }
  }, []);

  const refreshQuarantine = useCallback(async () => {
    setQuarantineLoading(true);
    try {
      setQuarantine(await api.listQuarantine());
    } catch (error) {
      setOffline((current) => current ?? errorMessage(error));
    } finally {
      setQuarantineLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const [infoResult, engineResult, settingsResult, statsResult, scansResult, quarantineResult, inventoryResult] =
        await Promise.allSettled([
          api.appInfo(),
          api.engineStatus(),
          api.getSettings(),
          api.dashboardStats(),
          api.listScans(20),
          api.listQuarantine(),
          api.signatureInventory(),
        ]);
      if (cancelled) return;

      if (infoResult.status === "fulfilled") setInfo(infoResult.value);
      if (engineResult.status === "fulfilled") setEngine(engineResult.value);
      if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
      if (statsResult.status === "fulfilled") setStats(statsResult.value);
      if (scansResult.status === "fulfilled") setScans(scansResult.value);
      if (quarantineResult.status === "fulfilled") setQuarantine(quarantineResult.value);
      if (inventoryResult.status === "fulfilled") setInventory(inventoryResult.value);

      const failure = [engineResult, settingsResult, statsResult, scansResult, quarantineResult].find(
        (result) => result.status === "rejected",
      );
      if (failure && failure.status === "rejected") {
        setOffline(errorMessage(failure.reason));
      }
      setEngineLoading(false);
      setQuarantineLoading(false);
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settings) return;
    const preferred = settings.theme;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        preferred === "system" ? (media.matches ? "dark" : "light") : preferred;
      document.documentElement.dataset.theme = resolved === "light" ? "light" : "dark";
    };
    apply();
    if (preferred === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
    return undefined;
  }, [settings]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [section]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshEngine(), refreshHistory(), refreshQuarantine()]);
    setRefreshTick((tick) => tick + 1);
  }, [refreshEngine, refreshHistory, refreshQuarantine]);

  const handleDataChanged = useCallback(async () => {
    await Promise.all([refreshHistory(), refreshQuarantine()]);
  }, [refreshHistory, refreshQuarantine]);

  const handleSettingsSaved = useCallback(
    (saved: SettingsView) => {
      const languageChanged = saved.language !== settings?.language;
      setSettings(saved);
      void refreshEngine();
      if (languageChanged) {
        // Keep the native tray menu in sync with the interface language.
        void api.setTrayLanguage(saved.language).catch(() => undefined);
      }
    },
    [refreshEngine, settings?.language],
  );

  const language: Language = settings?.language === "en" ? "en" : "fr";
  const t = (key: TranslationKey) => translate(language, key);
  const meta = {
    title: t(SECTION_META[section].title),
    subtitle: t(SECTION_META[section].subtitle),
  };

  return (
    <I18nProvider language={language}>
      <div className="app-shell">
        <Sidebar section={section} onSelect={setSection} engine={engine} info={info} />

        <div className="app-main" ref={mainRef}>
          <TopBar
            title={meta.title}
            subtitle={meta.subtitle}
            engine={engine}
            engineLoading={engineLoading}
            onRefresh={() => {
              void refreshAll();
            }}
          />

          <main className="content" aria-live="polite">
            {offline && (
              <div className="banner banner--danger">
                <div>
                  <strong>{t("shell.offlineTitle")}</strong>
                  <span>{offline}</span>
                  <div className="banner__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => void refreshAll()}
                    >
                      {t("common.retry")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="section-view" key={section}>
              {section === "dashboard" && (
                <Dashboard
                  engine={engine}
                  inventory={inventory}
                  stats={stats}
                  scans={scans}
                  quarantine={quarantine}
                  info={info}
                  onNavigate={setSection}
                  refreshToken={refreshTick}
                />
              )}

              {section === "antivirus" && (
                <Antivirus
                  engine={engine}
                  engineLoading={engineLoading}
                  settings={settings}
                  inventory={inventory}
                  onEngineChanged={(status) => setEngine(status)}
                  onHistoryChanged={() => {
                    void handleDataChanged();
                  }}
                  onNavigate={setSection}
                />
              )}

              {section === "history" && <History onNavigate={setSection} />}

              {section === "firewall" && <Firewall />}

              {section === "network" && <NetworkMonitor />}

              {section === "quarantine" && (
                <Quarantine
                  items={quarantine}
                  settings={settings}
                  loading={quarantineLoading}
                  onRefresh={handleDataChanged}
                />
              )}

              {section === "updates" && (
                <Updates
                  engine={engine}
                  settings={settings}
                  onEngineChanged={(status) => setEngine(status)}
                />
              )}

              {section === "settings" && (
                <Settings
                  settings={settings}
                  engine={engine}
                  info={info}
                  engineLoading={engineLoading}
                  onSettingsSaved={handleSettingsSaved}
                  onEngineChanged={(status) => setEngine(status)}
                />
              )}

              {section === "about" && (
                <About
                  info={info}
                  engine={engine}
                  settings={settings}
                  stats={stats}
                  refreshToken={refreshTick}
                />
              )}
            </div>

            <footer className="app-footer">
              <span>
                CBS Shield v{info?.version ?? "0.3.0-dev"} — {info?.vendor ?? "Cybrense"}
              </span>
              <span>{t("shell.disclaimer")}</span>
            </footer>
          </main>
        </div>
      </div>
    </I18nProvider>
  );
}
