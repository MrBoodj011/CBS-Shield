import {
  CircleAlert,
  CircleCheck,
  Database,
  FolderOpen,
  Info,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "../components/Badge";
import { useToast } from "../components/Toasts";
import { api, errorMessage } from "../lib/api";
import {
  formatDateTime,
  formatNumber,
  signatureStateLabel,
  signatureStateTone,
  truncateMiddle,
} from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { AppInfo, EngineStatus, SettingsView } from "../types";

interface SettingsProps {
  settings: SettingsView | null;
  engine: EngineStatus | null;
  info: AppInfo | null;
  engineLoading: boolean;
  onSettingsSaved: (settings: SettingsView) => void;
  onEngineChanged: (engine: EngineStatus) => void;
}

interface FormState {
  theme: string;
  language: string;
  recursive: boolean;
  includePua: boolean;
  clamscanPath: string;
  databasePath: string;
  signatureMaxAgeDays: number;
}

const EMPTY_FORM: FormState = {
  theme: "dark",
  language: "fr",
  recursive: true,
  includePua: false,
  clamscanPath: "",
  databasePath: "",
  signatureMaxAgeDays: 7,
};

export function Settings({
  settings,
  engine,
  info,
  engineLoading,
  onSettingsSaved,
  onEngineChanged,
}: SettingsProps) {
  const toast = useToast();
  const { t, language } = useI18n();
  const L = (fr: string, en: string) => (language === "en" ? en : fr);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setForm({
      theme: settings.theme,
      language: settings.language === "en" ? "en" : "fr",
      recursive: settings.recursive,
      includePua: settings.includePua,
      clamscanPath: settings.clamscanPath ?? "",
      databasePath: settings.databasePath ?? "",
      signatureMaxAgeDays: settings.signatureMaxAgeDays,
    });
  }, [settings]);

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const saved = await api.updateSettings({
        theme: form.theme,
        language: form.language,
        recursive: form.recursive,
        includePua: form.includePua,
        clamscanPath: form.clamscanPath,
        databasePath: form.databasePath,
        signatureMaxAgeDays: Number(form.signatureMaxAgeDays),
      });
      onSettingsSaved(saved);
      toast({ tone: "success", title: L("Paramètres enregistrés", "Settings saved") });
    } catch (error) {
      setFormError(errorMessage(error));
      toast({
        tone: "error",
        title: L("Paramètres non enregistrés", "Settings not saved"),
        message: errorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const recheck = async () => {
    setChecking(true);
    try {
      const status = await api.engineStatus();
      onEngineChanged(status);
      toast({
        tone: status.installed ? "success" : "error",
        title: status.installed
          ? L("Diagnostic terminé", "Diagnostic complete")
          : L("ClamAV introuvable", "ClamAV not found"),
        message: status.message,
      });
    } catch (error) {
      toast({
        tone: "error",
        title: L("Diagnostic impossible", "Diagnostic failed"),
        message: errorMessage(error),
      });
    } finally {
      setChecking(false);
    }
  };

  const openDataDir = async () => {
    try {
      await api.openDataDir();
    } catch (error) {
      toast({
        tone: "error",
        title: L("Ouverture impossible", "Unable to open"),
        message: errorMessage(error),
      });
    }
  };

  const dirty = Boolean(
    settings &&
      (form.theme !== settings.theme ||
        form.language !== settings.language ||
        form.recursive !== settings.recursive ||
        form.includePua !== settings.includePua ||
        form.clamscanPath !== (settings.clamscanPath ?? "") ||
        form.databasePath !== (settings.databasePath ?? "") ||
        Number(form.signatureMaxAgeDays) !== settings.signatureMaxAgeDays),
  );

  return (
    <div className="section-stack">
      <div className="banner banner--neutral">
        <Info size={19} aria-hidden="true" />
        <div>
          <strong>{L("Réglages locaux", "Local settings")}</strong>
          <span>
            {L(
              "Tous les paramètres sont enregistrés dans SQLite sur ce poste. Aucun compte, aucun serveur, aucune télémétrie.",
              "All settings are stored in SQLite on this machine. No account, no server, no telemetry.",
            )}
          </span>
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-main">
          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Apparence", "Appearance")}</span>
                <h2>{L("Thème de l'interface", "Interface theme")}</h2>
              </div>
            </div>
            <div className="segmented" role="group" aria-label={L("Thème", "Theme")}>
              {[
                { value: "dark", label: L("Sombre", "Dark") },
                { value: "light", label: L("Clair", "Light") },
                { value: "system", label: L("Système", "System") },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={form.theme === option.value ? "is-active" : ""}
                  onClick={() => setForm((current) => ({ ...current, theme: option.value }))}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 18 }}>
              <div className="panel__head" style={{ marginBottom: 8 }}>
                <div>
                  <span className="panel__eyebrow">{L("Localisation", "Localization")}</span>
                  <h2>{t("settings.language")}</h2>
                </div>
              </div>
              <div className="segmented" role="group" aria-label={t("settings.language")}>
                {[
                  { value: "fr", label: t("settings.languageFr") },
                  { value: "en", label: t("settings.languageEn") },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={form.language === option.value ? "is-active" : ""}
                    onClick={() => setForm((current) => ({ ...current, language: option.value }))}
                    lang={option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="field__hint" style={{ marginTop: 8 }}>
                {t("settings.languageHint")}
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Analyse", "Scanning")}</span>
                <h2>{L("Valeurs par défaut", "Defaults")}</h2>
              </div>
            </div>
            <div className="form-grid">
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={form.recursive}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, recursive: event.target.checked }))
                  }
                />
                <span>
                  <strong>{L("Analyse récursive", "Recursive scan")}</strong>
                  <small>
                    {L(
                      "Par défaut, inclure les sous-dossiers.",
                      "Include subfolders by default.",
                    )}
                  </small>
                </span>
              </label>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={form.includePua}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, includePua: event.target.checked }))
                  }
                />
                <span>
                  <strong>{L("Détecter les PUA", "Detect PUAs")}</strong>
                  <small>
                    {L(
                      "Logiciels potentiellement indésirables.",
                      "Potentially unwanted programs.",
                    )}
                  </small>
                </span>
              </label>
              <label className="field">
                <span className="field__label">
                  {L(
                    "Seuil de fraîcheur des signatures (jours)",
                    "Signature freshness threshold (days)",
                  )}
                </span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={365}
                  value={form.signatureMaxAgeDays}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      signatureMaxAgeDays: Number(event.target.value),
                    }))
                  }
                />
                <span className="field__hint">
                  {L(
                    "Au-delà de ce seuil, l'interface signale des signatures anciennes sans bloquer les scans.",
                    "Beyond this threshold, the interface flags old signatures without blocking scans.",
                  )}
                </span>
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Moteur externe", "External engine")}</span>
                <h2>ClamAV</h2>
              </div>
              <Badge tone={signatureStateTone(engine?.signatureState ?? "unknown")} dot>
                {signatureStateLabel(engine?.signatureState ?? "unknown")}
              </Badge>
            </div>

            <div className="form-grid">
              <label className="field">
                <span className="field__label">
                  {L("Chemin de clamscan.exe (optionnel)", "clamscan.exe path (optional)")}
                </span>
                <input
                  className="input mono"
                  value={form.clamscanPath}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, clamscanPath: event.target.value }))
                  }
                  placeholder={L(
                    "Détection automatique (PATH / Program Files)",
                    "Automatic detection (PATH / Program Files)",
                  )}
                  spellCheck={false}
                />
                <span className="field__hint">
                  {L("Doit pointer vers un fichier nommé ", "Must point to a file named ")}
                  <code>clamscan.exe</code>
                  {L(
                    ". Laissez vide pour la détection automatique.",
                    ". Leave empty for automatic detection.",
                  )}
                </span>
              </label>

              <label className="field">
                <span className="field__label">
                  {L("Dossier de signatures (optionnel)", "Signature folder (optional)")}
                </span>
                <input
                  className="input mono"
                  value={form.databasePath}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, databasePath: event.target.value }))
                  }
                  placeholder={L("Détection automatique", "Automatic detection")}
                  spellCheck={false}
                />
                <span className="field__hint">
                  {L("Dossier contenant ", "Folder containing ")}
                  <code>.cvd</code> / <code>.cld</code>
                  {L(
                    ", par exemple la base utilisateur maintenue par CBS Shield.",
                    ", for example the user database maintained by CBS Shield.",
                  )}
                </span>
              </label>
            </div>

            <div className="action-row">
              <button
                type="button"
                className="button button--ghost"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    clamscanPath: "",
                    databasePath: "",
                  }))
                }
              >
                {L("Effacer les chemins personnalisés", "Clear custom paths")}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={recheck}
                disabled={checking || engineLoading}
              >
                {checking ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                {L("Revérifier la détection", "Recheck detection")}
              </button>
            </div>

            <dl className="detail-list detail-list--compact">
              <div>
                <dt>{L("clamscan détecté", "clamscan detected")}</dt>
                <dd className="mono" title={engine?.clamscanPath ?? undefined}>
                  {engine?.clamscanPath
                    ? truncateMiddle(engine.clamscanPath, 60)
                    : L("Non détecté", "Not detected")}
                </dd>
              </div>
              <div>
                <dt>{L("Base utilisée", "Database in use")}</dt>
                <dd className="mono" title={engine?.databasePath ?? undefined}>
                  {engine?.databasePath
                    ? truncateMiddle(engine.databasePath, 60)
                    : L("Introuvable", "Not found")}
                </dd>
              </div>
              <div>
                <dt>freshclam</dt>
                <dd className="mono" title={engine?.freshclamPath ?? undefined}>
                  {engine?.freshclamPath
                    ? truncateMiddle(engine.freshclamPath, 60)
                    : L("Introuvable", "Not found")}
                </dd>
              </div>
            </dl>
          </section>

          {formError && (
            <div className="banner banner--danger">
              <CircleAlert size={19} aria-hidden="true" />
              <div>
                <strong>{L("Validation refusée", "Validation rejected")}</strong>
                <span>{formError}</span>
              </div>
            </div>
          )}

          <div className="save-bar">
            <span className={dirty ? "save-bar__dirty" : "muted"}>
              {dirty
                ? L("Modifications non enregistrées", "Unsaved changes")
                : L("Tous les réglages sont enregistrés", "All settings are saved")}
            </span>
            <button
              type="button"
              className="button button--primary"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
              {L("Enregistrer", "Save")}
            </button>
          </div>
        </div>

        <aside className="settings-aside">
          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Diagnostic", "Diagnostics")}</span>
                <h2>{L("État du moteur", "Engine status")}</h2>
              </div>
              {engine?.installed ? (
                <CircleCheck size={19} className="text-ok" />
              ) : (
                <TriangleAlert size={19} className="text-warning" />
              )}
            </div>

            <p className={`engine-message engine-message--${signatureStateTone(engine?.signatureState ?? "unknown")}`}>
              {engine?.message ??
                L("Diagnostic du moteur en cours…", "Engine diagnostic in progress…")}
            </p>

            <dl className="detail-list detail-list--compact">
              <div>
                <dt>Version</dt>
                <dd>{engine?.engineVersion ?? "—"}</dd>
              </div>
              <div>
                <dt>Signatures</dt>
                <dd>{engine?.signatureVersion ?? L("Absentes", "Missing")}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{engine?.signatureDate ?? "—"}</dd>
              </div>
              <div>
                <dt>{L("Fichiers", "Files")}</dt>
                <dd>{formatNumber(engine?.databaseFileCount ?? 0)}</dd>
              </div>
              <div>
                <dt>{L("Vérifié", "Checked")}</dt>
                <dd>{formatDateTime(engine?.checkedAt)}</dd>
              </div>
            </dl>

            <button
              type="button"
              className="button button--ghost button--full"
              onClick={recheck}
              disabled={checking || engineLoading}
            >
              {checking ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              {L("Relancer le diagnostic", "Run diagnostic again")}
            </button>
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Données", "Data")}</span>
                <h2>{L("Emplacements locaux", "Local locations")}</h2>
              </div>
            </div>

            <div className="path-list">
              <div>
                <span>
                  <Database size={14} /> {L("Données", "Data")}
                </span>
                <code title={settings?.dataDir}>{settings?.dataDir ?? "—"}</code>
              </div>
              <div>
                <span>
                  <Database size={14} /> {L("Historique SQLite", "SQLite history")}
                </span>
                <code title={settings?.historyPath}>{settings?.historyPath ?? "—"}</code>
              </div>
              <div>
                <span>
                  <KeyRound size={14} /> {L("Quarantaine", "Quarantine")}
                </span>
                <code title={settings?.quarantinePath}>{settings?.quarantinePath ?? "—"}</code>
              </div>
              <div>
                <span>
                  <ShieldCheck size={14} /> {L("Signatures", "Signatures")}
                </span>
                <code title={settings?.signatureDbPath}>{settings?.signatureDbPath ?? "—"}</code>
              </div>
            </div>

            <button type="button" className="button button--ghost button--full" onClick={openDataDir}>
              <FolderOpen size={15} />
              {L("Ouvrir le dossier de données", "Open data folder")}
            </button>
          </section>

          <section className="panel panel--muted">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("À propos", "About")}</span>
                <h2>{info?.product ?? "CBS Shield"}</h2>
              </div>
              <Badge tone="info">v{info?.version ?? "0.1.0"}</Badge>
            </div>
            <p className="about__text">
              {info?.phase ?? L("Phase 1 — scanner manuel", "Phase 1 — manual scanner")}
              {L(" par ", " by ")}
              {info?.vendor ?? "Cybrense"}.
              {L(
                " Licence Apache-2.0 pour le code CBS Shield.",
                " Apache-2.0 license for the CBS Shield code.",
              )}
            </p>
            <ul className="about__list">
              <li>
                {L(
                  "Moteur antivirus : ClamAV (GPL-2.0, installé séparément, non redistribué).",
                  "Antivirus engine: ClamAV (GPL-2.0, installed separately, not redistributed).",
                )}
              </li>
              <li>
                {L(
                  "Interface : Tauri 2, React, TypeScript.",
                  "UI: Tauri 2, React, TypeScript.",
                )}
              </li>
              <li>
                {L(
                  "Stockage : SQLite local (domaine public).",
                  "Storage: local SQLite (public domain).",
                )}
              </li>
              <li>
                {L(
                  "YARA-X : prévu, inactif dans cette phase.",
                  "YARA-X: planned, inactive in this phase.",
                )}
              </li>
            </ul>
            <p className="about__disclaimer">
              {info?.disclaimer ??
                L(
                  "CBS Shield ne fournit pas de protection en temps réel et ne remplace pas Microsoft Defender.",
                  "CBS Shield does not provide real-time protection and does not replace Microsoft Defender.",
                )}
            </p>
            <p className="muted">
              {L(
                "Détails des licences : LICENSES.md dans le dépôt.",
                "License details: LICENSES.md in the repository.",
              )}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
