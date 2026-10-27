import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Copy,
  Database,
  ExternalLink,
  Flame,
  FolderSearch,
  HardDriveDownload,
  LoaderCircle,
  LockKeyhole,
  Network,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  ShieldQuestion,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "./Badge";
import { useToast } from "./Toasts";
import { api, errorMessage } from "../lib/api";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  truncateMiddle,
} from "../lib/format";
import { useI18n } from "../lib/i18n";
import type {
  ClamavInstallResult,
  EngineStatus,
  FirewallObservation,
  NetmonSnapshotRecord,
  ProvisioningStatus,
  SectionId,
  SettingsView,
  SignatureInventory,
  SignatureUpdateResult,
  UpdateLogs,
} from "../types";

interface SetupWizardProps {
  open: boolean;
  engine: EngineStatus | null;
  settings: SettingsView | null;
  onClose: () => void;
  onCompleted: (settings: SettingsView) => void;
  onEngineChanged: (engine: EngineStatus) => void;
  onSettingsChanged: (settings: SettingsView) => void;
  onNavigate: (section: SectionId) => void;
}

type StepId = 0 | 1 | 2 | 3 | 4;

interface StepMeta {
  id: StepId;
  titleFr: string;
  titleEn: string;
  subtitleFr: string;
  subtitleEn: string;
  icon: typeof ShieldCheck;
}

const STEPS: StepMeta[] = [
  {
    id: 0,
    titleFr: "Bienvenue",
    titleEn: "Welcome",
    subtitleFr: "Périmètre et attentes",
    subtitleEn: "Scope and expectations",
    icon: ShieldCheck,
  },
  {
    id: 1,
    titleFr: "Moteur antivirus",
    titleEn: "Antivirus engine",
    subtitleFr: "ClamAV officiel",
    subtitleEn: "Official ClamAV",
    icon: ShieldQuestion,
  },
  {
    id: 2,
    titleFr: "Signatures",
    titleEn: "Signatures",
    subtitleFr: "Intégrité et mises à jour",
    subtitleEn: "Integrity and updates",
    icon: Database,
  },
  {
    id: 3,
    titleFr: "Protection réseau",
    titleEn: "Network protection",
    subtitleFr: "Pare-feu et réseau",
    subtitleEn: "Firewall and network",
    icon: ShieldCheck,
  },
  {
    id: 4,
    titleFr: "Récapitulatif",
    titleEn: "Summary",
    subtitleFr: "Terminer la préparation",
    subtitleEn: "Finish setup",
    icon: CheckCircle2,
  },
];

export function SetupWizard({
  open,
  engine,
  settings,
  onClose,
  onCompleted,
  onEngineChanged,
  onSettingsChanged,
  onNavigate,
}: SetupWizardProps) {
  const toast = useToast();
  const { language } = useI18n();
  const L = (fr: string, en: string) => (language === "en" ? en : fr);

  const [step, setStep] = useState<StepId>(0);
  const [inventory, setInventory] = useState<SignatureInventory | null>(null);
  const [provisioning, setProvisioning] = useState<ProvisioningStatus | null>(null);
  const [firewall, setFirewall] = useState<FirewallObservation | null>(null);
  const [network, setNetwork] = useState<NetmonSnapshotRecord | null>(null);
  const [logs, setLogs] = useState<UpdateLogs | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [installAuthorized, setInstallAuthorized] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<ClamavInstallResult | null>(null);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<SignatureUpdateResult | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [autoUpdateHours, setAutoUpdateHours] = useState(24);
  const [savingAutoUpdate, setSavingAutoUpdate] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const refreshDiagnostics = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [inventoryResult, provisioningResult, firewallResult, historyResult, logsResult] =
        await Promise.allSettled([
          api.signatureInventory(),
          api.provisioningStatus(),
          api.firewallStatus(),
          api.netmonHistory(1),
          api.updateLogs(),
        ]);
      if (inventoryResult.status === "fulfilled") setInventory(inventoryResult.value);
      if (provisioningResult.status === "fulfilled") setProvisioning(provisioningResult.value);
      if (firewallResult.status === "fulfilled") setFirewall(firewallResult.value);
      if (historyResult.status === "fulfilled") setNetwork(historyResult.value[0] ?? null);
      if (logsResult.status === "fulfilled") setLogs(logsResult.value);
      const failed = [
        inventoryResult,
        provisioningResult,
        firewallResult,
        historyResult,
        logsResult,
      ].find((result) => result.status === "rejected");
      if (failed && failed.status === "rejected") {
        setLoadError(errorMessage(failed.reason));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshEngineAndInventory = useCallback(async () => {
    try {
      const status = await api.engineStatus();
      onEngineChanged(status);
      setInventory(await api.signatureInventory());
      setProvisioning(await api.provisioningStatus());
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }, [onEngineChanged]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setActionError(null);
    setInstallResult(null);
    setUpdateResult(null);
    setConfirmUpdate(false);
    setInstallAuthorized(false);
    setCopied(false);
    setAutoUpdate(settings?.autoUpdate ?? false);
    setAutoUpdateHours(settings?.autoUpdateHours ?? 24);
    void refreshDiagnostics();
  }, [open, refreshDiagnostics]);

  useEffect(() => {
    if (!open) return;
    setAutoUpdate(settings?.autoUpdate ?? false);
    setAutoUpdateHours(settings?.autoUpdateHours ?? 24);
  }, [open, settings?.autoUpdate, settings?.autoUpdateHours]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !installing && !updating) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, installing, updating, onClose]);

  const persist = useCallback(
    async (patch: Parameters<typeof api.updateSettings>[0]) => {
      const saved = await api.updateSettings(patch);
      onSettingsChanged(saved);
      return saved;
    },
    [onSettingsChanged],
  );

  const pickClamscan = async () => {
    setActionError(null);
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        title: L("Sélectionner clamscan.exe", "Select clamscan.exe"),
        filters: [{ name: "clamscan", extensions: ["exe"] }],
      });
      if (typeof picked !== "string") return;
      await persist({ clamscanPath: picked });
      await refreshEngineAndInventory();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const pickDatabase = async () => {
    setActionError(null);
    try {
      const picked = await openDialog({
        multiple: false,
        directory: true,
        title: L("Sélectionner le dossier de signatures", "Select the signature folder"),
      });
      if (typeof picked !== "string") return;
      await persist({ databasePath: picked });
      await refreshEngineAndInventory();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const clearOverrides = async () => {
    setActionError(null);
    try {
      await persist({ clamscanPath: "", databasePath: "" });
      await refreshEngineAndInventory();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const installClamav = async () => {
    if (!installAuthorized || installing) return;
    setInstalling(true);
    setActionError(null);
    setInstallResult(null);
    try {
      const result = await api.installClamav(true);
      setInstallResult(result);
      onEngineChanged(result.engine);
      setInventory(await api.signatureInventory());
      setProvisioning(await api.provisioningStatus());
      toast({
        tone: result.success ? "success" : "error",
        title: result.success
          ? L("ClamAV détecté", "ClamAV detected")
          : L("Installation à vérifier", "Installation needs review"),
        message: result.message,
      });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setInstalling(false);
    }
  };

  const copyCommand = async () => {
    if (!provisioning) return;
    try {
      await navigator.clipboard.writeText(provisioning.installCommand);
      setCopied(true);
      toast({
        tone: "success",
        title: L("Commande copiée", "Command copied"),
        message: L(
          "Collez-la dans un terminal si l'installation guidée n'est pas disponible.",
          "Paste it in a terminal if the guided installation is unavailable.",
        ),
      });
    } catch {
      toast({
        tone: "error",
        title: L("Copie impossible", "Copy failed"),
        message: L("Sélectionnez la commande manuellement.", "Select the command manually."),
      });
    }
  };

  const runUpdate = async () => {
    setUpdating(true);
    setActionError(null);
    setUpdateResult(null);
    try {
      const result = await api.updateSignatures(true);
      setUpdateResult(result);
      onEngineChanged(result.engine);
      setInventory(result.inventory);
      setConfirmUpdate(false);
      toast({
        tone: result.success ? "success" : "error",
        title: result.success
          ? L("Signatures mises à jour", "Signatures updated")
          : L("Mise à jour incomplète", "Update incomplete"),
        message: result.message,
      });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setUpdating(false);
    }
  };

  const saveAutoUpdate = async () => {
    setSavingAutoUpdate(true);
    setActionError(null);
    try {
      await persist({ autoUpdate, autoUpdateHours });
      toast({
        tone: "success",
        title: L("Préférence enregistrée", "Preference saved"),
        message: autoUpdate
          ? L("Les mises à jour automatiques sont activées pour cette installation.", "Automatic updates are enabled for this installation.")
          : L("Les mises à jour automatiques restent désactivées.", "Automatic updates remain disabled."),
      });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSavingAutoUpdate(false);
    }
  };

  const completeSetup = async () => {
    setCompleting(true);
    setActionError(null);
    try {
      const saved = await persist({ onboardingCompleted: true });
      onCompleted(saved);
      toast({
        tone: "success",
        title: L("Préparation terminée", "Setup complete"),
        message: engine?.installed
          ? L("CBS Shield reste un scanner manuel : aucune protection en temps réel n'est active.", "CBS Shield remains a manual scanner: no real-time protection is active.")
          : L("ClamAV reste absent : les analyses manuelles sont indisponibles jusqu'à son installation.", "ClamAV is still missing: manual scans are unavailable until it is installed."),
      });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setCompleting(false);
    }
  };

  const goTo = (next: StepId) => {
    setStep(next);
    setActionError(null);
    if (next === 3 && !firewall) void refreshDiagnostics();
  };

  const checked = useMemo(() => {
    const components = inventory?.officialComponents ?? [];
    return {
      engine: Boolean(engine?.installed),
      signatures: components.length > 0 && components.every((component) => component.verified),
      officialDatabase:
        Boolean(inventory) &&
        (inventory?.customSignatureFiles.length ?? 0) === 0 &&
        (inventory?.officialSignatures ?? 0) > 0,
      autoUpdate: autoUpdate,
      firewallObserved: firewall !== null,
      firewallHealthy: firewall !== null && firewall.alerts.length === 0,
    };
  }, [engine, inventory, autoUpdate, firewall]);

  if (!open) return null;

  const finalStep = step === 4;

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <div className="setup-shell">
        <aside className="setup-nav">
          <div className="setup-brand">
            <div className="setup-brand__mark">
              <ScanLine size={22} />
            </div>
            <div>
              <strong>CBS Shield</strong>
              <span>{L("Assistant de préparation", "Setup assistant")}</span>
            </div>
          </div>
          <ol className="setup-steps">
            {STEPS.map((item) => {
              const Icon = item.icon;
              const active = item.id === step;
              const done = item.id < step;
              return (
                <li key={item.id} className={active ? "is-active" : done ? "is-done" : ""}>
                  <button type="button" onClick={() => goTo(item.id)}>
                    <span className="setup-step__icon">
                      {done ? <Check size={16} /> : <Icon size={16} />}
                    </span>
                    <span>
                      <strong>{L(item.titleFr, item.titleEn)}</strong>
                      <small>{L(item.subtitleFr, item.subtitleEn)}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="setup-nav__note">
            <LockKeyhole size={15} />
            <span>
              {L(
                "Aucune installation silencieuse, aucune élévation inattendue, aucun pilote noyau.",
                "No silent install, no unexpected elevation, no kernel driver.",
              )}
            </span>
          </div>
        </aside>

        <section className="setup-main">
          <header className="setup-main__head">
            <div>
              <span className="panel__eyebrow">
                {L("Étape", "Step")} {step + 1}/{STEPS.length}
              </span>
              <h1 id="setup-title">{L(STEPS[step].titleFr, STEPS[step].titleEn)}</h1>
            </div>
            <button
              type="button"
              className="button button--ghost button--icon"
              aria-label={L("Fermer l'assistant", "Close setup assistant")}
              onClick={onClose}
              disabled={installing || updating}
            >
              <X size={18} />
            </button>
          </header>

          <div className="setup-body">
            {loading && (
              <div className="loading-row">
                <LoaderCircle size={18} className="spin" />
                {L("Lecture de l'état réel du système…", "Reading the real system state…")}
              </div>
            )}
            {loadError && (
              <div className="banner banner--warning">
                <TriangleAlert size={18} aria-hidden="true" />
                <div>
                  <strong>{L("Diagnostic partiel", "Partial diagnostics")}</strong>
                  <span>{loadError}</span>
                </div>
              </div>
            )}
            {actionError && (
              <div className="banner banner--danger">
                <CircleAlert size={18} aria-hidden="true" />
                <div>
                  <strong>{L("Action non effectuée", "Action not completed")}</strong>
                  <span>{actionError}</span>
                </div>
              </div>
            )}

            {step === 0 && (
              <div className="setup-step">
                <div className="setup-hero">
                  <div className="setup-hero__icon">
                    <ShieldCheck size={34} />
                  </div>
                  <div>
                    <h2>{L("Préparons une base honnête.", "Let's establish an honest baseline.")}</h2>
                    <p>
                      {L(
                        "CBS Shield est un scanner antivirus manuel expérimental. Il ne remplace pas Microsoft Defender, ne fournit pas de protection en temps réel et n'installe aucun pilote noyau.",
                        "CBS Shield is an experimental manual antivirus scanner. It does not replace Microsoft Defender, does not provide real-time protection and installs no kernel driver.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="setup-value-grid">
                  <article className="module-card">
                    <ShieldCheck size={20} />
                    <strong>{L("ClamAV officiel", "Official ClamAV")}</strong>
                    <span>
                      {L(
                        "Le moteur reste une dépendance externe GPLv2. CBS Shield ne le redistribue jamais.",
                        "The engine remains an external GPLv2 dependency. CBS Shield never redistributes it.",
                      )}
                    </span>
                  </article>
                  <article className="module-card">
                    <Database size={20} />
                    <strong>{L("Données locales", "Local data")}</strong>
                    <span>
                      {L(
                        "Historique, quarantaine et signatures restent dans votre profil utilisateur.",
                        "History, quarantine and signatures stay in your user profile.",
                      )}
                    </span>
                  </article>
                  <article className="module-card">
                    <Flame size={20} />
                    <strong>{L("Pare-feu en lecture seule", "Read-only firewall")}</strong>
                    <span>
                      {L(
                        "CBS Shield observe Microsoft Defender Firewall, sans jamais le modifier ni le remplacer.",
                        "CBS Shield observes Microsoft Defender Firewall without ever changing or replacing it.",
                      )}
                    </span>
                  </article>
                </div>
                <div className="setup-scope">
                  <strong>{L("Ce que cette préparation vérifie", "What this setup checks")}</strong>
                  <ul className="rule-list">
                    <li>{L("présence et version du moteur ClamAV ;", "ClamAV engine presence and version;")}</li>
                    <li>{L("origine officielle et intégrité des signatures ;", "official origin and integrity of signatures;")}</li>
                    <li>{L("préférence de mises à jour automatiques ;", "automatic update preference;")}</li>
                    <li>{L("état réel des profils du pare-feu Windows et alertes associées.", "real Windows firewall profile state and related alerts.")}</li>
                  </ul>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="setup-step">
                <div className="setup-step__intro">
                  <h2>{L("Moteur antivirus", "Antivirus engine")}</h2>
                  <p>
                    {L(
                      "CBS Shield utilise ClamAV comme moteur externe. Vous pouvez installer le paquet officiel via winget, ou sélectionner une installation existante.",
                      "CBS Shield uses ClamAV as an external engine. You can install the official winget package, or select an existing installation.",
                    )}
                  </p>
                </div>

                <div className={`setup-status-card ${engine?.installed ? "is-ok" : "is-danger"}`}>
                  <div className="setup-status-card__head">
                    {engine?.installed ? <CheckCircle2 size={22} /> : <TriangleAlert size={22} />}
                    <div>
                      <strong>
                        {engine?.installed
                          ? L("ClamAV détecté", "ClamAV detected")
                          : L("ClamAV absent — analyses manuelles indisponibles", "ClamAV missing — manual scans unavailable")}
                      </strong>
                      <span>{engine?.message ?? L("Aucun diagnostic disponible.", "No diagnostic available.")}</span>
                    </div>
                    <Badge tone={engine?.installed ? "ok" : "danger"} dot>
                      {engine?.installed ? L("Prêt", "Ready") : L("Absent", "Missing")}
                    </Badge>
                  </div>
                  {engine?.installed && (
                    <dl className="setup-kv">
                      <div>
                        <dt>{L("Version", "Version")}</dt>
                        <dd>{engine.engineVersion ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>clamscan</dt>
                        <dd title={engine.clamscanPath ?? undefined}>
                          {engine.clamscanPath ? truncateMiddle(engine.clamscanPath, 58) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>{L("Base de signatures", "Signature database")}</dt>
                        <dd title={engine.databasePath ?? undefined}>
                          {engine.databasePath ? truncateMiddle(engine.databasePath, 58) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>{L("Fichiers", "Files")}</dt>
                        <dd>{formatNumber(engine.databaseFileCount)}</dd>
                      </div>
                    </dl>
                  )}
                </div>

                <div className="setup-actions">
                  <button type="button" className="button button--ghost" onClick={() => void refreshEngineAndInventory()}>
                    <RefreshCw size={15} />
                    {L("Diagnostiquer à nouveau", "Diagnose again")}
                  </button>
                  <button type="button" className="button button--ghost" onClick={() => void pickClamscan()}>
                    <FolderSearch size={15} />
                    {L("Localiser clamscan.exe", "Locate clamscan.exe")}
                  </button>
                  <button type="button" className="button button--ghost" onClick={() => void pickDatabase()}>
                    <Database size={15} />
                    {L("Choisir le dossier de signatures", "Choose signature folder")}
                  </button>
                  {(settings?.clamscanPath || settings?.databasePath) && (
                    <button type="button" className="button button--ghost" onClick={() => void clearOverrides()}>
                      {L("Revenir à la détection automatique", "Return to automatic detection")}
                    </button>
                  )}
                </div>

                {!engine?.installed && (
                  <div className="setup-install">
                    <div className="setup-install__head">
                      <HardDriveDownload size={20} />
                      <div>
                        <strong>{L("Installation officielle guidée", "Guided official installation")}</strong>
                        <span>
                          {L(
                            "Le paquet Cisco.ClamAV est lancé dans une console visible. Windows peut demander une élévation : elle reste explicite et contrôlée par vous.",
                            "The Cisco.ClamAV package is launched in a visible console. Windows may ask for elevation: it remains explicit and controlled by you.",
                          )}
                        </span>
                      </div>
                    </div>
                    {provisioning && (
                      <div className="setup-install__meta">
                        <Badge tone={provisioning.wingetAvailable ? "ok" : "warning"} dot>
                          winget {provisioning.wingetAvailable ? L("disponible", "available") : L("indisponible", "unavailable")}
                        </Badge>
                        {provisioning.wingetVersion && <span className="mono">{provisioning.wingetVersion}</span>}
                      </div>
                    )}
                    <div className="setup-command">
                      <Terminal size={16} />
                      <code>{provisioning?.installCommand ?? "winget install --id Cisco.ClamAV --exact --source winget --interactive"}</code>
                      <button type="button" className="button button--ghost button--icon" onClick={() => void copyCommand()} aria-label={L("Copier la commande", "Copy command")}>
                        {copied ? <Check size={15} /> : <Copy size={15} />}
                      </button>
                    </div>
                    <label className="confirm__check">
                      <input
                        type="checkbox"
                        checked={installAuthorized}
                        onChange={(event) => setInstallAuthorized(event.target.checked)}
                        disabled={installing}
                      />
                      <span>
                        {L(
                          "J'autorise CBS Shield à lancer l'installation officielle de ClamAV via winget. Aucun téléchargement direct ni installation silencieuse.",
                          "I authorize CBS Shield to launch the official ClamAV installation through winget. No direct download and no silent installation.",
                        )}
                      </span>
                    </label>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button--primary"
                        disabled={!installAuthorized || installing || !provisioning?.wingetAvailable}
                        onClick={() => void installClamav()}
                      >
                        {installing ? <LoaderCircle size={15} className="spin" /> : <HardDriveDownload size={15} />}
                        {L("Lancer l'installation officielle", "Run official installation")}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => void api.openDocumentation("https://www.clamav.net/downloads")}
                      >
                        <ExternalLink size={15} />
                        {L("Page officielle ClamAV", "Official ClamAV page")}
                      </button>
                    </div>
                    {installResult && (
                      <div className={`banner ${installResult.success ? "banner--info" : "banner--warning"}`}>
                        <div>
                          <strong>
                            {installResult.success
                              ? L("Installation détectée", "Installation detected")
                              : L("Installation non confirmée", "Installation not confirmed")}
                          </strong>
                          <span>{installResult.message}</span>
                          {installResult.exitCode !== null && (
                            <span className="mono">
                              {L("Code de sortie", "Exit code")}: {installResult.exitCode}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <p className="panel__note">
                      {provisioning?.licenseNote ??
                        L(
                          "ClamAV est publié sous licence GPLv2. CBS Shield ne redistribue ni le moteur ni les bases.",
                          "ClamAV is published under GPLv2. CBS Shield redistributes neither the engine nor the databases.",
                        )}
                    </p>
                  </div>
                )}

                <details className="setup-diagnostics">
                  <summary>
                    <Terminal size={15} />
                    {L("Diagnostic d'installation", "Installation diagnostics")}
                  </summary>
                  {logs ? (
                    <div className="setup-diagnostics__grid">
                      <div>
                        <strong>{L("Journal CBS Shield", "CBS Shield log")}</strong>
                        <code>{logs.appLogPath}</code>
                        <pre>{logs.appLines.slice(-8).join("\n") || L("Aucune entrée.", "No entry.")}</pre>
                      </div>
                      <div>
                        <strong>freshclam</strong>
                        <code>{logs.freshclamLogPath}</code>
                        <pre>{logs.freshclamLines.slice(-8).join("\n") || L("Aucune entrée.", "No entry.")}</pre>
                      </div>
                    </div>
                  ) : (
                    <p className="panel__note">{L("Journaux indisponibles pour le moment.", "Logs unavailable at the moment.")}</p>
                  )}
                </details>
              </div>
            )}

            {step === 2 && (
              <div className="setup-step">
                <div className="setup-step__intro">
                  <h2>{L("Signatures officielles", "Official signatures")}</h2>
                  <p>
                    {L(
                      "Vérifiez l'origine, la version et l'intégrité des composants officiels ClamAV avant de lancer une analyse.",
                      "Verify the origin, version and integrity of official ClamAV components before running a scan.",
                    )}
                  </p>
                </div>

                <div className={`setup-status-card ${checked.officialDatabase ? "is-ok" : "is-warning"}`}>
                  <div className="setup-status-card__head">
                    {checked.officialDatabase ? <CheckCircle2 size={22} /> : <TriangleAlert size={22} />}
                    <div>
                      <strong>
                        {checked.officialDatabase
                          ? L("Base officielle détectée", "Official database detected")
                          : L("Base officielle incomplète", "Official database incomplete")}
                      </strong>
                      <span>
                        {inventory
                          ? L(
                              `${formatNumber(inventory.officialSignatures)} signatures officielles · ${inventory.officialComponents.length} composant(s).`,
                              `${formatNumber(inventory.officialSignatures)} official signatures · ${inventory.officialComponents.length} component(s).`,
                            )
                          : L("Inventaire indisponible.", "Inventory unavailable.")}
                      </span>
                    </div>
                    <Badge tone={checked.signatures ? "ok" : "warning"} dot>
                      {checked.signatures ? L("Vérifiée", "Verified") : L("À vérifier", "Needs review")}
                    </Badge>
                  </div>
                  {inventory && (
                    <div className="table-wrap setup-signature-table">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>{L("Composant", "Component")}</th>
                            <th>{L("Version", "Version")}</th>
                            <th>{L("Signatures", "Signatures")}</th>
                            <th>{L("Intégrité", "Integrity")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inventory.officialComponents.map((component) => (
                            <tr key={component.file}>
                              <td className="mono">{component.file}</td>
                              <td>{component.version ?? "—"}</td>
                              <td>{formatNumber(component.signatures)}</td>
                              <td>
                                <Badge tone={component.verified ? "ok" : "warning"} dot>
                                  {component.verified ? L("Vérifiée", "Verified") : L("À vérifier", "Needs review")}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {inventory && inventory.customSignatureFiles.length > 0 && (
                    <div className="banner banner--warning">
                      <TriangleAlert size={18} aria-hidden="true" />
                      <div>
                        <strong>{L("Signatures personnalisées présentes", "Custom signatures present")}</strong>
                        <span>
                          {L(
                            `${inventory.customSignatureFiles.length} fichier(s) hors base officielle. Ils ne sont pas comptés comme signatures officielles.`,
                            `${inventory.customSignatureFiles.length} file(s) outside the official database. They are not counted as official signatures.`,
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                  {inventory?.notes.map((note) => (
                    <p className="panel__note" key={note}>
                      {note}
                    </p>
                  ))}
                </div>

                <div className="setup-actions">
                  <button type="button" className="button button--ghost" onClick={() => void refreshDiagnostics()}>
                    <RefreshCw size={15} />
                    {L("Vérifier à nouveau", "Verify again")}
                  </button>
                  {!confirmUpdate ? (
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => setConfirmUpdate(true)}
                      disabled={!engine?.installed || updating}
                    >
                      <RefreshCw size={15} />
                      {L("Mettre à jour les signatures", "Update signatures")}
                    </button>
                  ) : (
                    <div className="setup-confirm">
                      <span>
                        {L(
                          "FreshClam va contacter les serveurs officiels ClamAV. Continuer ?",
                          "FreshClam will contact the official ClamAV servers. Continue?",
                        )}
                      </span>
                      <button type="button" className="button button--ghost" onClick={() => setConfirmUpdate(false)} disabled={updating}>
                        {L("Annuler", "Cancel")}
                      </button>
                      <button type="button" className="button button--primary" onClick={() => void runUpdate()} disabled={updating}>
                        {updating ? <LoaderCircle size={15} className="spin" /> : <DownloadIcon />}
                        {L("Confirmer la mise à jour", "Confirm update")}
                      </button>
                    </div>
                  )}
                </div>

                {updateResult && (
                  <div className={`banner ${updateResult.success ? "banner--info" : "banner--warning"}`}>
                    <div>
                      <strong>
                        {updateResult.success
                          ? L("Mise à jour vérifiée", "Update verified")
                          : L("Mise à jour incomplète", "Update incomplete")}
                      </strong>
                      <span>{updateResult.message}</span>
                      <span>
                        {L("Base vérifiée : ", "Database verified: ")}
                        {updateResult.databaseVerified ? L("oui", "yes") : L("non", "no")} ·{" "}
                        {L("hors ligne : ", "offline: ")}
                        {updateResult.offline ? L("oui", "yes") : L("non", "no")}
                      </span>
                    </div>
                  </div>
                )}

                <div className="setup-autoupdate">
                  <div>
                    <strong>{L("Mises à jour automatiques", "Automatic updates")}</strong>
                    <span>
                      {L(
                        "Nécessite que CBS Shield soit ouvert. Aucun service ni tâche planifiée n'est créé.",
                        "Requires CBS Shield to be open. No service or scheduled task is created.",
                      )}
                    </span>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={autoUpdate}
                      onChange={(event) => setAutoUpdate(event.target.checked)}
                    />
                    <span>{autoUpdate ? L("Activées", "Enabled") : L("Désactivées", "Disabled")}</span>
                  </label>
                  <label className="field">
                    <span className="field__label">{L("Intervalle (heures)", "Interval (hours)")}</span>
                    <input
                      className="input"
                      type="number"
                      min={6}
                      max={168}
                      value={autoUpdateHours}
                      onChange={(event) => setAutoUpdateHours(Number(event.target.value))}
                    />
                  </label>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => void saveAutoUpdate()}
                    disabled={savingAutoUpdate}
                  >
                    {savingAutoUpdate ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
                    {L("Enregistrer", "Save")}
                  </button>
                </div>

                <p className="panel__note">
                  {L(
                    "La base personnelle est maintenue dans votre profil utilisateur. Les composants officiels sont vérifiés par sigtool ; aucune signature de test n'est injectée.",
                    "The user database is maintained in your profile. Official components are verified by sigtool; no test signature is injected.",
                  )}
                </p>
              </div>
            )}

            {step === 3 && (
              <div className="setup-step">
                <div className="setup-step__intro">
                  <h2>{L("Protection réseau observée", "Observed network protection")}</h2>
                  <p>
                    {L(
                      "CBS Shield lit le pare-feu Windows et les connexions actives. Aucune règle n'est modifiée et aucun pare-feu tiers n'est installé.",
                      "CBS Shield reads Windows Firewall and active connections. No rule is changed and no third-party firewall is installed.",
                    )}
                  </p>
                </div>

                {firewall ? (
                  <>
                    <div className="setup-value-grid">
                      {firewall.status.profiles.map((profile) => (
                        <article
                          key={profile.profile}
                          className={`module-card ${profile.enabled ? "" : "module-card--danger"}`}
                        >
                          <Flame size={20} />
                          <strong>
                            {profile.profile === "domaine"
                              ? L("Domaine", "Domain")
                              : profile.profile === "privé"
                                ? L("Privé", "Private")
                                : L("Public", "Public")}
                          </strong>
                          <Badge tone={profile.enabled ? "ok" : "danger"} dot>
                            {profile.enabled ? L("Activé", "Enabled") : L("Désactivé", "Disabled")}
                          </Badge>
                          <span>
                            {L(
                              `Entrant : ${profile.inboundDefault} · sortant : ${profile.outboundDefault}`,
                              `Inbound: ${profile.inboundDefault} · outbound: ${profile.outboundDefault}`,
                            )}
                          </span>
                        </article>
                      ))}
                    </div>
                    {firewall.alerts.length === 0 ? (
                      <div className="banner banner--info">
                        <CheckCircle2 size={18} aria-hidden="true" />
                        <div>
                          <strong>{L("Aucune alerte de profil détectée", "No profile alert detected")}</strong>
                          <span>
                            {L(
                              "Les profils observés sont actifs et n'utilisent pas d'autorisation entrante par défaut. Cela ne constitue pas une garantie de protection complète.",
                              "Observed profiles are enabled and do not use a default inbound allow. This is not a guarantee of complete protection.",
                            )}
                          </span>
                        </div>
                      </div>
                    ) : (
                      firewall.alerts.map((alert, index) => (
                        <div
                          key={`${alert.code}-${alert.profile ?? index}`}
                          className={`banner ${alert.severity === "danger" ? "banner--danger" : "banner--warning"}`}
                        >
                          <TriangleAlert size={18} aria-hidden="true" />
                          <div>
                            <strong>
                              {alert.code === "all_profiles_disabled"
                                ? L("Tous les profils sont désactivés", "All profiles are disabled")
                                : alert.code === "profile_disabled"
                                  ? L(`Profil ${alert.profile ?? ""} désactivé`, `${alert.profile ?? ""} profile disabled`)
                                  : L(
                                      `Entrant autorisé par défaut (${alert.profile ?? ""})`,
                                      `Inbound allowed by default (${alert.profile ?? ""})`,
                                    )}
                            </strong>
                            <span>
                              {L(
                                "Vérifiez ce choix dans Windows Security. CBS Shield ne modifie jamais le pare-feu.",
                                "Review this setting in Windows Security. CBS Shield never changes the firewall.",
                              )}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                    <div className="setup-actions">
                      <button type="button" className="button button--ghost" onClick={() => {
                        onNavigate("firewall");
                        onClose();
                      }}>
                        <Flame size={15} />
                        {L("Ouvrir le diagnostic pare-feu", "Open firewall diagnostics")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="banner banner--warning">
                    <TriangleAlert size={18} aria-hidden="true" />
                    <div>
                      <strong>{L("Pare-feu non lu", "Firewall not read")}</strong>
                      <span>{L("Le diagnostic pare-feu n'a pas pu être chargé.", "Firewall diagnostics could not be loaded.")}</span>
                    </div>
                  </div>
                )}

                <div className="setup-network">
                  <div className="setup-network__head">
                    <Activity size={20} />
                    <div>
                      <strong>{L("Dernière observation réseau", "Latest network observation")}</strong>
                      <span>
                        {network
                          ? L(
                              `Capturée à ${formatDateTime(network.capturedAt)} · ${formatNumber(network.tcpTotal)} TCP · ${formatNumber(network.udpTotal)} UDP.`,
                              `Captured at ${formatDateTime(network.capturedAt)} · ${formatNumber(network.tcpTotal)} TCP · ${formatNumber(network.udpTotal)} UDP.`,
                            )
                          : L(
                              "Aucune capture enregistrée pour le moment.",
                              "No stored capture at the moment.",
                            )}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => {
                        onNavigate("network");
                        onClose();
                      }}
                    >
                      <Network size={15} />
                      {L("Ouvrir le moniteur", "Open monitor")}
                    </button>
                  </div>
                  {network && (
                    <div className="metric-strip metric-strip--firewall">
                      <div>
                        <span>TCP</span>
                        <strong>{formatNumber(network.tcpTotal)}</strong>
                      </div>
                      <div>
                        <span>{L("Établies", "Established")}</span>
                        <strong>{formatNumber(network.tcpEstablished)}</strong>
                      </div>
                      <div>
                        <span>{L("Octets reçus", "Bytes received")}</span>
                        <strong>{formatBytes(network.rxBytesDelta)}</strong>
                      </div>
                      <div>
                        <span>{L("Octets émis", "Bytes sent")}</span>
                        <strong>{formatBytes(network.txBytesDelta)}</strong>
                      </div>
                    </div>
                  )}
                </div>

                <div className="banner banner--warning">
                  <ShieldQuestion size={18} aria-hidden="true" />
                  <div>
                    <strong>{L("Pas de protection en temps réel", "No real-time protection")}</strong>
                    <span>
                      {L(
                        "CBS Shield n'a pas de pilote résident. Les fichiers ne sont analysés que lorsque vous lancez une analyse manuelle.",
                        "CBS Shield has no resident driver. Files are scanned only when you start a manual scan.",
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="setup-step">
                <div className="setup-hero setup-hero--compact">
                  <div className="setup-hero__icon">
                    <CheckCircle2 size={32} />
                  </div>
                  <div>
                    <h2>{L("Récapitulatif de la préparation", "Setup summary")}</h2>
                    <p>
                      {L(
                        "Ces états proviennent du backend réel. Vous pourrez relancer cet assistant depuis les paramètres.",
                        "These states come from the real backend. You can rerun this assistant from settings.",
                      )}
                    </p>
                  </div>
                </div>
                <ul className="setup-checks">
                  <CheckItem
                    ok={checked.engine}
                    title={L("Moteur ClamAV", "ClamAV engine")}
                    detail={
                      checked.engine
                        ? L(`Version ${engine?.engineVersion ?? "inconnue"}`, `Version ${engine?.engineVersion ?? "unknown"}`)
                        : L("Absent : les analyses manuelles resteront indisponibles.", "Missing: manual scans will remain unavailable.")
                    }
                  />
                  <CheckItem
                    ok={checked.signatures}
                    title={L("Intégrité des signatures", "Signature integrity")}
                    detail={
                      checked.signatures
                        ? L("Composants officiels vérifiés.", "Official components verified.")
                        : L("Vérification incomplète ou signatures absentes.", "Verification incomplete or signatures missing.")
                    }
                  />
                  <CheckItem
                    ok={checked.officialDatabase}
                    title={L("Base officielle uniquement", "Official database only")}
                    detail={
                      checked.officialDatabase
                        ? L("Aucun fichier personnalisé détecté.", "No custom file detected.")
                        : L("Des fichiers personnalisés ou une base vide sont présents.", "Custom files or an empty database are present.")
                    }
                  />
                  <CheckItem
                    ok={checked.autoUpdate}
                    title={L("Mises à jour automatiques", "Automatic updates")}
                    detail={
                      checked.autoUpdate
                        ? L(`Toutes les ${autoUpdateHours} h, lorsque l'application est ouverte.`, `Every ${autoUpdateHours} h while the application is open.`)
                        : L("Désactivées : mettez à jour manuellement.", "Disabled: update manually.")
                    }
                  />
                  <CheckItem
                    ok={checked.firewallHealthy}
                    title={L("Pare-feu observé", "Firewall observed")}
                    detail={
                      !firewall
                        ? L("Diagnostic pare-feu indisponible.", "Firewall diagnostics unavailable.")
                        : checked.firewallHealthy
                          ? L("Aucune alerte de profil détectée.", "No profile alert detected.")
                          : L(
                              `${firewall.alerts.length} alerte(s) de sécurité observée(s) : vérifiez Windows Security.`,
                              `${firewall.alerts.length} security alert(s) observed: review Windows Security.`,
                            )
                    }
                  />
                </ul>
                {!checked.engine && (
                  <div className="banner banner--warning">
                    <TriangleAlert size={18} aria-hidden="true" />
                    <div>
                      <strong>{L("La préparation peut se terminer sans ClamAV", "Setup can finish without ClamAV")}</strong>
                      <span>
                        {L(
                          "CBS Shield restera honnête : les analyses manuelles seront indisponibles et aucune protection complète ne sera affichée.",
                          "CBS Shield will remain honest: manual scans will be unavailable and no complete protection will be displayed.",
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <footer className="setup-footer">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => (step === 0 ? onClose() : goTo((step - 1) as StepId))}
              disabled={installing || updating || completing}
            >
              <ArrowLeft size={16} />
              {step === 0 ? L("Configurer plus tard", "Set up later") : L("Retour", "Back")}
            </button>
            <span className="setup-footer__hint">
              {step === 0
                ? L("Vous pouvez fermer et reprendre depuis Paramètres.", "You can close and resume from Settings.")
                : L("Toutes les données affichées sont réelles.", "All displayed data is real.")}
            </span>
            {finalStep ? (
              <button
                type="button"
                className="button button--primary"
                onClick={() => void completeSetup()}
                disabled={completing}
              >
                {completing ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}
                {L("Terminer la préparation", "Finish setup")}
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary"
                onClick={() => goTo((step + 1) as StepId)}
                disabled={installing || updating}
              >
                {L("Continuer", "Continue")}
                <ArrowRight size={16} />
              </button>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}

function CheckItem({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <li className={ok ? "is-ok" : "is-warning"}>
      <span className="setup-check__icon">
        {ok ? <Check size={16} /> : <CircleAlert size={16} />}
      </span>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <Badge tone={ok ? "ok" : "warning"} dot>
        {ok ? "OK" : "!"}
      </Badge>
    </li>
  );
}

function DownloadIcon() {
  return <HardDriveDownload size={15} />;
}
