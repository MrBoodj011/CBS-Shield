import { RefreshCw, ShieldCheck } from "lucide-react";

import { signatureStateLabel, signatureStateTone } from "../lib/format";
import type { EngineStatus } from "../types";
import { Badge } from "./Badge";

interface TopBarProps {
  title: string;
  subtitle: string;
  engine: EngineStatus | null;
  engineLoading: boolean;
  onRefresh: () => void;
}

export function TopBar({
  title,
  subtitle,
  engine,
  engineLoading,
  onRefresh,
}: TopBarProps) {
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
                  : "ClamAV non détecté"}
              </strong>
              <span>
                {engine.installed
                  ? `Signatures ${engine.signatureVersion ?? "absentes"}`
                  : "Moteur requis"}
              </span>
            </div>
            <Badge tone={signatureStateTone(engine.signatureState)} dot>
              {signatureStateLabel(engine.signatureState)}
            </Badge>
          </div>
        ) : (
          <div className="engine-pill engine-pill--loading">
            <RefreshCw
              size={16}
              className={engineLoading ? "spin" : undefined}
              aria-hidden="true"
            />
            <span>Diagnostic du moteur…</span>
          </div>
        )}

        <button
          type="button"
          className="button button--ghost button--icon"
          onClick={onRefresh}
          disabled={engineLoading}
          title="Relancer le diagnostic ClamAV et rafraîchir les données"
          aria-label="Rafraîchir"
        >
          <RefreshCw size={18} className={engineLoading ? "spin" : undefined} />
        </button>
      </div>
    </header>
  );
}
