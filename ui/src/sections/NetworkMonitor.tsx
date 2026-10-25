import { Activity, Ban, WifiOff } from "lucide-react";

import { Badge } from "../components/Badge";
import { UnavailablePanel } from "../components/UnavailablePanel";

export function NetworkMonitor() {
  return (
    <div className="section-stack">
      <div className="banner banner--neutral">
        <Ban size={19} aria-hidden="true" />
        <div>
          <strong>Aucune capture réseau n'est active</strong>
          <span>
            CBS Shield n'installe pas de filtre réseau et ne collecte aucune connexion
            dans cette phase. Les données affichées ailleurs dans l'application
            proviennent uniquement de ClamAV et de la base locale.
          </span>
        </div>
      </div>

      <UnavailablePanel
        title="Moniteur réseau"
        icon={Activity}
        description="Un moniteur de connexions doit indiquer clairement quelles données sont collectées, où elles restent stockées et comment les purger. Cette fonctionnalité est planifiée mais volontairement absente de la Phase 1."
        features={[
          "Connexions TCP/UDP actives et processus associés",
          "Résolution DNS et pays de destination (si disponible)",
          "Filtrage et recherche locales, sans envoi de télémétrie",
          "Aucune capture de contenu, uniquement des métadonnées",
        ]}
        footer={
          <div className="unavailable__footer-line">
            <WifiOff size={16} aria-hidden="true" />
            <span>État actuel : aucune socket ouverte par ce module.</span>
            <Badge tone="neutral">Phase 2</Badge>
          </div>
        }
      />
    </div>
  );
}
