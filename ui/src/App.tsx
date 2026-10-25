import { useCallback, useEffect, useRef, useState } from "react";

import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { useToast } from "./components/Toasts";
import { api, errorMessage } from "./lib/api";
import { Antivirus } from "./sections/Antivirus";
import { Dashboard } from "./sections/Dashboard";
import { Firewall } from "./sections/Firewall";
import { NetworkMonitor } from "./sections/NetworkMonitor";
import { Quarantine } from "./sections/Quarantine";
import { Settings } from "./sections/Settings";
import type {
  AppInfo,
  DashboardStats,
  EngineStatus,
  QuarantineRecord,
  ScanRecord,
  SectionId,
  SettingsView,
} from "./types";

const SECTION_META: Record<SectionId, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Vue d'ensemble locale de CBS Shield — Phase 1, protection manuelle.",
  },
  antivirus: {
    title: "Antivirus",
    subtitle: "Analyse manuelle réelle par ClamAV, sans surveillance en temps réel.",
  },
  firewall: {
    title: "Firewall",
    subtitle: "Observation en lecture seule des profils et règles Windows Firewall.",
  },
  network: {
    title: "Network Monitor",
    subtitle:
      "Observation en lecture seule des connexions TCP/UDP et du trafic mesuré.",
  },
  quarantine: {
    title: "Quarantaine",
    subtitle: "Coffre chiffré local, restauration et suppression toujours confirmées.",
  },
  settings: {
    title: "Paramètres",
    subtitle: "Configuration locale du moteur, des analyses et de l'apparence.",
  },
};

export default function App() {
  const toast = useToast();
  const [section, setSection] = useState<SectionId>("dashboard");
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineRecord[]>([]);
  const [quarantineLoading, setQuarantineLoading] = useState(true);
  const [offline, setOffline] = useState<string | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);

  const refreshEngine = useCallback(
    async (notify = false) => {
      setEngineLoading(true);
      try {
        const status = await api.engineStatus();
        setEngine(status);
        setOffline(null);
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
      const [infoResult, engineResult, settingsResult, statsResult, scansResult, quarantineResult] =
        await Promise.allSettled([
          api.appInfo(),
          api.engineStatus(),
          api.getSettings(),
          api.dashboardStats(),
          api.listScans(20),
          api.listQuarantine(),
        ]);
      if (cancelled) return;

      if (infoResult.status === "fulfilled") setInfo(infoResult.value);
      if (engineResult.status === "fulfilled") setEngine(engineResult.value);
      if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
      if (statsResult.status === "fulfilled") setStats(statsResult.value);
      if (scansResult.status === "fulfilled") setScans(scansResult.value);
      if (quarantineResult.status === "fulfilled") setQuarantine(quarantineResult.value);

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
  }, [refreshEngine, refreshHistory, refreshQuarantine]);

  const handleDataChanged = useCallback(async () => {
    await Promise.all([refreshHistory(), refreshQuarantine()]);
  }, [refreshHistory, refreshQuarantine]);

  const handleSettingsSaved = useCallback(
    (saved: SettingsView) => {
      setSettings(saved);
      void refreshEngine();
    },
    [refreshEngine],
  );

  const meta = SECTION_META[section];

  return (
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
                <strong>Connexion au moteur natif incomplète</strong>
                <span>{offline}</span>
                <div className="banner__actions">
                  <button type="button" className="button button--ghost" onClick={() => void refreshAll()}>
                    Réessayer
                  </button>
                </div>
              </div>
            </div>
          )}

          {section === "dashboard" && (
            <Dashboard
              engine={engine}
              stats={stats}
              scans={scans}
              info={info}
              onNavigate={setSection}
            />
          )}

          {section === "antivirus" && (
            <Antivirus
              engine={engine}
              engineLoading={engineLoading}
              settings={settings}
              onEngineChanged={(status) => setEngine(status)}
              onHistoryChanged={() => {
                void handleDataChanged();
              }}
              onNavigate={setSection}
            />
          )}

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

          <footer className="app-footer">
            <span>
              CBS Shield v{info?.version ?? "0.1.0"} — {info?.vendor ?? "Cybrense"}
            </span>
            <span>{info?.disclaimer ?? "Protection manuelle expérimentale. Microsoft Defender reste actif."}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
