import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  ArrowRight,
  Bug,
  CircleAlert,
  CircleCheck,
  Clock,
  Database,
  Download,
  FilePlus2,
  FileSearch,
  FolderOpen,
  Gauge,
  KeyRound,
  Layers,
  LoaderCircle,
  Play,
  RefreshCw,
  ScanLine,
  Settings2,
  ShieldCheck,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "../components/Badge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toasts";
import { api, errorMessage } from "../lib/api";
import {
  fileBaseName,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  freshnessText,
  outcomeLabel,
  outcomeTone,
  profileLabel,
  signatureStateLabel,
  signatureStateTone,
  truncateMiddle,
} from "../lib/format";
import { useI18n } from "../lib/i18n";
import type {
  Detection,
  EngineStatus,
  ResolvedTargets,
  ScanErrorRecord,
  ScanEvent,
  ScanLimits,
  ScanProfile,
  ScanResultPayload,
  SectionId,
  SettingsView,
  SignatureInventory,
} from "../types";

interface AntivirusProps {
  engine: EngineStatus | null;
  engineLoading: boolean;
  settings: SettingsView | null;
  inventory: SignatureInventory | null;
  onEngineChanged: (engine: EngineStatus) => void;
  onHistoryChanged: () => void;
  onNavigate: (section: SectionId) => void;
  onOpenSetup: () => void;
}

type Tab = "quick" | "full" | "custom" | "results";

interface ProgressState {
  filesScanned: number;
  threatsFound: number;
  currentFile: string | null;
}

const DEFAULT_LIMITS: ScanLimits = {
  maxFileSizeMb: 200,
  maxScanSizeMb: 2000,
  maxFiles: 100000,
  maxRecursion: 10,
  maxDurationMinutes: 0,
  scanArchives: true,
  lowPriority: true,
};

export function Antivirus({
  engine,
  engineLoading,
  settings,
  inventory,
  onEngineChanged,
  onHistoryChanged,
  onNavigate,
  onOpenSetup,
}: AntivirusProps) {
  const toast = useToast();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("quick");
  const [customTargets, setCustomTargets] = useState<string[]>([]);
  const [manualPath, setManualPath] = useState("");
  const [resolved, setResolved] = useState<ResolvedTargets | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(true);
  const [includePua, setIncludePua] = useState(false);
  const [limits, setLimits] = useState<ScanLimits>(DEFAULT_LIMITS);
  const [limitsOpen, setLimitsOpen] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({
    filesScanned: 0,
    threatsFound: 0,
    currentFile: null,
  });
  const [totalFiles, setTotalFiles] = useState<number | null>(null);
  const [indexTruncated, setIndexTruncated] = useState(false);
  const [liveDetections, setLiveDetections] = useState<Detection[]>([]);
  const [liveErrors, setLiveErrors] = useState<ScanErrorRecord[]>([]);
  const [result, setResult] = useState<ScanResultPayload | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const scanStartedAt = useRef<number | null>(null);

  const [checking, setChecking] = useState(false);
  const [pendingDetection, setPendingDetection] = useState<Detection | null>(null);
  const [quarantining, setQuarantining] = useState(false);
  const [quarantinedPaths, setQuarantinedPaths] = useState<string[]>([]);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("json");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setRecursive(settings.recursive);
    setIncludePua(settings.includePua);
  }, [settings]);

  useEffect(() => {
    if (tab !== "quick" && tab !== "full") return;
    let active = true;
    setResolveError(null);
    api
      .resolveScanTargets(tab)
      .then((value) => {
        if (active) setResolved(value);
      })
      .catch((error) => {
        if (active) setResolveError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [tab]);

  useEffect(() => {
    const subscription = listen<ScanEvent>("scan:event", ({ payload }) => {
      switch (payload.kind) {
        case "preparing":
          setPreparing(true);
          setTotalFiles(null);
          setIndexTruncated(false);
          break;
        case "started":
          setPreparing(false);
          setScanning(true);
          setCancelRequested(false);
          setTotalFiles(payload.totalFiles);
          setIndexTruncated(payload.indexTruncated);
          setProgress({ filesScanned: 0, threatsFound: 0, currentFile: null });
          break;
        case "progress":
          setProgress({
            filesScanned: payload.filesScanned,
            threatsFound: payload.threatsFound,
            currentFile: payload.currentFile,
          });
          break;
        case "detection":
          setLiveDetections((current) =>
            current.some(
              (item) =>
                item.filePath === payload.filePath &&
                item.threatName === payload.threatName,
            )
              ? current
              : [
                  ...current,
                  {
                    filePath: payload.filePath,
                    threatName: payload.threatName,
                    fileSizeBytes: null,
                    sha256: null,
                  },
                ],
          );
          break;
        case "scanError":
          setLiveErrors((current) => [
            ...current.slice(-49),
            { path: payload.path, message: payload.message },
          ]);
          break;
        case "finished":
          setResult((current) =>
            current ?? {
              report: payload.report,
              recordId: null,
              persistenceError: null,
            },
          );
          setScanning(false);
          setPreparing(false);
          setTab("results");
          break;
      }
    });

    return () => {
      subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!scanning && !preparing) return;
    const timer = window.setInterval(() => {
      if (scanStartedAt.current) {
        setElapsed(Date.now() - scanStartedAt.current);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [scanning, preparing]);

  const addTargets = (selection: string[]) => {
    setCustomTargets((current) => {
      const seen = new Set(current.map((path) => path.toLowerCase()));
      const next = [...current];
      for (const path of selection) {
        if (!seen.has(path.toLowerCase())) {
          seen.add(path.toLowerCase());
          next.push(path);
        }
      }
      return next;
    });
  };

  const pickTargets = async (kind: "file" | "folder") => {
    try {
      const selection = await open({
        multiple: true,
        directory: kind === "folder",
        title:
          kind === "folder"
            ? t("av.pick.folderTitle")
            : t("av.pick.fileTitle"),
      });
      if (!selection) return;
      addTargets(Array.isArray(selection) ? selection : [selection]);
    } catch (error) {
      toast({
        tone: "error",
        title: t("av.toast.selectionFailed"),
        message: errorMessage(error),
      });
    }
  };

  const activeProfile: ScanProfile =
    tab === "custom" ? "custom" : tab === "full" ? "full" : "quick";
  const scanPaths =
    activeProfile === "custom" ? customTargets : (resolved?.targets ?? []);
  const canStart =
    !scanning &&
    !preparing &&
    scanPaths.length > 0 &&
    Boolean(engine?.installed) &&
    engine?.signatureState !== "missing";

  const startScan = async () => {
    if (scanPaths.length === 0) {
      toast({
        tone: "info",
        title: t("av.toast.noTargets.title"),
        message: t("av.toast.noTargets.body"),
      });
      return;
    }
    if (!engine?.installed) {
      toast({
        tone: "error",
        title: t("av.toast.engineMissing.title"),
        message: t("av.toast.engineMissing.body"),
      });
      return;
    }
    if (engine.signatureState === "missing") {
      onNavigate("updates");
      return;
    }

    setScanError(null);
    setResult(null);
    setLiveDetections([]);
    setLiveErrors([]);
    setProgress({ filesScanned: 0, threatsFound: 0, currentFile: null });
    setElapsed(0);
    setPreparing(true);
    setScanning(true);
    setCancelRequested(false);
    setTotalFiles(null);
    setIndexTruncated(false);
    scanStartedAt.current = Date.now();

    try {
      const payload = await api.startScan({
        paths: scanPaths,
        recursive: activeProfile === "custom" ? recursive : true,
        includePua,
        profile: activeProfile,
        limits,
        followSymlinks: false,
      });
      setResult(payload);
      setTab("results");
      if (payload.persistenceError) {
        toast({
          tone: "error",
          title: t("av.toast.historyNotSaved"),
          message: payload.persistenceError,
        });
      }
      onHistoryChanged();
    } catch (error) {
      setScanError(errorMessage(error));
      toast({
        tone: "error",
        title: t("av.toast.scanFailed"),
        message: errorMessage(error),
      });
    } finally {
      setScanning(false);
      setPreparing(false);
      scanStartedAt.current = null;
      setCancelRequested(false);
    }
  };

  const cancelScan = async () => {
    try {
      const requested = await api.cancelScan();
      if (requested) {
        setCancelRequested(true);
        toast({
          tone: "info",
          title: t("av.toast.cancelRequested.title"),
          message: t("av.toast.cancelRequested.body"),
        });
      } else {
        toast({ tone: "info", title: t("av.toast.noActiveScan") });
      }
    } catch (error) {
      toast({
        tone: "error",
        title: t("av.toast.cancelFailed"),
        message: errorMessage(error),
      });
    }
  };

  const recheckEngine = async () => {
    setChecking(true);
    try {
      const status = await api.engineStatus();
      onEngineChanged(status);
      toast({
        tone: status.installed ? "success" : "error",
        title: status.installed
          ? t("av.toast.engineDetected")
          : t("av.toast.engineNotFound"),
        message: status.installed
          ? freshnessText(
              status.signatureState,
              status.signatureAgeDays,
              settings?.signatureMaxAgeDays,
            )
          : t("av.engineMissing.body"),
      });
    } catch (error) {
      toast({
        tone: "error",
        title: t("av.toast.diagnosticFailed"),
        message: errorMessage(error),
      });
    } finally {
      setChecking(false);
    }
  };

  const quarantineDetection = async () => {
    if (!pendingDetection) return;
    setQuarantining(true);
    try {
      await api.quarantineFile(
        pendingDetection.filePath,
        pendingDetection.threatName,
        pendingDetection.sha256,
        true,
      );
      setQuarantinedPaths((current) => [...current, pendingDetection.filePath]);
      toast({
        tone: "success",
        title: t("av.toast.quarantined"),
        message: `${fileBaseName(pendingDetection.filePath)} — ${t("av.toast.quarantinedBody")}`,
      });
      onHistoryChanged();
      setPendingDetection(null);
    } catch (error) {
      toast({
        tone: "error",
        title: t("av.toast.quarantineFailed"),
        message: errorMessage(error),
      });
    } finally {
      setQuarantining(false);
    }
  };

  const exportReport = async () => {
    if (!result?.recordId) {
      toast({
        tone: "info",
        title: t("av.export.noRecord"),
        message: t("av.export.noRecordBody"),
      });
      return;
    }
    try {
      const extension = exportFormat === "md" ? "md" : exportFormat;
      const destination = await save({
        title: t("av.export.title"),
        defaultPath: `cbs-shield-${result.report.id.slice(0, 8)}.${extension}`,
        filters: [
          {
            name: exportFormat.toUpperCase(),
            extensions: [extension],
          },
        ],
      });
      if (!destination) return;
      setExporting(true);
      const exported = await api.exportScanReport(
        result.recordId,
        exportFormat,
        destination,
      );
      toast({
        tone: "success",
        title: t("av.export.success"),
        message: `${formatNumber(exported.bytes)} · ${exported.path}`,
      });
      setExportOpen(false);
    } catch (error) {
      toast({
        tone: "error",
        title: t("av.export.failed"),
        message: errorMessage(error),
      });
    } finally {
      setExporting(false);
    }
  };

  const isQuarantined = (detection: Detection) =>
    quarantinedPaths.some(
      (path) => path.toLowerCase() === detection.filePath.toLowerCase(),
    );

  const report = result?.report ?? null;
  const displayDetections = report?.detections ?? liveDetections;
  const displayErrors = report?.errors ?? liveErrors;
  const percent =
    totalFiles && totalFiles > 0
      ? Math.min(99, Math.round((progress.filesScanned / totalFiles) * 100))
      : null;
  const tabButton = (id: Tab, label: string, icon: ReactNode) => (
    <button
      type="button"
      className={`av-tab${tab === id ? " is-active" : ""}`}
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="section-stack">
      <div className="banner banner--warning">
        <TriangleAlert size={19} aria-hidden="true" />
        <div>
          <strong>{t("av.banner.title")}</strong>
          <span>{t("av.banner.body")}</span>
        </div>
      </div>

      {!engineLoading && !engine?.installed && (
        <div className="banner banner--danger">
          <CircleAlert size={19} aria-hidden="true" />
          <div>
            <strong>{t("av.engineMissing.title")}</strong>
            <span>{t("av.engineMissing.body")}</span>
            <div className="banner__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={recheckEngine}
                disabled={checking}
              >
                <RefreshCw size={15} className={checking ? "spin" : undefined} />
                {t("av.engine.recheck")}
              </button>
              <button type="button" className="button button--ghost" onClick={onOpenSetup}>
                {t("av.engine.provision")}
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {engine?.installed && engine.signatureState === "missing" && (
        <div className="banner banner--danger">
          <Database size={19} aria-hidden="true" />
          <div>
            <strong>{t("av.signaturesMissing.title")}</strong>
            <span>
              {freshnessText(
                engine.signatureState,
                engine.signatureAgeDays,
                settings?.signatureMaxAgeDays,
              )}
            </span>
            <div className="banner__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => onNavigate("updates")}
              >
                <RefreshCw size={15} />
                {t("av.engine.update")}
              </button>
            </div>
          </div>
        </div>
      )}

      {engine?.installed && engine.signatureState === "outdated" && (
        <div className="banner banner--warning">
          <Clock size={19} aria-hidden="true" />
          <div>
            <strong>{t("av.signaturesOutdated.title")}</strong>
            <span>
              {freshnessText(
                engine.signatureState,
                engine.signatureAgeDays,
                settings?.signatureMaxAgeDays,
              )}
            </span>
            <div className="banner__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => onNavigate("updates")}
              >
                <RefreshCw size={15} />
                {t("av.engine.update")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="av-layout">
        <div className="av-main">
          <section className="panel">
            <div className="av-tabs" role="group" aria-label={t("av.tabs.label")}>
              {tabButton("quick", t("av.tabs.quick"), <Gauge size={16} />)}
              {tabButton("full", t("av.tabs.full"), <ShieldCheck size={16} />)}
              {tabButton("custom", t("av.tabs.custom"), <FolderOpen size={16} />)}
              {tabButton("results", t("av.tabs.results"), <FileSearch size={16} />)}
            </div>

            {tab !== "results" && (
              <>
                <div className="av-profile">
                  <div>
                    <span className="panel__eyebrow">{profileLabel(activeProfile)}</span>
                    <h2>{t(`av.${activeProfile}.title` as const)}</h2>
                    <p className="muted">{t(`av.${activeProfile}.hint` as const)}</p>
                  </div>
                  <Badge tone="info" dot>
                    {scanPaths.length} {t("av.targets.unit")}
                  </Badge>
                </div>

                {resolveError && activeProfile !== "custom" && (
                  <div className="callout callout--warning">
                    <strong>{t("av.resolveFailed")}</strong>
                    <span>{resolveError}</span>
                  </div>
                )}

                {activeProfile !== "custom" ? (
                  <div className="target-summary">
                    <div className="target-summary__head">
                      <strong>{t("av.targets.resolved")}</strong>
                      <span>
                        {activeProfile === "quick"
                          ? t("av.quick.coverage")
                          : t("av.full.coverage")}
                      </span>
                    </div>
                    {resolved ? (
                      <ul className="target-list">
                        {resolved.targets.map((target) => (
                          <li key={target}>
                            <div className="target-list__icon">
                              {activeProfile === "quick" ? (
                                <FileSearch size={16} />
                              ) : (
                                <Layers size={16} />
                              )}
                            </div>
                            <div className="target-list__text">
                              <strong>{fileBaseName(target) || target}</strong>
                              <span title={target}>{truncateMiddle(target, 86)}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="muted">{t("common.loading")}</div>
                    )}
                    {activeProfile === "full" && (
                      <details className="details">
                        <summary>{t("av.full.exclusions")}</summary>
                        <ul className="rule-list rule-list--compact">
                          {resolved?.excluded.map((path) => (
                            <li key={path}>
                              <span className="mono">{truncateMiddle(path, 90)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="manual-path">
                      <input
                        type="text"
                        value={manualPath}
                        placeholder={t("av.targets.pathPlaceholder")}
                        onChange={(event) => setManualPath(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const value = manualPath.trim().replace(/^"|"$/g, "");
                            if (value) addTargets([value]);
                            setManualPath("");
                          }
                        }}
                        disabled={scanning}
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => {
                          const value = manualPath.trim().replace(/^"|"$/g, "");
                          if (value) addTargets([value]);
                          setManualPath("");
                        }}
                        disabled={scanning || manualPath.trim().length === 0}
                      >
                        <FilePlus2 size={16} />
                        {t("av.targets.addPath")}
                      </button>
                    </div>
                    {customTargets.length === 0 ? (
                      <EmptyState
                        icon={FileSearch}
                        title={t("av.targets.emptyTitle")}
                        description={t("av.targets.emptyBody")}
                        action={
                          <div className="button-row">
                            <button
                              type="button"
                              className="button button--primary"
                              onClick={() => pickTargets("file")}
                            >
                              <FilePlus2 size={16} />
                              {t("av.targets.addFile")}
                            </button>
                            <button
                              type="button"
                              className="button button--ghost"
                              onClick={() => pickTargets("folder")}
                            >
                              <FolderOpen size={16} />
                              {t("av.targets.addFolder")}
                            </button>
                          </div>
                        }
                      />
                    ) : (
                      <>
                        <ul className="target-list">
                          {customTargets.map((target) => (
                            <li key={target}>
                              <div className="target-list__icon">
                                <FileSearch size={16} />
                              </div>
                              <div className="target-list__text">
                                <strong>{fileBaseName(target)}</strong>
                                <span title={target}>{truncateMiddle(target, 86)}</span>
                              </div>
                              <button
                                type="button"
                                className="button button--ghost button--icon"
                                onClick={() =>
                                  setCustomTargets((current) =>
                                    current.filter((item) => item !== target),
                                  )
                                }
                                disabled={scanning}
                                aria-label={`${t("av.targets.remove")} ${fileBaseName(target)}`}
                              >
                                <X size={16} />
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="button-row">
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => pickTargets("file")}
                            disabled={scanning}
                          >
                            <FilePlus2 size={16} />
                            {t("av.targets.addFile")}
                          </button>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => pickTargets("folder")}
                            disabled={scanning}
                          >
                            <FolderOpen size={16} />
                            {t("av.targets.addFolder")}
                          </button>
                          <button
                            type="button"
                            className="button button--ghost button--subtle"
                            onClick={() => setCustomTargets([])}
                            disabled={scanning}
                          >
                            {t("av.targets.removeAll")}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}

                <div className="options">
                  {activeProfile === "custom" && (
                    <label className="switch-row">
                      <input
                        type="checkbox"
                        checked={recursive}
                        onChange={(event) => setRecursive(event.target.checked)}
                        disabled={scanning}
                      />
                      <span>
                        <strong>{t("av.options.recursive")}</strong>
                        <small>{t("av.options.recursiveHint")}</small>
                      </span>
                    </label>
                  )}
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={includePua}
                      onChange={(event) => setIncludePua(event.target.checked)}
                      disabled={scanning}
                    />
                    <span>
                      <strong>{t("av.options.pua")}</strong>
                      <small>{t("av.options.puaHint")}</small>
                    </span>
                  </label>
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={limits.scanArchives}
                      onChange={(event) =>
                        setLimits((current) => ({
                          ...current,
                          scanArchives: event.target.checked,
                        }))
                      }
                      disabled={scanning}
                    />
                    <span>
                      <strong>{t("av.options.archives")}</strong>
                      <small>{t("av.options.archivesHint")}</small>
                    </span>
                  </label>
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={limits.lowPriority}
                      onChange={(event) =>
                        setLimits((current) => ({
                          ...current,
                          lowPriority: event.target.checked,
                        }))
                      }
                      disabled={scanning}
                    />
                    <span>
                      <strong>{t("av.options.lowPriority")}</strong>
                      <small>{t("av.options.lowPriorityHint")}</small>
                    </span>
                  </label>
                </div>

                <details
                  className="details limits-details"
                  open={limitsOpen}
                  onToggle={(event) =>
                    setLimitsOpen((event.target as HTMLDetailsElement).open)
                  }
                >
                  <summary>
                    <Settings2 size={15} />
                    {t("av.limits.title")}
                  </summary>
                  <div className="limits-grid">
                    <label className="field">
                      <span className="field__label">{t("av.limits.fileSize")}</span>
                      <input
                        type="number"
                        min={1}
                        max={4096}
                        value={limits.maxFileSizeMb}
                        disabled={scanning}
                        onChange={(event) =>
                          setLimits((current) => ({
                            ...current,
                            maxFileSizeMb: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">{t("av.limits.scanSize")}</span>
                      <input
                        type="number"
                        min={1}
                        max={16384}
                        value={limits.maxScanSizeMb}
                        disabled={scanning}
                        onChange={(event) =>
                          setLimits((current) => ({
                            ...current,
                            maxScanSizeMb: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">{t("av.limits.maxFiles")}</span>
                      <input
                        type="number"
                        min={100}
                        max={2000000}
                        value={limits.maxFiles}
                        disabled={scanning}
                        onChange={(event) =>
                          setLimits((current) => ({
                            ...current,
                            maxFiles: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">{t("av.limits.recursion")}</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={limits.maxRecursion}
                        disabled={scanning}
                        onChange={(event) =>
                          setLimits((current) => ({
                            ...current,
                            maxRecursion: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">{t("av.limits.duration")}</span>
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        value={limits.maxDurationMinutes}
                        disabled={scanning}
                        onChange={(event) =>
                          setLimits((current) => ({
                            ...current,
                            maxDurationMinutes: Number(event.target.value),
                          }))
                        }
                      />
                      <span className="field__hint">{t("av.limits.durationHint")}</span>
                    </label>
                  </div>
                  <p className="panel__note">{t("av.limits.rangeHint")}</p>
                </details>

                <div className="scan-controls">
                  <button
                    type="button"
                    className="button button--primary button--lg"
                    onClick={startScan}
                    disabled={!canStart}
                  >
                    {scanning || preparing ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <Play size={18} />
                    )}
                    {preparing
                      ? t("av.preparing")
                      : scanning
                        ? t("av.scanning")
                        : t("av.start")}
                  </button>
                  {scanning && (
                    <button
                      type="button"
                      className="button button--danger button--lg"
                      onClick={cancelScan}
                      disabled={cancelRequested}
                    >
                      <Square size={16} />
                      {cancelRequested ? t("av.cancelling") : t("common.cancel")}
                    </button>
                  )}
                  <span className="scan-controls__hint">
                    {t("av.firstLoadHint")}
                  </span>
                </div>
              </>
            )}

            {tab === "results" && (
              <>
                {!report ? (
                  <EmptyState
                    icon={FileSearch}
                    title={t("av.results.emptyTitle")}
                    description={t("av.results.emptyBody")}
                    action={
                      <div className="button-row">
                        <button
                          type="button"
                          className="button button--primary"
                          onClick={() => setTab("quick")}
                        >
                          <Play size={16} />
                          {t("av.tabs.quick")}
                        </button>
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => onNavigate("history")}
                        >
                          {t("av.results.openHistory")}
                        </button>
                      </div>
                    }
                  />
                ) : (
                  <div className={`result result--${outcomeTone(report.outcome)}`}>
                    <div className="panel__head">
                      <div className="result__title">
                        {report.outcome === "clean" ? (
                          <CircleCheck size={22} />
                        ) : report.outcome === "detected" ? (
                          <CircleAlert size={22} />
                        ) : (
                          <TriangleAlert size={22} />
                        )}
                        <div>
                          <span className="panel__eyebrow">
                            {profileLabel(report.profile)} · {t("av.result.title")}
                          </span>
                          <h2>{outcomeLabel(report.outcome)}</h2>
                        </div>
                      </div>
                      <div className="button-row">
                        {result?.recordId && (
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            onClick={() => setExportOpen(true)}
                          >
                            <Download size={14} />
                            {t("av.result.export")}
                          </button>
                        )}
                        <Badge tone={outcomeTone(report.outcome)} dot>
                          {report.cancelled
                            ? t("av.result.interrupted")
                            : formatDuration(report.durationMs)}
                        </Badge>
                      </div>
                    </div>

                    {report.fatalError && (
                      <div className="callout callout--danger">
                        <strong>{t("av.result.fatal")}</strong>
                        <span>{report.fatalError}</span>
                      </div>
                    )}

                    {result?.persistenceError && (
                      <div className="callout callout--warning">
                        <strong>{t("av.toast.historyNotSaved")}</strong>
                        <span>{result.persistenceError}</span>
                      </div>
                    )}

                    <div className="result-stats">
                      <div>
                        <span>{t("av.result.files")}</span>
                        <strong>{formatNumber(report.filesScanned)}</strong>
                      </div>
                      <div>
                        <span>{t("av.result.threats")}</span>
                        <strong className={report.infectedFiles > 0 ? "text-danger" : ""}>
                          {formatNumber(report.infectedFiles)}
                        </strong>
                      </div>
                      <div>
                        <span>{t("av.result.errors")}</span>
                        <strong>{formatNumber(report.errorCount)}</strong>
                      </div>
                      <div>
                        <span>{t("av.result.duration")}</span>
                        <strong>{formatDuration(report.durationMs)}</strong>
                      </div>
                    </div>

                    <div className="result-meta">
                      <span>
                        <Clock size={14} /> {formatDateTime(report.startedAt)}
                      </span>
                      <span>
                        <ShieldCheck size={14} /> ClamAV {report.engineVersion ?? "—"}
                      </span>
                      <span>
                        <Database size={14} /> {t("av.result.cvdVersion")}{" "}
                        {report.signatureVersion ?? "—"}
                      </span>
                      <span>
                        <FileSearch size={14} /> {report.targets.length}{" "}
                        {t("av.targets.unit")}
                      </span>
                      {report.indexedFiles !== null && (
                        <span>
                          <ScanLine size={14} /> {t("av.progress.indexed")}{" "}
                          {formatNumber(report.indexedFiles)}
                        </span>
                      )}
                    </div>

                    {displayDetections.length > 0 ? (
                      <div className="detections">
                        <div className="detections__head">
                          <h3>
                            {t("av.result.detections")} ({displayDetections.length})
                          </h3>
                          <span>{t("av.result.detectionsHint")}</span>
                        </div>
                        <div className="table-wrap">
                          <table className="table">
                            <thead>
                              <tr>
                                <th>{t("av.table.threat")}</th>
                                <th>{t("av.table.file")}</th>
                                <th className="num">{t("av.table.size")}</th>
                                <th>SHA-256</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {displayDetections.map((detection) => (
                                <tr key={`${detection.filePath}-${detection.threatName}`}>
                                  <td>
                                    <Badge tone="danger">{detection.threatName}</Badge>
                                  </td>
                                  <td title={detection.filePath}>
                                    {truncateMiddle(detection.filePath, 52)}
                                  </td>
                                  <td className="num">
                                    {formatBytes(detection.fileSizeBytes)}
                                  </td>
                                  <td
                                    className="mono"
                                    title={detection.sha256 ?? undefined}
                                  >
                                    {detection.sha256
                                      ? `${detection.sha256.slice(0, 16)}…`
                                      : "—"}
                                  </td>
                                  <td>
                                    {isQuarantined(detection) ? (
                                      <Badge tone="ok" dot>
                                        {t("av.result.quarantined")}
                                      </Badge>
                                    ) : (
                                      <button
                                        type="button"
                                        className="button button--small button--danger-ghost button--icon"
                                        onClick={() => setPendingDetection(detection)}
                                        title={t("av.result.quarantine")}
                                        aria-label={t("av.result.quarantine")}
                                      >
                                        <Archive size={14} />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="result-clean">
                        <CircleCheck size={20} />
                        <div>
                          <strong>{t("av.result.cleanTitle")}</strong>
                          <span>{t("av.result.cleanBody")}</span>
                        </div>
                      </div>
                    )}

                    {report.targets.length > 0 && (
                      <details className="details">
                        <summary>{t("av.result.targets")}</summary>
                        <ul className="rule-list rule-list--compact">
                          {report.targets.map((target) => (
                            <li key={target}>
                              <span className="mono">{truncateMiddle(target, 100)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {displayErrors.length > 0 && (
                      <details className="details">
                        <summary>
                          <CircleAlert size={15} />
                          {displayErrors.length} {t("av.result.errorsTitle")}
                        </summary>
                        <ul className="error-list">
                          {displayErrors.slice(0, 25).map((error, index) => (
                            <li key={`${error.path}-${index}`}>
                              <span className="mono">
                                {truncateMiddle(error.path || "—", 60)}
                              </span>
                              <span>{error.message}</span>
                            </li>
                          ))}
                        </ul>
                        {displayErrors.length > 25 && (
                          <p className="muted">
                            {displayErrors.length - 25} {t("av.result.moreErrors")}
                          </p>
                        )}
                      </details>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {(scanning || preparing) && (
            <section className="panel panel--live" aria-live="polite">
              <div className="panel__head">
                <div>
                  <span className="panel__eyebrow">{t("av.live.eyebrow")}</span>
                  <h2>{t("av.live.title")}</h2>
                </div>
                <Badge tone="info" dot>
                  {formatDuration(elapsed)}
                </Badge>
              </div>

              <div
                className={`progress-rail${percent === null ? " progress-rail--indeterminate" : ""}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? undefined}
              >
                <div
                  className="progress-rail__bar"
                  style={percent === null ? undefined : { width: `${percent}%` }}
                />
              </div>
              <div className="progress-caption">
                {percent === null
                  ? t("av.progress.estimating")
                  : `${percent}% · ${formatNumber(progress.filesScanned)} / ${formatNumber(totalFiles ?? 0)}`}
                {indexTruncated && ` · ${t("av.progress.truncated")}`}
              </div>

              <div className="live-grid">
                <div>
                  <span className="live-grid__label">{t("av.progress.files")}</span>
                  <strong>{formatNumber(progress.filesScanned)}</strong>
                </div>
                <div>
                  <span className="live-grid__label">{t("av.progress.threats")}</span>
                  <strong
                    className={progress.threatsFound > 0 ? "text-danger" : ""}
                  >
                    {formatNumber(progress.threatsFound)}
                  </strong>
                </div>
                <div>
                  <span className="live-grid__label">{t("av.progress.errors")}</span>
                  <strong>{formatNumber(liveErrors.length)}</strong>
                </div>
              </div>

              {progress.currentFile && (
                <div className="current-file">
                  <ScanLine size={15} />
                  <span title={progress.currentFile}>
                    {truncateMiddle(progress.currentFile, 96)}
                  </span>
                </div>
              )}

              {liveDetections.length > 0 && (
                <div className="live-detections">
                  {liveDetections.slice(-4).map((detection) => (
                    <div
                      key={`${detection.filePath}-${detection.threatName}`}
                      className="live-detection"
                    >
                      <Bug size={15} />
                      <strong>{detection.threatName}</strong>
                      <span title={detection.filePath}>
                        {truncateMiddle(detection.filePath, 64)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {scanError && (
            <div className="banner banner--danger">
              <CircleAlert size={19} aria-hidden="true" />
              <div>
                <strong>{t("av.result.fatal")}</strong>
                <span>{scanError}</span>
              </div>
            </div>
          )}
        </div>

        <aside className="av-aside">
          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{t("av.engine.eyebrow")}</span>
                <h2>ClamAV</h2>
              </div>
              <Badge
                tone={signatureStateTone(engine?.signatureState ?? "unknown")}
                dot
              >
                {signatureStateLabel(engine?.signatureState ?? "unknown")}
              </Badge>
            </div>

            <dl className="detail-list detail-list--compact">
              <div>
                <dt>{t("av.engine.version")}</dt>
                <dd>{engine?.engineVersion ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("av.engine.cvd")}</dt>
                <dd>{engine?.signatureVersion ?? t("signature.missing")}</dd>
              </div>
              <div>
                <dt>{t("av.engine.signatures")}</dt>
                <dd>
                  {inventory && inventory.officialSignatures > 0
                    ? formatNumber(inventory.officialSignatures)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("av.engine.date")}</dt>
                <dd>{formatDateTime(engine?.signatureDate)}</dd>
              </div>
              <div>
                <dt>{t("av.engine.age")}</dt>
                <dd>
                  {engine?.signatureAgeDays !== null &&
                  engine?.signatureAgeDays !== undefined
                    ? `${engine.signatureAgeDays} ${t("av.engine.days")}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t("av.engine.files")}</dt>
                <dd>{formatNumber(engine?.databaseFileCount ?? 0)}</dd>
              </div>
            </dl>

            <p className="panel__note">
              {engine?.installed
                ? freshnessText(
                    engine.signatureState,
                    engine.signatureAgeDays,
                    settings?.signatureMaxAgeDays,
                  )
                : t("av.engineMissing.body")}
            </p>

            <div className="path-box" title={engine?.databasePath ?? undefined}>
              <KeyRound size={14} />
              <span>
                {truncateMiddle(
                  engine?.databasePath ?? t("av.engine.notFound"),
                  44,
                )}
              </span>
            </div>

            <div className="button-col">
              <button
                type="button"
                className="button button--ghost button--full"
                onClick={recheckEngine}
                disabled={checking}
              >
                {checking ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                {t("av.engine.recheck")}
              </button>
              <button
                type="button"
                className="button button--ghost button--full"
                onClick={() => onNavigate("updates")}
              >
                <Database size={15} />
                {t("av.engine.update")}
              </button>
              <button
                type="button"
                className="button button--ghost button--full"
                onClick={() => onNavigate("quarantine")}
              >
                <Archive size={15} />
                {t("av.engine.quarantine")}
              </button>
            </div>
          </section>

          <section className="panel panel--muted">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{t("av.scope.eyebrow")}</span>
                <h2>{t("av.scope.title")}</h2>
              </div>
            </div>
            <ul className="rule-list rule-list--compact">
              <li>{t("av.scope.item1")}</li>
              <li>{t("av.scope.item2")}</li>
              <li>{t("av.scope.item3")}</li>
              <li>{t("av.scope.item4")}</li>
              <li>{t("av.scope.item5")}</li>
            </ul>
          </section>
        </aside>
      </div>

      <Modal
        open={exportOpen}
        title={t("av.export.title")}
        eyebrow={t("av.export.eyebrow")}
        tone="info"
        onClose={() => setExportOpen(false)}
        busy={exporting}
        footer={
          <>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setExportOpen(false)}
              disabled={exporting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={exportReport}
              disabled={exporting}
            >
              {exporting ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Download size={16} />
              )}
              {t("av.export.action")}
            </button>
          </>
        }
      >
        <p>{t("av.export.body")}</p>
        <label className="field">
          <span className="field__label">{t("av.export.format")}</span>
          <select
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value)}
            disabled={exporting}
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
            <option value="md">Markdown</option>
            <option value="txt">Texte</option>
          </select>
        </label>
        <p className="panel__note">{t("av.export.hint")}</p>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDetection)}
        title={t("av.confirm.title")}
        tone="danger"
        description={
          pendingDetection
            ? `${fileBaseName(pendingDetection.filePath)} — ${pendingDetection.threatName}. ${t("av.confirm.body")}`
            : ""
        }
        confirmLabel={t("av.result.quarantine")}
        cancelLabel={t("common.cancel")}
        busy={quarantining}
        onClose={() => setPendingDetection(null)}
        onConfirm={quarantineDetection}
      />
    </div>
  );
}
