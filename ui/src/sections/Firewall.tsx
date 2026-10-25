import { Ban, Flame, ShieldOff } from "lucide-react";

import { Badge } from "../components/Badge";
import { UnavailablePanel } from "../components/UnavailablePanel";

export function Firewall() {
  return (
    <div className="section-stack">
      <div className="banner banner--neutral">
        <Ban size={19} aria-hidden="true" />
        <div>
          <strong>Ce module n'est pas implémenté en Phase 1</strong>
          <span>
            Aucune règle du Pare-feu Microsoft Defender n'est lue, ajoutée ou modifiée.
            Cette section décrit uniquement le périmètre prévu.
          </span>
        </div>
      </div>

      <UnavailablePanel
        title="Pare-feu applicatif"
        icon={Flame}
        description="La gestion d'un pare-feu applicatif nécessite une conception dédiée (WFP ou règles Windows Filtering Platform), des privilèges adaptés et une stratégie de réversibilité. Elle sera traitée dans une phase ultérieure, jamais silencieusement."
        features={[
          "Visualisation des règles Windows Firewall existantes",
          "Règles entrantes/sortantes par application",
          "Journalisation des changements avec confirmation explicite",
          "Mode observation avant toute application de règle",
        ]}
        footer={
          <div className="unavailable__footer-line">
            <ShieldOff size={16} aria-hidden="true" />
            <span>
              État actuel : aucune modification système. Microsoft Defender Firewall
              conserve sa configuration d'origine.
            </span>
            <Badge tone="neutral">Phase 2</Badge>
          </div>
        }
      />

      <section className="panel">
        <div className="panel__head">
          <div>
            <span className="panel__eyebrow">Garde-fous</span>
            <h2>Ce que CBS Shield ne fait pas</h2>
          </div>
        </div>
        <ul className="rule-list">
          <li>Aucune désactivation de Microsoft Defender.</li>
          <li>Aucune règle de pare-feu ajoutée ou supprimée.</li>
          <li>Aucun pilote noyau installé.</li>
          <li>Aucune élévation de privilèges demandée pour cette interface.</li>
        </ul>
      </section>
    </div>
  );
}
