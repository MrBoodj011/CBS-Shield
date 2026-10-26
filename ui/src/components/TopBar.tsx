import { RefreshCw, ShieldCheck } from "lucide-react";

import { signatureStateTone } from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type { EngineStatus } from "../types";
import { Badge } from "./Badge";

interface TopBarProps {
  title: string;
  subtitle: string;
  engine: EngineStatus | null;
  engineLoading: boolean;
  onRefresh: () => void;
}

export function TopBar({ title, subtitle, engine, engineLoading, onRefresh }: TopBarProps) {
  const { t } = useI18n();
  const signatureLabel = (state: EngineStatus["signatureState"]) =>
    t(("signature." + state) as TranslationKey);

  return (
    <header className="topbar">
      <div className="topbar__titles">
        <span className="topbar__breadcrumb">CBS Shield / {title}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="topbar__actions">
        {engine ? (
          <div className="engine-pill" title={engine.message}>
            <ShieldCheck size={17} aria-hidden="true" />
            <div className="engine-pill__text">
              <strong>
                {engine.installed
                  ? `ClamAV ${engine.engineVersion ?? ""}`.trim()
                  : t("engine.missing")}
              </strong>
              <span>
                {engine.installed
                  ? `${t("updates.signaturesTitle")} ${engine.signatureVersion ?? t("signature.missing")}`
                  : t("updates.engineMissing")}
              </span>
            </div>
            <Badge tone={signatureStateTone(engine.signatureState)} dot>
              {signatureLabel(engine.signatureState)}
            </Badge>
          </div>
        ) : (
          <div className="engine-pill engine-pill--loading">
            <RefreshCw
              size={16}
              className={engineLoading ? "spin" : undefined}
              aria-hidden="true"
            />
            <span>{t("engine.checking")}</span>
          </div>
        )}

        <button
          type="button"
          className="button button--ghost button--icon"
          onClick={onRefresh}
          disabled={engineLoading}
          title={t("topbar.refresh")}
          aria-label={t("topbar.refresh")}
        >
          <RefreshCw size={18} className={engineLoading ? "spin" : undefined} />
        </button>
      </div>
    </header>
  );
}
