import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  ArrowRight,
  Bug,
  CircleAlert,
  CircleCheck,
  Clock,
  Database,
  FilePlus2,
  FileSearch,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Play,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  outcomeLabel,
  outcomeTone,
  signatureStateLabel,
  signatureStateTone,
  truncateMiddle,
} from "../lib/format";
import type {
  Detection,
  EngineStatus,
  ScanErrorRecord,
  ScanEvent,
  ScanResultPayload,
  SectionId,
  SettingsView,
  SignatureUpdateEvent,
  SignatureUpdateResult,
} from "../types";

interface AntivirusProps {
  engine: EngineStatus | null;
  engineLoading: boolean;
  settings: SettingsView | null;
  onEngineChanged: (engine: EngineStatus) => void;
  onHistoryChanged: () => void;
  onNavigate: (section: SectionId) => void;
}

interface ProgressState {
  filesScanned: number;
  threatsFound: number;
  currentFile: string | null;
}

export function Antivirus({
  engine,
  engineLoading,
  settings,
  onEngineChanged,
  onHistoryChanged,
  onNavigate,
}: AntivirusProps) {
  const toast = useToast();
  const [targets, setTargets] = useState<string[]>([]);
  const [recursive, setRecursive] = useState(true);
  const [includePua, setIncludePua] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({
    filesScanned: 0,
    threatsFound: 0,
    currentFile: null,
  });
  const [liveDetections, setLiveDetections] = useState<Detection[]>([]);
  const [liveErrors, setLiveErrors] = useState<ScanErrorRecord[]>([]);
  const [result, setResult] = useState<ScanResultPayload | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const scanStartedAt = useRef<number | null>(null);

  const [checking, setChecking] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const [updateResult, setUpdateResult] = useState<SignatureUpdateResult | null>(null);
  const updateLogRef = useRef<HTMLPreElement | null>(null);

  const [pendingDetection, setPendingDetection] = useState<Detection | null>(null);
  const [quarantining, setQuarantining] = useState(false);
  const [quarantinedPaths, setQuarantinedPaths] = useState<string[]>([]);

  useEffect(() => {
    if (!settings) return;
    setRecursive(settings.recursive);
    setIncludePua(settings.includePua);
  }, [settings]);

  useEffect(() => {
    const subscription = listen<ScanEvent>("scan:event", ({ payload }) => {
      switch (payload.kind) {
        case "started":
          setScanning(true);
          setCancelRequested(false);
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
            current.some((item) => item.filePath === payload.filePath)
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
          break;
      }
    });

    return () => {
      subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const subscription = listen<SignatureUpdateEvent>("signatures:update", ({ payload }) => {
      setUpdateLog((current) => [...current.slice(-199), payload.line]);
    });
    return () => {
      subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!scanning) return;
    const timer = window.setInterval(() => {
      if (scanStartedAt.current) {
        setElapsed(Date.now() - scanStartedAt.current);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [scanning]);

  useEffect(() => {
    if (updateLogRef.current) {
      updateLogRef.current.scrollTop = updateLogRef.current.scrollHeight;
    }
  }, [updateLog]);

  const addTargets = (selection: string[]) => {
    setTargets((current) => {
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
            ? "Choisir un ou plusieurs dossiers à analyser"
            : "Choisir un ou plusieurs fichiers à analyser",
      });
      if (!selection) return;
      addTargets(Array.isArray(selection) ? selection : [selection]);
    } catch (error) {
      toast({
        tone: "error",
        title: "Sélection impossible",
        message: errorMessage(error),
      });
    }
  };

  const startScan = async () => {
    if (targets.length === 0) {
      toast({ tone: "info", title: "Aucune cible", message: "Ajoutez un fichier ou un dossier." });
      return;
    }
    if (!engine?.installed) {
      toast({
        tone: "error",
        title: "Moteur ClamAV absent",
        message: "Installez ClamAV ou configurez son chemin dans les paramètres.",
      });
      return;
    }
    if (engine.signatureState === "missing") {
      setUpdateOpen(true);
      return;
    }

    setScanError(null);
    setResult(null);
    setLiveDetections([]);
    setLiveErrors([]);
    setProgress({ filesScanned: 0, threatsFound: 0, currentFile: null });
    setElapsed(0);
    setScanning(true);
    setCancelRequested(false);
    scanStartedAt.current = Date.now();

    try {
      const payload = await api.startScan(targets, recursive, includePua);
      setResult(payload);
      if (payload.persistenceError) {
        toast({
          tone: "error",
          title: "Historique non enregistré",
          message: payload.persistenceError,
        });
      }
      onHistoryChanged();
    } catch (error) {
      setScanError(errorMessage(error));
      toast({ tone: "error", title: "Scan impossible", message: errorMessage(error) });
    } finally {
      setScanning(false);
      scanStartedAt.current = null;
      setCancelRequested(false);
    }
  };

  const cancelScan = async () => {
    try {
      const requested = await api.cancelScan();
      if (requested) {
        setCancelRequested(true);
        toast({ tone: "info", title: "Annulation demandée", message: "ClamAV va être arrêté." });
      } else {
        toast({ tone: "info", title: "Aucun scan actif" });
      }
    } catch (error) {
      toast({ tone: "error", title: "Annulation impossible", message: errorMessage(error) });
    }
  };

  const recheckEngine = async () => {
    setChecking(true);
    try {
      const status = await api.engineStatus();
      onEngineChanged(status);
      toast({
        tone: status.installed ? "success" : "error",
        title: status.installed ? "Moteur détecté" : "Moteur introuvable",
        message: status.message,
      });
    } catch (error) {
      toast({ tone: "error", title: "Diagnostic impossible", message: errorMessage(error) });
    } finally {
      setChecking(false);
    }
  };

  const openUpdate = () => {
    setUpdateLog([]);
    setUpdateResult(null);
    setUpdateOpen(true);
  };

  const updateSignatures = async () => {
    setUpdating(true);
    setUpdateLog([]);
    setUpdateResult(null);
    try {
      const result = await api.updateSignatures(true);
      setUpdateResult(result);
      onEngineChanged(result.engine);
      toast({
        tone: result.success ? "success" : "error",
        title: result.success ? "Signatures mises à jour" : "Mise à jour incomplète",
        message: result.message,
      });
    } catch (error) {
      toast({
        tone: "error",
        title: "Mise à jour impossible",
        message: errorMessage(error),
      });
    } finally {
      setUpdating(false);
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
        title: "Fichier mis en quarantaine",
        message: `${fileBaseName(pendingDetection.filePath)} a été déplacé dans le coffre chiffré.`,
      });
      onHistoryChanged();
      setPendingDetection(null);
    } catch (error) {
      toast({
        tone: "error",
        title: "Mise en quarantaine refusée",
        message: errorMessage(error),
      });
    } finally {
      setQuarantining(false);
    }
  };

  const isQuarantined = (detection: Detection) =>
    quarantinedPaths.some(
      (path) => path.toLowerCase() === detection.filePath.toLowerCase(),
    );

  const report = result?.report ?? null;
  const displayDetections = report?.detections ?? liveDetections;
  const displayErrors = report?.errors ?? liveErrors;

  return (
    <div className="section-stack">
      <div className="banner banner--warning">
        <TriangleAlert size={19} aria-hidden="true" />
        <div>
          <strong>Analyse à la demande uniquement</strong>
          <span>
            ClamAV analyse les cibles choisies. Aucun fichier n'est supprimé
            automatiquement. Microsoft Defender n'est ni désactivé ni contourné.
          </span>
        </div>
      </div>

      {!engineLoading && !engine?.installed && (
        <div className="banner banner--danger">
          <CircleAlert size={19} aria-hidden="true" />
          <div>
            <strong>ClamAV n'est pas détecté sur ce poste</strong>
            <span>{engine?.message ?? "Installez l'outil officiel Cisco ClamAV pour activer les scans."}</span>
            <div className="banner__actions">
              <button type="button" className="button button--ghost" onClick={recheckEngine} disabled={checking}>
                <RefreshCw size={15} className={checking ? "spin" : undefined} />
                Revérifier
              </button>
              <button type="button" className="button button--ghost" onClick={() => onNavigate("settings")}>
                Configurer le chemin
                <ArrowRight size={15} />
              </button>
            </div>
            <code className="inline-code">winget install --id Cisco.ClamAV --exact</code>
          </div>
        </div>
      )}

      {engine?.installed && engine.signatureState === "missing" && (
        <div className="banner banner--danger">
          <Database size={19} aria-hidden="true" />
          <div>
            <strong>Signatures ClamAV absentes</strong>
            <span>{engine.message}</span>
            <div className="banner__actions">
              <button type="button" className="button button--primary" onClick={openUpdate}>
                <RefreshCw size={15} />
                Mettre à jour les signatures
              </button>
              <button type="button" className="button button--ghost" onClick={() => onNavigate("settings")}>
                Voir la base configurée
              </button>
            </div>
          </div>
        </div>
      )}

      {engine?.installed && engine.signatureState === "outdated" && (
        <div className="banner banner--warning">
          <Clock size={19} aria-hidden="true" />
          <div>
            <strong>Signatures anciennes — analyse toujours possible</strong>
            <span>{engine.message}</span>
            <div className="banner__actions">
              <button type="button" className="button button--ghost" onClick={openUpdate}>
                <RefreshCw size={15} />
                Mettre à jour
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="av-layout">
        <div className="av-main">
          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">Cibles</span>
                <h2>Fichiers et dossiers</h2>
              </div>
              <Badge tone={targets.length > 0 ? "info" : "neutral"} dot>
                {targets.length} cible{targets.length > 1 ? "s" : ""}
              </Badge>
            </div>

            {targets.length === 0 ? (
              <EmptyState
                icon={FileSearch}
                title="Aucune cible sélectionnée"
                description="Choisissez un fichier ou un dossier. Les chemins restent sur votre poste."
                action={
                  <div className="button-row">
                    <button type="button" className="button button--primary" onClick={() => pickTargets("file")}>
                      <FilePlus2 size={16} />
                      Choisir un fichier
                    </button>
                    <button type="button" className="button button--ghost" onClick={() => pickTargets("folder")}>
                      <FolderOpen size={16} />
                      Choisir un dossier
                    </button>
                  </div>
                }
              />
            ) : (
              <>
                <ul className="target-list">
                  {targets.map((target) => (
                    <li key={target}>
                      <div className="target-list__icon">
                        <FileSearch size={16} />
                      </div>
                      <div className="target-list__text">
                        <strong>{fileBaseName(target)}</strong>
                        <span title={target}>{truncateMiddle(target, 80)}</span>
                      </div>
                      <button
                        type="button"
                        className="button button--ghost button--icon"
                        onClick={() =>
                          setTargets((current) => current.filter((item) => item !== target))
                        }
                        disabled={scanning}
                        aria-label={`Retirer ${fileBaseName(target)}`}
                      >
                        <X size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="button-row">
                  <button type="button" className="button button--ghost" onClick={() => pickTargets("file")} disabled={scanning}>
                    <FilePlus2 size={16} />
                    Ajouter un fichier
                  </button>
                  <button type="button" className="button button--ghost" onClick={() => pickTargets("folder")} disabled={scanning}>
                    <FolderOpen size={16} />
                    Ajouter un dossier
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--subtle"
                    onClick={() => setTargets([])}
                    disabled={scanning}
                  >
                    Tout retirer
                  </button>
                </div>
              </>
            )}

            <div className="options">
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={recursive}
                  onChange={(event) => setRecursive(event.target.checked)}
                  disabled={scanning}
                />
                <span>
                  <strong>Analyse récursive</strong>
                  <small>Inclure les sous-dossiers des cibles sélectionnées.</small>
                </span>
              </label>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={includePua}
                  onChange={(event) => setIncludePua(event.target.checked)}
                  disabled={scanning}
                />
                <span>
                  <strong>Détecter les PUA</strong>
                  <small>Logiciels potentiellement indésirables (option ClamAV).</small>
                </span>
              </label>
            </div>

            <div className="scan-controls">
              <button
                type="button"
                className="button button--primary button--lg"
                onClick={startScan}
                disabled={scanning || targets.length === 0 || !engine?.installed}
              >
                {scanning ? <LoaderCircle size={18} className="spin" /> : <Play size={18} />}
                {scanning ? "Analyse en cours…" : "Lancer le scan"}
              </button>
              {scanning && (
                <button
                  type="button"
                  className="button button--danger button--lg"
                  onClick={cancelScan}
                  disabled={cancelRequested}
                >
                  <Square size={16} />
                  {cancelRequested ? "Annulation…" : "Annuler"}
                </button>
              )}
              <span className="scan-controls__hint">
                ClamAV charge sa base en mémoire : le premier résultat peut prendre plusieurs secondes.
              </span>
            </div>
          </section>

          {scanning && (
            <section className="panel panel--live" aria-live="polite">
              <div className="panel__head">
                <div>
                  <span className="panel__eyebrow">En cours</span>
                  <h2>Analyse ClamAV</h2>
                </div>
                <Badge tone="info" dot>
                  {formatDuration(elapsed)}
                </Badge>
              </div>

              <div className="progress-rail">
                <div className="progress-rail__bar" />
              </div>

              <div className="live-grid">
                <div>
                  <span className="live-grid__label">Fichiers analysés</span>
                  <strong>{formatNumber(progress.filesScanned)}</strong>
                </div>
                <div>
                  <span className="live-grid__label">Détections</span>
                  <strong className={progress.threatsFound > 0 ? "text-danger" : ""}>
                    {formatNumber(progress.threatsFound)}
                  </strong>
                </div>
                <div>
                  <span className="live-grid__label">Erreurs</span>
                  <strong>{formatNumber(liveErrors.length)}</strong>
                </div>
              </div>

              {progress.currentFile && (
                <div className="current-file">
                  <ScanLine size={15} />
                  <span title={progress.currentFile}>{truncateMiddle(progress.currentFile, 96)}</span>
                </div>
              )}

              {liveDetections.length > 0 && (
                <div className="live-detections">
                  {liveDetections.slice(-4).map((detection) => (
                    <div key={detection.filePath} className="live-detection">
                      <Bug size={15} />
                      <strong>{detection.threatName}</strong>
                      <span title={detection.filePath}>{truncateMiddle(detection.filePath, 64)}</span>
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
                <strong>Le scan n'a pas pu démarrer</strong>
                <span>{scanError}</span>
              </div>
            </div>
          )}

          {report && (
            <section className={`panel result result--${outcomeTone(report.outcome)}`}>
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
                    <span className="panel__eyebrow">Rapport</span>
                    <h2>{outcomeLabel(report.outcome)}</h2>
                  </div>
                </div>
                <Badge tone={outcomeTone(report.outcome)} dot>
                  {report.cancelled ? "Interrompu" : formatDuration(report.durationMs)}
                </Badge>
              </div>

              {report.fatalError && (
                <div className="callout callout--danger">
                  <strong>Échec du moteur</strong>
                  <span>{report.fatalError}</span>
                </div>
              )}

              {result?.persistenceError && (
                <div className="callout callout--warning">
                  <strong>Historique non enregistré</strong>
                  <span>{result.persistenceError}</span>
                </div>
              )}

              <div className="result-stats">
                <div>
                  <span>Fichiers analysés</span>
                  <strong>{formatNumber(report.filesScanned)}</strong>
                </div>
                <div>
                  <span>Menaces</span>
                  <strong className={report.infectedFiles > 0 ? "text-danger" : ""}>
                    {formatNumber(report.infectedFiles)}
                  </strong>
                </div>
                <div>
                  <span>Erreurs</span>
                  <strong>{formatNumber(report.errorCount)}</strong>
                </div>
                <div>
                  <span>Durée</span>
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
                  <Database size={14} /> Signatures {report.signatureVersion ?? "—"}
                </span>
                <span>
                  <FileSearch size={14} /> {report.targets.length} cible
                  {report.targets.length > 1 ? "s" : ""}
                </span>
              </div>

              {displayDetections.length > 0 ? (
                <div className="detections">
                  <div className="detections__head">
                    <h3>Détections ({displayDetections.length})</h3>
                    <span>Chaque déplacement exige votre confirmation explicite.</span>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Menace</th>
                          <th>Fichier</th>
                          <th className="num">Taille</th>
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
                            <td className="num">{formatBytes(detection.fileSizeBytes)}</td>
                            <td className="mono" title={detection.sha256 ?? undefined}>
                              {detection.sha256
                                ? `${detection.sha256.slice(0, 16)}…`
                                : "—"}
                            </td>
                            <td>
                              {isQuarantined(detection) ? (
                                <Badge tone="ok" dot>
                                  En quarantaine
                                </Badge>
                              ) : (
                                <button
                                  type="button"
                                  className="button button--small button--danger-ghost"
                                  onClick={() => setPendingDetection(detection)}
                                >
                                  <Archive size={14} />
                                  Mettre en quarantaine
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
                    <strong>Aucune détection sur les cibles analysées</strong>
                    <span>
                      Cela ne garantit pas l'absence de menace : seules les signatures
                      ClamAV chargées ont été appliquées.
                    </span>
                  </div>
                </div>
              )}

              {displayErrors.length > 0 && (
                <details className="details">
                  <summary>
                    <CircleAlert size={15} />
                    {displayErrors.length} erreur
                    {displayErrors.length > 1 ? "s" : ""} non bloquante
                    {displayErrors.length > 1 ? "s" : ""}
                  </summary>
                  <ul className="error-list">
                    {displayErrors.slice(0, 25).map((error, index) => (
                      <li key={`${error.path}-${index}`}>
                        <span className="mono">{truncateMiddle(error.path || "—", 60)}</span>
                        <span>{error.message}</span>
                      </li>
                    ))}
                  </ul>
                  {displayErrors.length > 25 && (
                    <p className="muted">{displayErrors.length - 25} erreurs supplémentaires non affichées.</p>
                  )}
                </details>
              )}
            </section>
          )}
        </div>

        <aside className="av-aside">
          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">Moteur</span>
                <h2>ClamAV</h2>
              </div>
              <Badge tone={signatureStateTone(engine?.signatureState ?? "unknown")} dot>
                {signatureStateLabel(engine?.signatureState ?? "unknown")}
              </Badge>
            </div>

            <dl className="detail-list detail-list--compact">
              <div>
                <dt>Version</dt>
                <dd>{engine?.engineVersion ?? "—"}</dd>
              </div>
              <div>
                <dt>Signatures</dt>
                <dd>{engine?.signatureVersion ?? "Absentes"}</dd>
              </div>
              <div>
                <dt>Publication</dt>
                <dd>{engine?.signatureDate ?? "—"}</dd>
              </div>
              <div>
                <dt>Âge</dt>
                <dd>
                  {engine?.signatureAgeDays !== null && engine?.signatureAgeDays !== undefined
                    ? `${engine.signatureAgeDays} jour(s)`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Fichiers de base</dt>
                <dd>{formatNumber(engine?.databaseFileCount ?? 0)}</dd>
              </div>
            </dl>

            <p className="panel__note">{engine?.message ?? "Diagnostic en cours…"}</p>

            <div className="path-box" title={engine?.databasePath ?? undefined}>
              <KeyRound size={14} />
              <span>{truncateMiddle(engine?.databasePath ?? "Base introuvable", 44)}</span>
            </div>

            <div className="button-col">
              <button
                type="button"
                className="button button--ghost button--full"
                onClick={recheckEngine}
                disabled={checking}
              >
                {checking ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                Revérifier le moteur
              </button>
              <button
                type="button"
                className="button button--ghost button--full"
                onClick={openUpdate}
                disabled={!engine?.freshclamPath}
                title={
                  engine?.freshclamPath
                    ? "Télécharger les signatures avec freshclam"
                    : "freshclam.exe introuvable"
                }
              >
                <Database size={15} />
                Mettre à jour les signatures
              </button>
            </div>
          </section>

          <section className="panel panel--muted">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">Périmètre</span>
                <h2>Limites de cette version</h2>
              </div>
            </div>
            <ul className="rule-list rule-list--compact">
              <li>Pas de protection en temps réel ni de surveillance de processus.</li>
              <li>Pas de suppression automatique : la quarantaine est toujours confirmée.</li>
              <li>Pas de moteur YARA-X actif en Phase 1.</li>
              <li>Les limites d'archives et de taille sont celles de ClamAV.</li>
              <li>Un scan propre ne prouve pas l'absence totale de malware.</li>
            </ul>
          </section>
        </aside>
      </div>

      <Modal
        open={updateOpen}
        title="Mettre à jour les signatures ClamAV"
        eyebrow="freshclam"
        tone={updateResult && !updateResult.success ? "danger" : "warning"}
        onClose={() => setUpdateOpen(false)}
        busy={updating}
        wide
        footer={
          <>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setUpdateOpen(false)}
              disabled={updating}
            >
              Fermer
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={updateSignatures}
              disabled={updating}
            >
              {updating ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
              {updating ? "Téléchargement…" : "Lancer la mise à jour"}
            </button>
          </>
        }
      >
        <p>
          CBS Shield exécute <code className="inline-code">freshclam.exe</code> pour
          télécharger les signatures officielles depuis <code className="inline-code">database.clamav.net</code>.
          Le premier téléchargement peut représenter plus de 100 Mo et prendre plusieurs
          minutes.
        </p>
        <dl className="detail-list detail-list--compact">
          <div>
            <dt>Dossier cible</dt>
            <dd className="mono">
              {settings?.databasePath || settings?.signatureDbPath || "—"}
            </dd>
          </div>
          <div>
            <dt>freshclam</dt>
            <dd className="mono">{engine?.freshclamPath ?? "Introuvable"}</dd>
          </div>
        </dl>
        <div className="callout callout--info">
          <strong>Aucune élévation demandée par CBS Shield</strong>
          <span>
            Le dossier cible est dans votre profil utilisateur. Si vous avez configuré un
            dossier système (Program Files), freshclam peut nécessiter des droits
            administrateur et échouer ici : le message d'erreur sera affiché tel quel.
          </span>
        </div>

        {updateLog.length > 0 && (
          <pre className="log-box" ref={updateLogRef}>
            {updateLog.join("\n")}
          </pre>
        )}

        {updateResult && (
          <div className={`callout ${updateResult.success ? "callout--success" : "callout--danger"}`}>
            <strong>{updateResult.success ? "Mise à jour terminée" : "Mise à jour incomplète"}</strong>
            <span>{updateResult.message}</span>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingDetection !== null}
        title="Déplacer ce fichier en quarantaine ?"
        eyebrow="Action sensible"
        tone="danger"
        description={
          <div className="confirm__stack">
            <div className="callout callout--danger">
              <strong>Ce fichier a été signalé par ClamAV</strong>
              <span>
                CBS Shield va le déplacer hors de son emplacement d'origine et le chiffrer
                avec AES-256-GCM. La clé est protégée par Windows DPAPI pour votre compte.
              </span>
            </div>
            {pendingDetection && (
              <dl className="detail-list detail-list--compact">
                <div>
                  <dt>Fichier</dt>
                  <dd className="mono">{pendingDetection.filePath}</dd>
                </div>
                <div>
                  <dt>Détection</dt>
                  <dd>{pendingDetection.threatName}</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd className="mono">{pendingDetection.sha256 ?? "Non calculé"}</dd>
                </div>
              </dl>
            )}
            <p className="muted">
              Vous pourrez restaurer le fichier depuis la section Quarantaine. Il ne sera
              jamais exécuté ni supprimé automatiquement.
            </p>
          </div>
        }
        requireCheckbox="Je comprends que le fichier sera déplacé et ne sera plus à son emplacement d'origine."
        confirmLabel="Mettre en quarantaine"
        busy={quarantining}
        onConfirm={quarantineDetection}
        onClose={() => setPendingDetection(null)}
      />
    </div>
  );
}
