import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSearch, Search, ShieldAlert } from "lucide-react";

import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { api, errorMessage } from "../lib/api";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  outcomeTone,
  truncateMiddle,
} from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type { ScanDetails, ScanRecord, SectionId } from "../types";

type FilterId = "all" | "clean" | "detected" | "problem";

const KNOWN_OUTCOMES = new Set([
  "clean",
  "detected",
  "cancelled",
  "completedWithErrors",
  "failed",
]);

export function History({ onNavigate }: { onNavigate: (section: SectionId) => void }) {
  const { t } = useI18n();
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<ScanDetails | null>(null);
  const [detailsLoadingId, setDetailsLoadingId] = useState<number | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setScans(await api.listScans(200));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const outcomeText = (outcome: string) =>
    KNOWN_OUTCOMES.has(outcome) ? t(`outcome.${outcome}` as TranslationKey) : outcome;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scans.filter((scan) => {
      if (filter === "clean" && scan.outcome !== "clean") return false;
      if (filter === "detected" && scan.outcome !== "detected") return false;
      if (
        filter === "problem" &&
        !["completedWithErrors", "failed", "cancelled"].includes(scan.outcome)
      ) {
        return false;
      }
      if (!needle) return true;
      return scan.targets.some((target) => target.toLowerCase().includes(needle));
    });
  }, [filter, query, scans]);

  const openDetails = async (scanId: number) => {
    setDetailsLoadingId(scanId);
    setDetailsError(null);
    try {
      const report = await api.getScanDetails(scanId);
      if (report) {
        setDetails(report);
      } else {
        setDetailsError(t("history.details.loadError"));
      }
    } catch (failure) {
      setDetailsError(errorMessage(failure));
    } finally {
      setDetailsLoadingId(null);
    }
  };

  const filterLabel = (id: FilterId): string =>
    t(
      id === "all"
        ? "history.filter.all"
        : id === "clean"
          ? "history.filter.clean"
          : id === "detected"
            ? "history.filter.detected"
            : "history.filter.problem",
    );

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="filter-bar">
          <div className="filter-bar__group">
            <div className="segmented" role="group" aria-label={t("history.table.outcome")}>
              {(["all", "clean", "detected", "problem"] as FilterId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={filter === id ? "is-active" : ""}
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {filterLabel(id)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-bar__group">
            <label className="input" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Search size={14} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("history.search")}
                aria-label={t("history.search")}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "inherit",
                  font: "inherit",
                  outline: "none",
                  width: "100%",
                }}
              />
            </label>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {t("history.count", { count: filtered.length, total: scans.length })}
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        {loading ? (
          <div className="stack-gap" aria-busy="true">
            {[0, 1, 2, 3, 4].map((row) => (
              <span key={row} className="skeleton" style={{ height: 34 }} />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={ShieldAlert}
            title={t("common.error")}
            description={error}
            action={
              <button type="button" className="button button--ghost" onClick={() => void load()}>
                {t("common.retry")}
              </button>
            }
          />
        ) : scans.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title={t("history.empty.title")}
            description={t("history.empty.description")}
            action={
              <button
                type="button"
                className="button button--primary"
                onClick={() => onNavigate("antivirus")}
              >
                {t("history.empty.action")}
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <p className="panel__note">{t("common.none")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("history.table.date")}</th>
                  <th>{t("history.table.target")}</th>
                  <th className="num">{t("history.table.files")}</th>
                  <th className="num">{t("history.table.threats")}</th>
                  <th>{t("history.table.duration")}</th>
                  <th>{t("history.table.outcome")}</th>
                  <th aria-label={t("common.details")} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((scan) => (
                  <tr key={scan.id} className="is-clickable" onClick={() => void openDetails(scan.id)}>
                    <td>{formatDateTime(scan.startedAt)}</td>
                    <td title={scan.targets.join("\n")}>
                      {scan.targets.length > 1
                        ? `${truncateMiddle(scan.targets[0], 46)} +${scan.targets.length - 1}`
                        : truncateMiddle(scan.targets[0] ?? "—", 56)}
                    </td>
                    <td className="num">{formatNumber(scan.filesScanned)}</td>
                    <td className="num">{formatNumber(scan.infectedFiles)}</td>
                    <td>{formatDuration(scan.durationMs)}</td>
                    <td>
                      <Badge tone={outcomeTone(scan.outcome)} dot>
                        {outcomeText(scan.outcome)}
                      </Badge>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={(event) => {
                          event.stopPropagation();
                          void openDetails(scan.id);
                        }}
                        disabled={detailsLoadingId === scan.id}
                      >
                        {t("common.details")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={details !== null}
        onClose={() => setDetails(null)}
        title={t("history.details.title")}
        eyebrow={details ? formatDateTime(details.scan.startedAt) : undefined}
        wide
        footer={
          <button type="button" className="button button--ghost" onClick={() => setDetails(null)}>
            {t("history.details.close")}
          </button>
        }
      >
        {details ? (
          <div className="section-stack">
            <div className="info-grid">
              <div className="info-cell">
                <span className="info-cell__label">{t("history.details.outcome")}</span>
                <span className="info-cell__value">
                  <Badge tone={outcomeTone(details.scan.outcome)} dot>
                    {outcomeText(details.scan.outcome)}
                  </Badge>
                </span>
              </div>
              <div className="info-cell">
                <span className="info-cell__label">{t("history.details.started")}</span>
                <span className="info-cell__value">{formatDateTime(details.scan.startedAt)}</span>
              </div>
              <div className="info-cell">
                <span className="info-cell__label">{t("history.details.finished")}</span>
                <span className="info-cell__value">{formatDateTime(details.scan.finishedAt)}</span>
              </div>
              <div className="info-cell">
                <span className="info-cell__label">{t("history.details.duration")}</span>
                <span className="info-cell__value">{formatDuration(details.scan.durationMs)}</span>
              </div>
              <div className="info-cell">
                <span className="info-cell__label">{t("history.details.engine")}</span>
                <span className="info-cell__value">{details.scan.engineVersion ?? t("common.unknown")}</span>
              </div>
              <div className="info-cell">
                <span className="info-cell__label">{t("history.details.signatures")}</span>
                <span className="info-cell__value">
                  {details.scan.signatureVersion ?? t("common.unknown")}
                </span>
              </div>
              <div className="info-cell">
                <span className="info-cell__label">{t("history.details.files")}</span>
                <span className="info-cell__value">{formatNumber(details.scan.filesScanned)}</span>
              </div>
              <div className="info-cell">
                <span className="info-cell__label">{t("history.details.errors")}</span>
                <span className="info-cell__value">{formatNumber(details.scan.errorCount)}</span>
              </div>
            </div>

            <div>
              <span className="field__label">{t("history.details.targets")}</span>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                {details.scan.targets.map((target) => (
                  <div key={target} style={{ overflowWrap: "anywhere" }}>
                    {target}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="field__label">
                {t("history.details.detections")} · {details.detections.length}
              </span>
              {details.detections.length === 0 ? (
                <p className="panel__note">{t("history.details.none")}</p>
              ) : (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t("history.table.threats")}</th>
                        <th>{t("history.table.target")}</th>
                        <th>SHA-256</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.detections.map((detection) => (
                        <tr key={detection.id}>
                          <td>
                            <Badge tone="danger" dot>
                              {detection.threatName}
                            </Badge>
                          </td>
                          <td title={detection.filePath} style={{ overflowWrap: "anywhere" }}>
                            {detection.filePath}
                          </td>
                          <td className="mono" style={{ fontSize: 10.5 }}>
                            {detection.sha256 ? truncateMiddle(detection.sha256, 20) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {details.scan.fatalError ? (
              <div className="banner banner--danger">
                <div>
                  <strong>{t("history.details.fatal")}</strong>
                  <span>{details.scan.fatalError}</span>
                </div>
              </div>
            ) : null}

            {detailsError ? <p className="panel__note">{detailsError}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
