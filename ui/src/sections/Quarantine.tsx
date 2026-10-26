import {
  Archive,
  CircleAlert,
  CircleCheck,
  KeyRound,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/Badge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toasts";
import { api, errorMessage } from "../lib/api";
import { formatBytes, formatDateTime, shortHash, truncateMiddle } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { QuarantineRecord, SettingsView } from "../types";

interface QuarantineProps {
  items: QuarantineRecord[];
  settings: SettingsView | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}

type Localize = (fr: string, en: string) => string;

function statusBadge(item: QuarantineRecord, L: Localize) {
  switch (item.status) {
    case "restored":
      return <Badge tone="info" dot>{L("Restauré", "Restored")}</Badge>;
    case "deleted":
      return <Badge tone="neutral" dot>{L("Supprimé", "Deleted")}</Badge>;
    default:
      return <Badge tone="warning" dot>{L("Isolé", "Quarantined")}</Badge>;
  }
}

export function Quarantine({ items, settings, loading, onRefresh }: QuarantineProps) {
  const toast = useToast();
  const { language } = useI18n();
  const L: Localize = (fr, en) => (language === "en" ? en : fr);
  const [pendingRestore, setPendingRestore] = useState<QuarantineRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState<QuarantineRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const activeCount = items.filter((item) => item.status === "active").length;

  const restore = async () => {
    if (!pendingRestore) return;
    setBusy(true);
    try {
      const destination = await api.restoreQuarantine(pendingRestore.id, true);
      toast({
        tone: "success",
        title: L("Fichier restauré", "File restored"),
        message: L(`Restauré vers ${destination}`, `Restored to ${destination}`),
      });
      setPendingRestore(null);
      await onRefresh();
    } catch (error) {
      toast({
        tone: "error",
        title: L("Restauration impossible", "Restore failed"),
        message: errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await api.deleteQuarantine(
      pendingDelete.id,
      true,
      L("SUPPRIMER", "DELETE"),
    );
      toast({
        tone: "success",
        title: L("Élément supprimé définitivement", "Item permanently deleted"),
        message: L(
          `${pendingDelete.fileName} a été retiré du coffre.`,
          `${pendingDelete.fileName} was removed from the vault.`,
        ),
      });
      setPendingDelete(null);
      await onRefresh();
    } catch (error) {
      toast({
        tone: "error",
        title: L("Suppression impossible", "Deletion failed"),
        message: errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section-stack">
      <div className="banner banner--info">
        <KeyRound size={19} aria-hidden="true" />
        <div>
          <strong>{L("Coffre chiffré, aucune suppression automatique", "Encrypted vault, no automatic deletion")}</strong>
          <span>
            {L(
              "Les fichiers sont chiffrés en AES-256-GCM. La clé est protégée par Windows DPAPI pour votre compte utilisateur. Une restauration ou une suppression définitive exige toujours une confirmation explicite.",
              "Files are encrypted with AES-256-GCM. The key is protected by Windows DPAPI for your user account. Restoring or permanently deleting an item always requires explicit confirmation.",
            )}
          </span>
        </div>
      </div>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">{L("Coffre local", "Local vault")}</span>
            <h2>{L("Éléments en quarantaine", "Quarantined items")}</h2>
          </div>
          <Badge tone={activeCount > 0 ? "warning" : "ok"} dot>
            {L(
              `${activeCount} actif${activeCount > 1 ? "s" : ""}`,
              `${activeCount} active`,
            )}
          </Badge>
        </div>

        {loading ? (
          <div className="loading-row">
            <LoaderCircle size={18} className="spin" />
            {L("Chargement du coffre…", "Loading vault…")}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Archive}
            title={L("Le coffre est vide", "The vault is empty")}
            description={L(
              "Les fichiers que vous choisissez d'isoler depuis un rapport d'analyse apparaîtront ici, chiffrés au repos.",
              "Files you choose to quarantine from a scan report will appear here, encrypted at rest.",
            )}
          />
        ) : (
          <div className="table-wrap">
            <table className="table table--quarantine">
              <thead>
                <tr>
                  <th>{L("Fichier", "File")}</th>
                  <th>{L("Menace", "Threat")}</th>
                  <th>{L("Emplacement d'origine", "Original location")}</th>
                  <th className="num">{L("Taille", "Size")}</th>
                  <th>{L("Date", "Date")}</th>
                  <th>{L("Statut", "Status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.status !== "active" ? "is-muted" : ""}>
                    <td>
                      <div className="cell-main">
                        <strong>{item.fileName}</strong>
                        <span className="mono" title={item.sha256}>
                          {shortHash(item.sha256)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <Badge tone="danger">{item.threatName}</Badge>
                    </td>
                    <td title={item.originalPath}>
                      {truncateMiddle(item.originalPath, 46)}
                    </td>
                    <td className="num">{formatBytes(item.sizeBytes)}</td>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{statusBadge(item, L)}</td>
                    <td>
                      {item.status === "active" ? (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="button button--small button--ghost"
                            onClick={() => setPendingRestore(item)}
                          >
                            <RotateCcw size={14} />
                            {L("Restaurer", "Restore")}
                          </button>
                          <button
                            type="button"
                            className="button button--small button--danger-ghost"
                            onClick={() => setPendingDelete(item)}
                          >
                            <Trash2 size={14} />
                            {L("Supprimer", "Delete")}
                          </button>
                        </div>
                      ) : (
                        <span className="muted">
                          {item.restoredAt
                            ? L(
                                `Restauré le ${formatDateTime(item.restoredAt)}`,
                                `Restored on ${formatDateTime(item.restoredAt)}`,
                              )
                            : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="vault-path">
          <KeyRound size={14} />
          <span>
            {L("Coffre : ", "Vault: ")}
            <code>{settings?.quarantinePath ?? "—"}</code>
          </span>
        </div>
      </section>

      <ConfirmDialog
        open={pendingRestore !== null}
        title={L("Restaurer ce fichier ?", "Restore this file?")}
        eyebrow={L("Action sensible", "Sensitive action")}
        tone="warning"
        description={
          <div className="confirm__stack">
            <div className="callout callout--danger">
              <strong>
                {L(
                  "Ce fichier a été identifié comme potentiellement dangereux",
                  "This file was identified as potentially dangerous",
                )}
              </strong>
              <span>
                {L(
                  "La restauration le replace à son emplacement d'origine. Ne l'ouvrez pas et ne l'exécutez pas sans avoir vérifié sa provenance. CBS Shield ne le lancera jamais à votre place.",
                  "Restoring puts it back at its original location. Do not open or run it without verifying its origin. CBS Shield will never launch it for you.",
                )}
              </span>
            </div>
            {pendingRestore && (
              <dl className="detail-list detail-list--compact">
                <div>
                  <dt>{L("Fichier", "File")}</dt>
                  <dd>{pendingRestore.fileName}</dd>
                </div>
                <div>
                  <dt>{L("Détection", "Detection")}</dt>
                  <dd>{pendingRestore.threatName}</dd>
                </div>
                <div>
                  <dt>{L("Destination", "Destination")}</dt>
                  <dd className="mono">{pendingRestore.originalPath}</dd>
                </div>
              </dl>
            )}
          </div>
        }
        requireCheckbox={L(
          "Je comprends que ce fichier est potentiellement malveillant et je choisis de le restaurer.",
          "I understand this file is potentially malicious and I choose to restore it.",
        )}
        confirmLabel={L("Restaurer le fichier", "Restore file")}
        busy={busy}
        onConfirm={restore}
        onClose={() => setPendingRestore(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={L("Supprimer définitivement cet élément ?", "Permanently delete this item?")}
        eyebrow={L("Suppression irréversible", "Irreversible deletion")}
        tone="danger"
        description={
          <div className="confirm__stack">
            <div className="callout callout--danger">
              <strong>
                {L(
                  "Le blob chiffré sera effacé du disque",
                  "The encrypted blob will be erased from disk",
                )}
              </strong>
              <span>
                {L(
                  "Cette action supprime la copie de quarantaine. Elle n'affecte pas le fichier d'origine (déjà déplacé) et ne peut pas être annulée. L'entrée d'audit restera visible avec le statut « supprimé ».",
                  "This action deletes the quarantine copy. It does not affect the original file (already moved) and cannot be undone. The audit entry will remain visible with the “deleted” status.",
                )}
              </span>
            </div>
            {pendingDelete && (
              <dl className="detail-list detail-list--compact">
                <div>
                  <dt>{L("Fichier", "File")}</dt>
                  <dd>{pendingDelete.fileName}</dd>
                </div>
                <div>
                  <dt>{L("Menace", "Threat")}</dt>
                  <dd>{pendingDelete.threatName}</dd>
                </div>
              </dl>
            )}
          </div>
        }
        requireCheckbox={L(
          "Je comprends que cette suppression est définitive.",
          "I understand this deletion is permanent.",
        )}
        requirePhrase={L("SUPPRIMER", "DELETE")}
        phraseLabel={L("Saisissez SUPPRIMER pour confirmer", "Type DELETE to confirm")}
        confirmLabel={L("Supprimer définitivement", "Delete permanently")}
        busy={busy}
        onConfirm={remove}
        onClose={() => setPendingDelete(null)}
      />

      <div className="status-notes">
        <div className="status-note">
          <CircleCheck size={17} aria-hidden="true" />
          <span>
            {L(
              "Les fichiers isolés restent lisibles uniquement par votre compte Windows.",
              "Quarantined files remain readable only by your Windows account.",
            )}
          </span>
        </div>
        <div className="status-note">
          <CircleAlert size={17} aria-hidden="true" />
          <span>
            {L(
              "Aucune analyse automatique du coffre, aucun envoi vers un service externe.",
              "No automatic vault scanning, nothing sent to an external service.",
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
