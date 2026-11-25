import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  CircleAlert,
  Folder,
  LoaderCircle,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toasts";
import { api, errorMessage } from "../lib/api";
import { formatDateTime, formatNumber, truncateMiddle } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type {
  ProactiveAutoScanStatus,
  ProactiveConfig,
  ProactiveEvent,
  ProactiveStatus,
} from "../types";
import { InfoTip } from "../components/InfoTip";

type Localize = (fr: string, en: string) => string;
type Busy =
  | "directory"
  | "config"
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "drain"
  | "clear"
  | "autoscan"
  | "refresh"
  | null;

const EVENT_TONE: Record<ProactiveEvent["kind"], "ok" | "info" | "warning"> = {
  created: "info",
  modified: "info",
  rejected: "warning",
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

function eventLabel(kind: ProactiveEvent["kind"], L: Localize): string {
  if (kind === "created") return L("Créé", "Created");
  if (kind === "modified") return L("Modifié", "Modified");
  return L("Hors limites", "Skipped");
}

export function ProactiveMonitor() {
  const { language } = useI18n();
  const L: Localize = (fr, en) => (language === "en" ? en : fr);
  const toast = useToast();

  const [status, setStatus] = useState<ProactiveStatus | null>(null);
  const [autoScan, setAutoScan] = useState<ProactiveAutoScanStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [pathInput, setPathInput] = useState("");
  const [configDraft, setConfigDraft] = useState<ProactiveConfig | null>(null);
  // While the resource-limit draft is untouched, snapshots may refresh the
  // displayed values. Once the user edits the draft, it is protected.
  const configDirtyRef = useRef(false);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setBusy("refresh");
      try {
        const snapshot = await api.proactiveSnapshot();
        setStatus(snapshot);
        if (!configDirtyRef.current) {
          setConfigDraft(snapshot.config);
        }
      } catch (err) {
        if (!silent) {
          toast({
            tone: "error",
            title: L("Chargement impossible", "Could not load"),
            message: errorMessage(err),
          });
        }
      } finally {
        if (!silent) setBusy(null);
      }
    },
    // One loader identity per language keeps banner texts coherent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const refreshAutoScan = useCallback(async (silent: boolean) => {
    if (!silent) setBusy("autoscan");
    try {
      setAutoScan(await api.proactiveScanStatus());
    } catch {
      // Status is auxiliary: a transient IPC hiccup must not break the page.
    } finally {
      if (!silent) setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refreshAutoScan(true);
  }, [refreshAutoScan]);

  // Live updates from the background worker.
  useEffect(() => {
    const unlistenPromise = listen<unknown>("proactive:auto-scan", () => {
      void refreshAutoScan(true);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refreshAutoScan]);

  const runAction = useCallback(
    async (
      action: Exclude<Busy, null>,
      fn: () => Promise<ProactiveStatus | string[]>,
      drained: boolean,
    ) => {
      setBusy(action);
      try {
        const result = await fn();
        if (drained && Array.isArray(result)) {
          toast({
            tone: "info",
            title: L("File récupérée", "Queue drained"),
            message:
              result.length === 0
                ? L("La file était vide.", "The queue was empty.")
                : `${result.length} ${L("fichier(s) à passer manuellement à l'analyse antivirus.", "file(s) to send to manual antivirus analysis.")}`,
          });
        }
        const snapshot = await api.proactiveSnapshot();
        setStatus(snapshot);
        if (!configDirtyRef.current) {
          setConfigDraft(snapshot.config);
        }
      } catch (err) {
        toast({
          tone: "error",
          title: L("Action impossible", "Action failed"),
          message: errorMessage(err),
        });
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );

  const busyLock = busy !== null;
  const noDirectories = (status?.directories.length ?? 0) === 0;

  const removeDirectory = (directory: string) => {
    if (!status) return;
    const next = status.directories.filter((entry) => entry !== directory);
    void runAction("directory", () => api.proactiveSetDirectories(next), false);
  };

  const chooseDirectories = async () => {
    let picked: string[] | string | null = null;
    try {
      picked = (await openDialog({
        directory: true,
        multiple: true,
      })) as string[] | string | null;
    } catch {
      return; // user cancelled
    }
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (list.length === 0) return;
    const merged = Array.from(new Set([...(status?.directories ?? []), ...list]));
    void runAction("directory", () => api.proactiveSetDirectories(merged), false);
  };

  const submitManualDirectory = (event: FormEvent) => {
    event.preventDefault();
    const raw = pathInput.trim();
    if (!raw || !status) return;
    const merged = Array.from(new Set([...status.directories, raw]));
    setPathInput("");
    void runAction("directory", () => api.proactiveSetDirectories(merged), false);
  };

  const applyConfig = () => {
    if (!configDraft) return;
    const next: ProactiveConfig = {
      cycleSeconds: clampInt(configDraft.cycleSeconds, 1, 30),
      maxFilesPerCycle: clampInt(configDraft.maxFilesPerCycle, 1, 1000),
      maxFileSizeMb: clampInt(configDraft.maxFileSizeMb, 1, 256),
      maxDepth: clampInt(configDraft.maxDepth, 1, 8),
    };
    configDirtyRef.current = false;
    void runAction("config", () => api.proactiveSetConfig(next), false);
  };

  return (
    <div className="section-stack proactive">
      {status !== null && !status.running && (
        <div className="banner banner--warning" role="status">
          <Radar size={16} aria-hidden="true" />
          <p>
            {L(
              "Surveillance arrêtée. Elle ne démarre que sur votre action : CBS Shield n'est pas un antivirus temps réel et ne bloque pas l'exécution des fichiers. Microsoft Defender reste votre protection en continu.",
              "Monitoring is stopped. It only runs after your action: CBS Shield is not a real-time antivirus and does not block file execution. Microsoft Defender remains your continuous protection.",
            )}
          </p>
        </div>
      )}

      <section className="panel" aria-label={L("Commandes de surveillance", "Monitoring controls")}>
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Surveillance proactive", "Proactive monitoring")}</span>
            <h2>
              {status === null
                ? L("Chargement…", "Loading…")
                : status.running
                  ? status.paused
                    ? L("En pause", "Paused")
                    : L("Surveillance active", "Monitoring active")
                  : L("Surveillance arrêtée", "Monitoring stopped")}
            </h2>
          </div>
          <div className="row-actions">
            {status !== null && !status.running && (
              <button
                type="button"
                className="button button--primary button--small"
                disabled={busyLock || noDirectories}
                title={noDirectories ? L("Ajoutez d'abord un dossier", "Add a folder first") : undefined}
                onClick={() => void runAction("start", () => api.proactiveStart(), false)}
              >
                {busy === "start" ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
                {L("Démarrer", "Start")}
              </button>
            )}
            {status !== null && status.running && !status.paused && (
              <button
                type="button"
                className="button button--ghost button--small"
                disabled={busyLock}
                onClick={() => void runAction("pause", () => api.proactivePause(), false)}
              >
                {busy === "pause" ? <LoaderCircle size={14} className="spin" /> : <Pause size={14} />}
                {L("Pause", "Pause")}
              </button>
            )}
            {status !== null && status.running && status.paused && (
              <button
                type="button"
                className="button button--primary button--small"
                disabled={busyLock}
                onClick={() => void runAction("resume", () => api.proactiveResume(), false)}
              >
                {busy === "resume" ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
                {L("Reprendre", "Resume")}
              </button>
            )}
            {status !== null && status.running && (
              <button
                type="button"
                className="button button--danger-ghost button--small"
                disabled={busyLock}
                onClick={() => void runAction("stop", () => api.proactiveStop(), false)}
              >
                {busy === "stop" ? <LoaderCircle size={14} className="spin" /> : <Square size={14} />}
                {L("Arrêter", "Stop")}
              </button>
            )}
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={busyLock}
              onClick={() => void load(false)}
            >
              {busy === "refresh" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              {L("Actualiser", "Refresh")}
            </button>
          </div>
        </div>
        {status?.lastError && (
          <div className="banner banner--danger">
            <CircleAlert size={16} aria-hidden="true" />
            <p>{status.lastError}</p>
          </div>
        )}
      </section>

      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-card__top">
            <span className="metric-card__label">{L("Dossiers surveillés", "Watched folders")}</span>
          </div>
          <span className="metric-card__value">{formatNumber(status?.directories.length ?? 0)}</span>
          <span className="metric-card__hint">
            {L("Choisis explicitement par l'utilisateur.", "Explicitly chosen by the user.")}
          </span>
        </div>
        <div className="metric-card">
          <div className="metric-card__top">
            <span className="metric-card__label">{L("Fichiers suivis", "Tracked files")}</span>
          </div>
          <span className="metric-card__value">{formatNumber(status?.trackedFiles ?? 0)}</span>
          <span className="metric-card__hint">
            {L("Seuls les fichiers modifiés sont relus.", "Only modified files are re-checked.")}
          </span>
        </div>
        <div className="metric-card">
          <div className="metric-card__top">
            <span className="metric-card__label">{L("File d'analyse", "Review queue")}</span>
          </div>
          <span className="metric-card__value">{formatNumber(status?.queueCount ?? 0)}</span>
          <span className="metric-card__hint">
            {L("File bornée, vidée manuellement.", "Bounded queue, drained manually.")}
          </span>
        </div>
        <div className="metric-card">
          <div className="metric-card__top">
            <span className="metric-card__label">{L("Dernier cycle", "Last cycle")}</span>
          </div>
          <span className="metric-card__value">
            {status?.lastCycleAt ? formatDateTime(status.lastCycleAt) : "—"}
          </span>
          <span className="metric-card__hint">
            {status
              ? L(`Cycle de ${status.config.cycleSeconds} s`, `${status.config.cycleSeconds} s cycle`)
              : "—"}
          </span>
        </div>
      </div>

      <section className="panel" aria-label={L("Périmètre surveillé", "Watched scope")}>
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Périmètre", "Scope")}</span>
            <h2>{L("Dossiers surveillés", "Watched folders")}</h2>
            <div className="note-tip">
              <InfoTip text>{L(
                "Tout dossier ajouté arrête la surveillance en cours : redémarrez-la ensuite explicitement.",
                "Any folder change stops the current monitoring: restart it explicitly afterwards.",
              )}</InfoTip>
            </div>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={busyLock}
              onClick={() => void chooseDirectories()}
            >
              <Folder size={14} /> {L("Ajouter (sélecteur)", "Add (picker)")}
            </button>
          </div>
        </div>
        {status !== null && status.directories.length > 0 ? (
          <div className="webguard-pills" aria-label={L("Dossiers surveillés", "Watched folders")}>
            {status.directories.map((directory) => (
              <span key={directory} className="webguard-pill" title={directory}>
                {truncateMiddle(directory, 52)}
                <button
                  type="button"
                  className="button button--ghost button--small"
                  disabled={busyLock}
                  aria-label={`${L("Retirer", "Remove")} ${truncateMiddle(directory, 30)}`}
                  onClick={() => removeDirectory(directory)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Folder}
            title={L("Aucun dossier surveillé", "No watched folder")}
            description={L(
              "Choisissez les dossiers à observer ; la surveillance ne démarre que si vous l'activez.",
              "Pick the folders to observe; monitoring only runs once you start it.",
            )}
          />
        )}
        <form className="proactive__manual" onSubmit={submitManualDirectory}>
          <label className="field proactive__manual-field">
            <span className="field__label">{L("Chemin du dossier", "Folder path")}</span>
            <input
              className="input"
              type="text"
              value={pathInput}
              placeholder={L("Ex. C:\\Users\\moi\\Documents", "e.g. C:\\Users\\me\\Documents")}
              disabled={busyLock}
              onChange={(event) => setPathInput(event.target.value)}
            />
          </label>
          <button type="submit" className="button button--ghost button--small" disabled={busyLock || pathInput.trim() === ""}>
            {L("Ajouter", "Add")}
          </button>
        </form>
      </section>

      <section className="panel" aria-label={L("Limites de ressources", "Resource limits")}>
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Ressources", "Resources")}</span>
            <h2>{L("Limites de surveillance", "Monitoring limits")}</h2>
            <div className="note-tip">
              <InfoTip text>{L(
                "Ces limites contrôlent le coût d'observation ; elles ne garantissent pas la détection de tout événement en temps réel.",
                "These limits control observation cost; they do not guarantee real-time detection of every event.",
              )}</InfoTip>
            </div>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="button button--primary button--small"
              disabled={busyLock || configDraft === null}
              onClick={applyConfig}
            >
              {busy === "config" ? <LoaderCircle size={14} className="spin" /> : null}
              {L("Appliquer", "Apply")}
            </button>
          </div>
        </div>
        {configDraft !== null && (
          <div className="form-grid proactive__config">
            <label className="field">
              <span className="field__label">{L("Intervalle de cycle (s)", "Cycle interval (s)")}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={30}
                value={configDraft.cycleSeconds}
                disabled={busyLock}
                onChange={(event) => {
                  configDirtyRef.current = true;
                  setConfigDraft({ ...configDraft, cycleSeconds: clampInt(Number(event.target.value), 1, 30) });
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">{L("Fichiers max / cycle", "Max files / cycle")}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={1000}
                value={configDraft.maxFilesPerCycle}
                disabled={busyLock}
                onChange={(event) => {
                  configDirtyRef.current = true;
                  setConfigDraft({ ...configDraft, maxFilesPerCycle: clampInt(Number(event.target.value), 1, 1000) });
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">{L("Taille max fichier (Mo)", "Max file size (MiB)")}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={256}
                value={configDraft.maxFileSizeMb}
                disabled={busyLock}
                onChange={(event) => {
                  configDirtyRef.current = true;
                  setConfigDraft({ ...configDraft, maxFileSizeMb: clampInt(Number(event.target.value), 1, 256) });
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">{L("Profondeur max", "Max depth")}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={8}
                value={configDraft.maxDepth}
                disabled={busyLock}
                onChange={(event) => {
                  configDirtyRef.current = true;
                  setConfigDraft({ ...configDraft, maxDepth: clampInt(Number(event.target.value), 1, 8) });
                }}
              />
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={status?.autoWatch ?? false}
                disabled={busyLock || noDirectories}
                onChange={(event) => {
                  void runAction("config", () => api.proactiveSetAutoWatch(event.target.checked), false);
                }}
              />
              <span>
                <strong>{L("Relance au démarrage", "Resume at launch")}</strong>
                <small>
                  {L(
                    "Reprend la surveillance au lancement de CBS Shield (consentement explicite).",
                    "Resumes monitoring when CBS Shield starts (explicit consent).",
                  )}
                </small>
              </span>
            </label>
          </div>
        )}
      </section>

      <section className="panel" aria-label={L("Activité observée", "Observed activity")}>
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Activité", "Activity")}</span>
            <h2>{L("Modifications à analyser", "Changes to review")}</h2>
          </div>
          <div className="row-actions">
            <Badge tone="neutral">{formatNumber(status?.queueCount ?? 0)}</Badge>
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={busyLock || (status?.queueCount ?? 0) === 0}
              onClick={() => void runAction("drain", () => api.proactiveDrain(), true)}
            >
              {busy === "drain" ? <LoaderCircle size={14} className="spin" /> : null}
              {L("Vider la file", "Drain queue")}
            </button>
            <button
              type="button"
              className="button button--danger-ghost button--small"
              disabled={busyLock}
              onClick={() => void runAction("clear", () => api.proactiveClear(), false)}
            >
              {busy === "clear" ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
              {L("Réinitialiser", "Reset")}
            </button>
          </div>
        </div>
        {status !== null && status.events.length > 0 ? (
          <ul className="proactive__events" aria-label={L("Activité récente", "Recent activity")}>
            {status.events.map((event) => (
              <li key={`${event.id}-${event.occurredAt}`} className="proactive__event">
                <Badge tone={EVENT_TONE[event.kind]} dot subtle>
                  {eventLabel(event.kind, L)}
                </Badge>
                <span className="proactive__event-path" title={event.path}>
                  {truncateMiddle(event.path, 72)}
                </span>
                <span className="proactive__event-time">
                  {formatDateTime(event.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Radar}
            title={L("Aucune activité observée", "No observed activity")}
            description={L(
              "Aucun fichier créé ou modifié depuis le dernier cycle.",
              "No file has been created or modified since the last cycle.",
            )}
          />
        )}
        <div className="note-tip">
          <InfoTip text>{L(
            "Vider la file ne lance pas d'analyse : passez les fichiers à l'onglet Antivirus, la détection reste manuelle.",
            "Draining the queue starts no analysis: send the files to the Antivirus tab; detection stays manual.",
          )}</InfoTip>
        </div>
      </section>

      <section className="panel" aria-label={L("Analyse automatique", "Automatic analysis")}>
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Analyse automatique", "Automatic analysis")}</span>
            <h2>{L("Analyse ClamAV de la file d'observation", "ClamAV analysis of the review queue")}</h2>
          </div>
          <div className="row-actions">
            <Badge tone={autoScan?.running ? "ok" : "neutral"} dot subtle>
              {autoScan === null
                ? L("État inconnu", "Unknown state")
                : autoScan.running
                  ? L("Ouvrier actif", "Worker active")
                  : L("Ouvrier arrêté", "Worker stopped")}
            </Badge>
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={busyLock}
              onClick={() => void refreshAutoScan(false)}
            >
              {busy === "autoscan" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              {L("Actualiser", "Refresh")}
            </button>
          </div>
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={autoScan?.enabled ?? false}
            disabled={busyLock || noDirectories}
            onChange={(event) => {
              const wanted = event.target.checked;
              setBusy("autoscan");
              api
                .proactiveSetAutoScan(wanted)
                .then(setAutoScan)
                .catch((err) => {
                  toast({
                    tone: "error",
                    title: L("Consentement impossible", "Could not change consent"),
                    message: errorMessage(err),
                  });
                  void refreshAutoScan(true);
                })
                .finally(() => setBusy(null));
            }}
          />
          <span>
            <strong>
              {L(
                "Analyser automatiquement les fichiers de la file (opt-in explicite)",
                "Automatically analyze queued files (explicit opt-in)",
              )}
            </strong>
            <small>
              {L(
                "Les fichiers ne sont jamais supprimés ni mis en quarantaine automatiquement : une détection vous est signalée et reste à traiter par vous. Désactiver arrête l'analyse en cours.",
                "Files are never deleted or quarantined automatically: a detection is reported and left for you to handle. Toggling off stops the in-flight analysis.",
              )}
            </small>
          </span>
        </label>
        {autoScan?.lastError && (
          <div className="banner banner--danger">
            <CircleAlert size={16} aria-hidden="true" />
            <p>{autoScan.lastError}</p>
          </div>
        )}
        {autoScan?.busyFiles && autoScan.busyFiles.length > 0 && (
          <p className="panel__note">
            {L(
              `Analyse en cours : ${autoScan.busyFiles.length} fichier(s).`,
              `Analysis in progress: ${autoScan.busyFiles.length} file(s).`,
            )}
          </p>
        )}
        {autoScan?.lastBatch && (
          <div className="metric-grid proactive__batch-grid">
            <div className="metric-card">
              <div className="metric-card__top">
                <span className="metric-card__label">{L("Dernier lot", "Last batch")}</span>
              </div>
              <span className="metric-card__value">{formatNumber(autoScan.lastBatch.files)}</span>
              <span className="metric-card__hint">
                {autoScan.lastBatch.finishedAt ? formatDateTime(autoScan.lastBatch.finishedAt) : "—"}
              </span>
            </div>
            <div className="metric-card">
              <div className="metric-card__top">
                <span className="metric-card__label">{L("Détections", "Detections")}</span>
              </div>
              <span className="metric-card__value">{formatNumber(autoScan.lastBatch.detections)}</span>
              <span className="metric-card__hint">
                {autoScan.lastBatch.outcome === "detected"
                  ? L("À traiter dans l'onglet Antivirus", "Handle in the Antivirus tab")
                  : autoScan.lastBatch.outcome === "failed"
                    ? L("Échec enregistré dans l'historique", "Failure recorded in history")
                    : L("Rien à signaler", "Nothing to report")}
              </span>
            </div>
            <div className="metric-card">
              <div className="metric-card__top">
                <span className="metric-card__label">{L("Échecs d'accès", "Access failures")}</span>
              </div>
              <span className="metric-card__value">{formatNumber(autoScan.lastBatch.failures)}</span>
              <span className="metric-card__hint">{L("Tracés dans l'historique", "Traced in history")}</span>
            </div>
            <div className="metric-card">
              <div className="metric-card__top">
                <span className="metric-card__label">{L("Rapport", "Report")}</span>
              </div>
              <span className="metric-card__value">
                {autoScan.lastBatch.recordId === null ? "—" : `#${autoScan.lastBatch.recordId}`}
              </span>
              <span className="metric-card__hint">{L("Historique des scans", "Scan history")}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
