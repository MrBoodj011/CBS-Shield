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
  const { t } = useI18n();
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
      toast({ tone: "success", title: "Paramètres enregistrés" });
    } catch (error) {
      setFormError(errorMessage(error));
      toast({
        tone: "error",
        title: "Paramètres non enregistrés",
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
        title: status.installed ? "Diagnostic terminé" : "ClamAV introuvable",
        message: status.message,
      });
    } catch (error) {
      toast({ tone: "error", title: "Diagnostic impossible", message: errorMessage(error) });
    } finally {
      setChecking(false);
    }
  };

  const openDataDir = async () => {
    try {
      await api.openDataDir();
    } catch (error) {
      toast({ tone: "error", title: "Ouverture impossible", message: errorMessage(error) });
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
          <strong>Réglages locaux</strong>
          <span>
            Tous les paramètres sont enregistrés dans SQLite sur ce poste. Aucun compte,
            aucun serveur, aucune télémétrie.
          </span>
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-main">
          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">Apparence</span>
                <h2>Thème de l'interface</h2>
              </div>
            </div>
            <div className="segmented" role="group" aria-label="Thème">
              {[
                { value: "dark", label: "Sombre" },
                { value: "light", label: "Clair" },
                { value: "system", label: "Système" },
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
                  <span className="panel__eyebrow">Localisation</span>
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
                <span className="panel__eyebrow">Analyse</span>
                <h2>Valeurs par défaut</h2>
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
                  <strong>Analyse récursive</strong>
                  <small>Par défaut, inclure les sous-dossiers.</small>
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
                  <strong>Détecter les PUA</strong>
                  <small>Logiciels potentiellement indésirables.</small>
                </span>
              </label>
              <label className="field">
                <span className="field__label">Seuil de fraîcheur des signatures (jours)</span>
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
                  Au-delà de ce seuil, l'interface signale des signatures anciennes sans
                  bloquer les scans.
                </span>
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">Moteur externe</span>
                <h2>ClamAV</h2>
              </div>
              <Badge tone={signatureStateTone(engine?.signatureState ?? "unknown")} dot>
                {signatureStateLabel(engine?.signatureState ?? "unknown")}
              </Badge>
            </div>

            <div className="form-grid">
              <label className="field">
                <span className="field__label">Chemin de clamscan.exe (optionnel)</span>
                <input
                  className="input mono"
                  value={form.clamscanPath}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, clamscanPath: event.target.value }))
                  }
                  placeholder="Détection automatique (PATH / Program Files)"
                  spellCheck={false}
                />
                <span className="field__hint">
                  Doit pointer vers un fichier nommé <code>clamscan.exe</code>. Laissez vide
                  pour la détection automatique.
                </span>
              </label>

              <label className="field">
                <span className="field__label">Dossier de signatures (optionnel)</span>
                <input
                  className="input mono"
                  value={form.databasePath}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, databasePath: event.target.value }))
                  }
                  placeholder="Détection automatique"
                  spellCheck={false}
                />
                <span className="field__hint">
                  Dossier contenant <code>.cvd</code> / <code>.cld</code>, par exemple la
                  base utilisateur maintenue par CBS Shield.
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
                Effacer les chemins personnalisés
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={recheck}
                disabled={checking || engineLoading}
              >
                {checking ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                Revérifier la détection
              </button>
            </div>

            <dl className="detail-list detail-list--compact">
              <div>
                <dt>clamscan détecté</dt>
                <dd className="mono" title={engine?.clamscanPath ?? undefined}>
                  {engine?.clamscanPath
                    ? truncateMiddle(engine.clamscanPath, 60)
                    : "Non détecté"}
                </dd>
              </div>
              <div>
                <dt>Base utilisée</dt>
                <dd className="mono" title={engine?.databasePath ?? undefined}>
                  {engine?.databasePath
                    ? truncateMiddle(engine.databasePath, 60)
                    : "Introuvable"}
                </dd>
              </div>
              <div>
                <dt>freshclam</dt>
                <dd className="mono" title={engine?.freshclamPath ?? undefined}>
                  {engine?.freshclamPath
                    ? truncateMiddle(engine.freshclamPath, 60)
                    : "Introuvable"}
                </dd>
              </div>
            </dl>
          </section>

          {formError && (
            <div className="banner banner--danger">
              <CircleAlert size={19} aria-hidden="true" />
              <div>
                <strong>Validation refusée</strong>
                <span>{formError}</span>
              </div>
            </div>
          )}

          <div className="save-bar">
            <span className={dirty ? "save-bar__dirty" : "muted"}>
              {dirty ? "Modifications non enregistrées" : "Tous les réglages sont enregistrés"}
            </span>
            <button
              type="button"
              className="button button--primary"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
              Enregistrer
            </button>
          </div>
        </div>

        <aside className="settings-aside">
          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">Diagnostic</span>
                <h2>État du moteur</h2>
              </div>
              {engine?.installed ? (
                <CircleCheck size={19} className="text-ok" />
              ) : (
                <TriangleAlert size={19} className="text-warning" />
              )}
            </div>

            <p className={`engine-message engine-message--${signatureStateTone(engine?.signatureState ?? "unknown")}`}>
              {engine?.message ?? "Diagnostic du moteur en cours…"}
            </p>

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
                <dt>Date</dt>
                <dd>{engine?.signatureDate ?? "—"}</dd>
              </div>
              <div>
                <dt>Fichiers</dt>
                <dd>{formatNumber(engine?.databaseFileCount ?? 0)}</dd>
              </div>
              <div>
                <dt>Vérifié</dt>
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
              Relancer le diagnostic
            </button>
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">Données</span>
                <h2>Emplacements locaux</h2>
              </div>
            </div>

            <div className="path-list">
              <div>
                <span>
                  <Database size={14} /> Données
                </span>
                <code title={settings?.dataDir}>{settings?.dataDir ?? "—"}</code>
              </div>
              <div>
                <span>
                  <Database size={14} /> Historique SQLite
                </span>
                <code title={settings?.historyPath}>{settings?.historyPath ?? "—"}</code>
              </div>
              <div>
                <span>
                  <KeyRound size={14} /> Quarantaine
                </span>
                <code title={settings?.quarantinePath}>{settings?.quarantinePath ?? "—"}</code>
              </div>
              <div>
                <span>
                  <ShieldCheck size={14} /> Signatures
                </span>
                <code title={settings?.signatureDbPath}>{settings?.signatureDbPath ?? "—"}</code>
              </div>
            </div>

            <button type="button" className="button button--ghost button--full" onClick={openDataDir}>
              <FolderOpen size={15} />
              Ouvrir le dossier de données
            </button>
          </section>

          <section className="panel panel--muted">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">À propos</span>
                <h2>{info?.product ?? "CBS Shield"}</h2>
              </div>
              <Badge tone="info">v{info?.version ?? "0.1.0"}</Badge>
            </div>
            <p className="about__text">
              {info?.phase ?? "Phase 1 — scanner manuel"} par {info?.vendor ?? "Cybrense"}.
              Licence Apache-2.0 pour le code CBS Shield.
            </p>
            <ul className="about__list">
              <li>Moteur antivirus : ClamAV (GPL-2.0, installé séparément, non redistribué).</li>
              <li>Interface : Tauri 2, React, TypeScript.</li>
              <li>Stockage : SQLite local (domaine public).</li>
              <li>YARA-X : prévu, inactif dans cette phase.</li>
            </ul>
            <p className="about__disclaimer">
              {info?.disclaimer ??
                "CBS Shield ne fournit pas de protection en temps réel et ne remplace pas Microsoft Defender."}
            </p>
            <p className="muted">Détails des licences : LICENSES.md dans le dépôt.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
