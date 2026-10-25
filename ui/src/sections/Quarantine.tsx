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
import type { QuarantineRecord, SettingsView } from "../types";

interface QuarantineProps {
  items: QuarantineRecord[];
  settings: SettingsView | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}

function statusBadge(item: QuarantineRecord) {
  switch (item.status) {
    case "restored":
      return <Badge tone="info" dot>Restauré</Badge>;
    case "deleted":
      return <Badge tone="neutral" dot>Supprimé</Badge>;
    default:
      return <Badge tone="warning" dot>Isolé</Badge>;
  }
}

export function Quarantine({ items, settings, loading, onRefresh }: QuarantineProps) {
  const toast = useToast();
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
        title: "Fichier restauré",
        message: `Restauré vers ${destination}`,
      });
      setPendingRestore(null);
      await onRefresh();
    } catch (error) {
      toast({
        tone: "error",
        title: "Restauration impossible",
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
      await api.deleteQuarantine(pendingDelete.id, true, "SUPPRIMER");
      toast({
        tone: "success",
        title: "Élément supprimé définitivement",
        message: `${pendingDelete.fileName} a été retiré du coffre.`,
      });
      setPendingDelete(null);
      await onRefresh();
    } catch (error) {
      toast({
        tone: "error",
        title: "Suppression impossible",
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
          <strong>Coffre chiffré, aucune suppression automatique</strong>
          <span>
            Les fichiers sont chiffrés en AES-256-GCM. La clé est protégée par Windows
            DPAPI pour votre compte utilisateur. Une restauration ou une suppression
            définitive exige toujours une confirmation explicite.
          </span>
        </div>
      </div>

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">Coffre local</span>
            <h2>Éléments en quarantaine</h2>
          </div>
          <Badge tone={activeCount > 0 ? "warning" : "ok"} dot>
            {activeCount} actif{activeCount > 1 ? "s" : ""}
          </Badge>
        </div>

        {loading ? (
          <div className="loading-row">
            <LoaderCircle size={18} className="spin" />
            Chargement du coffre…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="Le coffre est vide"
            description="Les fichiers que vous choisissez d'isoler depuis un rapport d'analyse apparaîtront ici, chiffrés au repos."
          />
        ) : (
          <div className="table-wrap">
            <table className="table table--quarantine">
              <thead>
                <tr>
                  <th>Fichier</th>
                  <th>Menace</th>
                  <th>Emplacement d'origine</th>
                  <th className="num">Taille</th>
                  <th>Date</th>
                  <th>Statut</th>
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
                    <td>{statusBadge(item)}</td>
                    <td>
                      {item.status === "active" ? (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="button button--small button--ghost"
                            onClick={() => setPendingRestore(item)}
                          >
                            <RotateCcw size={14} />
                            Restaurer
                          </button>
                          <button
                            type="button"
                            className="button button--small button--danger-ghost"
                            onClick={() => setPendingDelete(item)}
                          >
                            <Trash2 size={14} />
                            Supprimer
                          </button>
                        </div>
                      ) : (
                        <span className="muted">
                          {item.restoredAt
                            ? `Restauré le ${formatDateTime(item.restoredAt)}`
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
            Coffre : <code>{settings?.quarantinePath ?? "—"}</code>
          </span>
        </div>
      </section>

      <ConfirmDialog
        open={pendingRestore !== null}
        title="Restaurer ce fichier ?"
        eyebrow="Action sensible"
        tone="warning"
        description={
          <div className="confirm__stack">
            <div className="callout callout--danger">
              <strong>Ce fichier a été identifié comme potentiellement dangereux</strong>
              <span>
                La restauration le replace à son emplacement d'origine. Ne l'ouvrez pas et
                ne l'exécutez pas sans avoir vérifié sa provenance. CBS Shield ne le
                lancera jamais à votre place.
              </span>
            </div>
            {pendingRestore && (
              <dl className="detail-list detail-list--compact">
                <div>
                  <dt>Fichier</dt>
                  <dd>{pendingRestore.fileName}</dd>
                </div>
                <div>
                  <dt>Détection</dt>
                  <dd>{pendingRestore.threatName}</dd>
                </div>
                <div>
                  <dt>Destination</dt>
                  <dd className="mono">{pendingRestore.originalPath}</dd>
                </div>
              </dl>
            )}
          </div>
        }
        requireCheckbox="Je comprends que ce fichier est potentiellement malveillant et je choisis de le restaurer."
        confirmLabel="Restaurer le fichier"
        busy={busy}
        onConfirm={restore}
        onClose={() => setPendingRestore(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Supprimer définitivement cet élément ?"
        eyebrow="Suppression irréversible"
        tone="danger"
        description={
          <div className="confirm__stack">
            <div className="callout callout--danger">
              <strong>Le blob chiffré sera effacé du disque</strong>
              <span>
                Cette action supprime la copie de quarantaine. Elle n'affecte pas le
                fichier d'origine (déjà déplacé) et ne peut pas être annulée. L'entrée
                d'audit restera visible avec le statut « supprimé ».
              </span>
            </div>
            {pendingDelete && (
              <dl className="detail-list detail-list--compact">
                <div>
                  <dt>Fichier</dt>
                  <dd>{pendingDelete.fileName}</dd>
                </div>
                <div>
                  <dt>Menace</dt>
                  <dd>{pendingDelete.threatName}</dd>
                </div>
              </dl>
            )}
          </div>
        }
        requireCheckbox="Je comprends que cette suppression est définitive."
        requirePhrase="SUPPRIMER"
        phraseLabel="Saisissez SUPPRIMER pour confirmer"
        confirmLabel="Supprimer définitivement"
        busy={busy}
        onConfirm={remove}
        onClose={() => setPendingDelete(null)}
      />

      <div className="status-notes">
        <div className="status-note">
          <CircleCheck size={17} aria-hidden="true" />
          <span>Les fichiers isolés restent lisibles uniquement par votre compte Windows.</span>
        </div>
        <div className="status-note">
          <CircleAlert size={17} aria-hidden="true" />
          <span>Aucune analyse automatique du coffre, aucun envoi vers un service externe.</span>
        </div>
      </div>
    </div>
  );
}
