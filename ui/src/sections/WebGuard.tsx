import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  Archive,
  ArrowRight,
  Ban,
  CheckCircle2,
  CircleAlert,
  Database,
  Download,
  FileSearch,
  Filter,
  Globe2,
  History,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Stethoscope,
  Trash2,
  TriangleAlert,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "../components/Badge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toasts";
import { api, errorMessage } from "../lib/api";
import { formatDateTime, formatNumber, truncateMiddle } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type {
  WebGuardDomainTest,
  WebGuardImportResult,
  WebGuardView,
} from "../types";

type Localize = (fr: string, en: string) => string;
type TabId =
  | "overview"
  | "dns"
  | "blocklist"
  | "allowlist"
  | "activity"
  | "filters"
  | "diagnostics"
  | "safety";

const TABS: { id: TabId; fr: string; en: string; icon: typeof Globe2 }[] = [
  { id: "overview", fr: "Vue d'ensemble", en: "Overview", icon: Globe2 },
  { id: "dns", fr: "Filtrage DNS", en: "DNS filtering", icon: Network },
  { id: "blocklist", fr: "Blocage", en: "Blocklist", icon: Ban },
  { id: "allowlist", fr: "Autorisations", en: "Allowlist", icon: CheckCircle2 },
  { id: "activity", fr: "Activité locale", en: "Local activity", icon: History },
  { id: "filters", fr: "Listes", en: "Filters", icon: Layers3 },
  { id: "diagnostics", fr: "Diagnostic DNS", en: "DNS diagnostics", icon: Stethoscope },
  { id: "safety", fr: "Limites & sécurité", en: "Limits & safety", icon: ShieldAlert },
];

const CATEGORY_TONE = {
  malware: "danger",
  phishing: "warning",
} as const;

const EVENT_TONE = {
  blocked: "danger",
  allowed: "ok",
  error: "warning",
} as const;

function categoryLabel(value: string | null | undefined, L: Localize): string {
  if (value === "malware") return L("Malware", "Malware");
  if (value === "phishing") return L("Hameçonnage", "Phishing");
  return L("Non classé", "Unclassified");
}

/// Backend events deliberately keep a diagnostic detail string. Render the
/// stable outcome in the active language instead of exposing a French-only
/// implementation detail in the English UI.
function eventDetailText(event: WebGuardView["events"][number], L: Localize): string {
  if (event.action === "blocked") {
    return L(
      "Réponse NXDOMAIN locale ; aucune requête envoyée au résolveur système.",
      "Local NXDOMAIN response; no request sent to the system resolver.",
    );
  }
  if (event.action === "allowed") {
    return L(
      "Réponse relayée depuis le résolveur système.",
      "Relayed from the system resolver.",
    );
  }
  const rcode = event.detail.match(/RCODE\s+(\d+)/i);
  if (rcode) {
    return L(
      `Le résolveur a répondu RCODE ${rcode[1]}.`,
      `The resolver returned RCODE ${rcode[1]}.`,
    );
  }
  if (/indisponible|unavailable/i.test(event.detail)) {
    return L("Résolveur système indisponible.", "System resolver unavailable.");
  }
  return L("Erreur du résolveur local.", "Local resolver error.");
}

function domainTestDetailText(result: WebGuardDomainTest, L: Localize): string {
  switch (result.queryOutcome) {
    case "notRunning":
      return L(
        "Le prototype loopback est arrêté : seul le classificateur local a été évalué. Aucune requête réseau n'a été envoyée.",
        "The loopback prototype is stopped: only the local classifier was evaluated. No network request was sent.",
      );
    case "blocked":
      return L(
        "Requête réelle envoyée au prototype loopback : réponse NXDOMAIN locale, sans transmission à Internet.",
        "Real request sent to the loopback prototype: local NXDOMAIN response, nothing sent to the Internet.",
      );
    case "allowed":
      return L(
        "Requête réelle relayée au résolveur système configuré ; réponse DNS reçue.",
        "Real request relayed to the configured system resolver; DNS response received.",
      );
    case "upstreamFailure":
      return L(
        `Le résolveur système n'a pas fourni de réponse exploitable (RCODE ${result.rcode ?? "?"}).`,
        `The system resolver did not return a usable answer (RCODE ${result.rcode ?? "?"}).`,
      );
    default:
      return L(
        "Le prototype loopback n'a pas répondu. Vérifiez le port et l'état du prototype.",
        "The loopback prototype did not answer. Check the port and prototype state.",
      );
  }
}

function interfaceKindLabel(value: string, L: Localize): string {
  switch (value) {
    case "ethernet":
      return L("Ethernet", "Ethernet");
    case "wifi":
      return L("Wi-Fi", "Wi-Fi");
    case "virtual":
      return L("Virtuel", "Virtual");
    case "tunnel":
      return L("Tunnel", "Tunnel");
    case "ppp":
      return L("PPP", "PPP");
    case "loopback":
      return L("Loopback", "Loopback");
    default:
      return value;
  }
}

function limitationText(code: string, L: Localize): { title: string; detail: string } {
  switch (code) {
    case "loopbackOnly":
      return {
        title: L("Prototype loopback uniquement", "Loopback prototype only"),
        detail: L(
          "Le résolveur écoute sur un port loopback local (5353 par défaut, port suivant si occupé). Les applications continuent d'utiliser le DNS système tant que vous ne les configurez pas explicitement.",
          "The resolver listens on a local loopback port (5353 by default, the next free port if occupied). Applications keep using the system DNS unless you explicitly point them at it.",
        ),
      };
    case "noHttpsInterception":
      return {
        title: L("Aucune interception HTTPS", "No HTTPS interception"),
        detail: L(
          "CBS Shield ne déchiffre pas le trafic TLS, n'installe aucun certificat et ne lit pas le contenu des pages.",
          "CBS Shield does not decrypt TLS traffic, installs no certificate and does not read page content.",
        ),
      };
    case "encryptedDnsBypass":
      return {
        title: L("DNS chiffré non couvert", "Encrypted DNS not covered"),
        detail: L(
          "Un navigateur ou un VPN configuré en DoH/DoT peut contourner ce prototype. Le diagnostic signale seulement les indices observables.",
          "A browser or VPN using DoH/DoT can bypass this prototype. Diagnostics only report observable hints.",
        ),
      };
    case "vpnBypass":
      return {
        title: L("VPN et tunnels non contrôlés", "VPN and tunnels not enforced"),
        detail: L(
          "Un tunnel VPN peut recevoir ses propres résolveurs. CBS Shield ne modifie ni le VPN ni les adaptateurs.",
          "A VPN tunnel can receive its own resolvers. CBS Shield changes neither the VPN nor the adapters.",
        ),
      };
    case "notSystemWide":
      return {
        title: L("Pas de protection système globale", "No system-wide protection"),
        detail: L(
          "Aucune clé DNS Windows, aucun fichier hosts et aucune règle de pare-feu ne sont modifiés. Aucun mode appliqué globalement n'est activé.",
          "No Windows DNS key, hosts file or firewall rule is modified. No globally enforced mode is enabled.",
        ),
      };
    case "noMalwareGuarantee":
      return {
        title: L("Aucune garantie antivirus", "No antivirus guarantee"),
        detail: L(
          "Une liste de domaines ne bloque ni un fichier malveillant, ni un site compromis absent de la liste, ni une attaque par IP directe.",
          "A domain list blocks neither a malicious file, nor a compromised site missing from the list, nor a direct-IP attack.",
        ),
      };
    default:
      return { title: code, detail: "" };
  }
}

export function WebGuard() {
  const { language } = useI18n();
  const L: Localize = (fr, en) => (language === "en" ? en : fr);
  const toast = useToast();
  const [view, setView] = useState<WebGuardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overview");

  const [domain, setDomain] = useState("example.com");
  const [testResult, setTestResult] = useState<WebGuardDomainTest | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [allowDomain, setAllowDomain] = useState("");
  const [allowNote, setAllowNote] = useState("");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const [blockQuery, setBlockQuery] = useState("");
  const [eventFilter, setEventFilter] = useState<"all" | "blocked" | "allowed" | "error">(
    "all",
  );

  const [importRequest, setImportRequest] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [importCategory, setImportCategory] = useState<"malware" | "phishing">("malware");
  const [clearKind, setClearKind] = useState<"history" | "blocklist" | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const snapshot = await api.webguardSnapshot();
      setView(snapshot);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(true);
      }
    }, 7_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const setSnapshot = (snapshot: WebGuardView) => {
    setView(snapshot);
    setError(null);
  };

  const startMonitor = async () => {
    setBusy("monitor");
    try {
      const snapshot = await api.webguardStartMonitor();
      setSnapshot(snapshot);
      toast({
        tone: "success",
        title: L("Prototype DNS démarré", "DNS prototype started"),
        message: L(
          `Écoute locale sur ${snapshot.proxy.endpoint}. Aucun réglage DNS Windows n'a été modifié.`,
          `Local listener on ${snapshot.proxy.endpoint}. No Windows DNS setting was changed.`,
        ),
      });
    } catch (err) {
      toast({ tone: "error", title: L("Démarrage impossible", "Could not start"), message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const stopMonitor = async () => {
    setBusy("monitor");
    try {
      setSnapshot(await api.webguardStopMonitor());
      toast({
        tone: "info",
        title: L("Prototype DNS arrêté", "DNS prototype stopped"),
        message: L(
          "Le port loopback est libéré. Le DNS système n'a jamais été touché.",
          "The loopback port is released. System DNS was never touched.",
        ),
      });
    } catch (err) {
      toast({ tone: "error", title: L("Arrêt impossible", "Could not stop"), message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const runDomainTest = async () => {
    const candidate = domain.trim();
    if (!candidate) return;
    setBusy("test");
    setTestError(null);
    try {
      const result = await api.webguardTestDomain(candidate);
      setTestResult(result);
      await load(true);
    } catch (err) {
      setTestError(errorMessage(err));
      setTestResult(null);
    } finally {
      setBusy(null);
    }
  };

  const addAllowlist = async () => {
    if (!allowDomain.trim()) return;
    setBusy("allowlist");
    try {
      setSnapshot(await api.webguardAddAllowlist(allowDomain.trim(), allowNote.trim()));
      setAllowDomain("");
      setAllowNote("");
      toast({
        tone: "success",
        title: L("Autorisation enregistrée", "Allow entry saved"),
        message: L(
          "Cette règle est prioritaire sur la liste de blocage, y compris pour ses sous-domaines.",
          "This rule wins over the blocklist, including for its subdomains.",
        ),
      });
    } catch (err) {
      toast({ tone: "error", title: L("Ajout refusé", "Entry rejected"), message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const removeAllowlist = async () => {
    if (!removeTarget) return;
    setBusy("allowlist");
    try {
      setSnapshot(await api.webguardRemoveAllowlist(removeTarget));
      toast({
        tone: "info",
        title: L("Autorisation retirée", "Allow entry removed"),
        message: removeTarget,
      });
      setRemoveTarget(null);
    } catch (err) {
      toast({ tone: "error", title: L("Retrait impossible", "Could not remove"), message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const pickFilter = async () => {
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: L("Listes de domaines", "Domain lists"),
            extensions: ["txt", "hosts", "list", "csv"],
          },
        ],
      });
      if (typeof picked !== "string") return;
      const name = picked.split(/[\\/]/).pop() || L("liste-locale", "local-list");
      setImportRequest({ path: picked, name });
      setImportCategory("malware");
    } catch (err) {
      toast({ tone: "error", title: L("Sélection impossible", "Could not select file"), message: errorMessage(err) });
    }
  };

  const confirmImport = async () => {
    if (!importRequest) return;
    setBusy("import");
    try {
      const result: WebGuardImportResult = await api.webguardImportFilter(
        importRequest.path,
        importCategory,
        true,
      );
      await load(true);
      setImportRequest(null);
      toast({
        tone: "success",
        title: L("Liste importée", "Filter imported"),
        message: L(
          `${formatNumber(result.added)} ajouté(s), ${formatNumber(result.updated)} mis à jour, ${formatNumber(result.ignoredLines)} ligne(s) ignorée(s).`,
          `${formatNumber(result.added)} added, ${formatNumber(result.updated)} updated, ${formatNumber(result.ignoredLines)} line(s) ignored.`,
        ),
      });
    } catch (err) {
      toast({ tone: "error", title: L("Import refusé", "Import rejected"), message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const clearData = async () => {
    if (!clearKind) return;
    setBusy("clear");
    try {
      const snapshot =
        clearKind === "history"
          ? await api.webguardClearHistory(true)
          : await api.webguardClearBlocklist(true);
      setSnapshot(snapshot);
      toast({
        tone: "info",
        title:
          clearKind === "history"
            ? L("Historique effacé", "History cleared")
            : L("Liste de blocage effacée", "Blocklist cleared"),
        message: L("Cette action est locale et ne touche pas au DNS système.", "This action is local and does not touch system DNS."),
      });
      setClearKind(null);
    } catch (err) {
      toast({ tone: "error", title: L("Effacement impossible", "Could not clear"), message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const filteredBlocklist = useMemo(() => {
    if (!view) return [];
    const needle = blockQuery.trim().toLowerCase();
    if (!needle) return view.blocklist;
    return view.blocklist.filter(
      (entry) =>
        entry.domain.includes(needle) ||
        entry.source.toLowerCase().includes(needle) ||
        entry.category.includes(needle),
    );
  }, [view, blockQuery]);

  const filteredEvents = useMemo(() => {
    if (!view) return [];
    if (eventFilter === "all") return view.events;
    return view.events.filter((event) => event.action === eventFilter);
  }, [view, eventFilter]);

  if (loading && !view) {
    return (
      <div className="section-stack">
        <div className="panel webguard-loading" role="status" aria-live="polite">
          <LoaderCircle size={22} className="spin" />
          <div>
            <strong>{L("Lecture de l'état Web Guard", "Reading Web Guard state")}</strong>
            <span>
              {L(
                "Diagnostic DNS en lecture seule et chargement de l'historique local…",
                "Read-only DNS diagnostics and local history loading…",
              )}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="section-stack">
        <div className="banner banner--danger">
          <CircleAlert size={19} aria-hidden="true" />
          <div>
            <strong>{L("Web Guard indisponible", "Web Guard unavailable")}</strong>
            <span>{error ?? L("État local illisible.", "Local state could not be read.")}</span>
            <div className="banner__actions">
              <button type="button" className="button button--ghost" onClick={() => void load()}>
                <RefreshCw size={15} /> {L("Réessayer", "Retry")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { counts, health, proxy } = view;
  const canClear = view.activeEnforcement || view.systemDnsModified;

  return (
    <div className="section-stack webguard">
      {error && (
        <div className="banner banner--warning">
          <TriangleAlert size={19} aria-hidden="true" />
          <div>
            <strong>{L("Dernière actualisation incomplète", "Last refresh incomplete")}</strong>
            <span>{error}</span>
            <div className="banner__actions">
              <button type="button" className="button button--ghost" onClick={() => void load()}>
                <RefreshCw size={15} /> {L("Réessayer", "Retry")}
              </button>
            </div>
          </div>
        </div>
      )}

      {view.stateError && (
        <div className="banner banner--warning">
          <TriangleAlert size={19} aria-hidden="true" />
          <div>
            <strong>{L("État local partiellement lisible", "Local state partially readable")}</strong>
            <span>{view.stateError}</span>
          </div>
        </div>
      )}

      <section className="panel webguard-hero" aria-labelledby="webguard-status-title">
        <div className={`webguard-hero__icon${proxy.running ? " is-live" : ""}`}>
          {proxy.running ? <ShieldCheck size={30} /> : <ShieldOff size={30} />}
        </div>
        <div className="webguard-hero__body">
          <span className="panel__eyebrow">{L("Prototype DNS local", "Local DNS prototype")}</span>
          <h2 id="webguard-status-title">
            {proxy.running
              ? L("Prototype actif sur loopback", "Prototype active on loopback")
              : L("Prototype arrêté — aucun filtrage DNS actif", "Prototype stopped — no active DNS filtering")}
          </h2>
          <p>
            {L(
              "CBS Shield ne modifie pas le DNS de Windows et ne filtre pas encore le trafic de tout le système. Ce module démontre un moteur de listes et un résolveur local que vous pouvez tester explicitement.",
              "CBS Shield does not change Windows DNS and does not yet filter system-wide traffic. This module demonstrates a list engine and a local resolver that you can test explicitly.",
            )}
          </p>
          <div className="webguard-pills">
            <span className="webguard-pill">
              <Network size={13} /> {proxy.endpoint}
            </span>
            <span className="webguard-pill">
              <LockKeyhole size={13} /> {L("Aucune interception HTTPS", "No HTTPS interception")}
            </span>
            <span className="webguard-pill">
              <ShieldCheck size={13} /> {L("DNS système non modifié", "System DNS untouched")}
            </span>
          </div>
        </div>
        <div className="webguard-hero__actions">
          <Badge tone={proxy.running ? "ok" : "neutral"} dot>
            {proxy.running ? L("En écoute", "Listening") : L("Arrêté", "Stopped")}
          </Badge>
          {proxy.running ? (
            <button type="button" className="button button--ghost" onClick={() => void stopMonitor()} disabled={busy !== null}>
              {busy === "monitor" ? <LoaderCircle size={15} className="spin" /> : <ShieldOff size={15} />}
              {L("Arrêter le prototype", "Stop prototype")}
            </button>
          ) : (
            <button type="button" className="button button--primary" onClick={() => void startMonitor()} disabled={busy !== null}>
              {busy === "monitor" ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}
              {L("Démarrer le prototype", "Start prototype")}
            </button>
          )}
          <button type="button" className="button button--ghost" onClick={() => void load()} disabled={busy !== null}>
            <RefreshCw size={15} /> {L("Actualiser", "Refresh")}
          </button>
        </div>
      </section>

      {view.systemDnsModified || view.activeEnforcement || canClear ? (
        <div className="banner banner--danger">
          <ShieldAlert size={19} aria-hidden="true" />
          <div>
            <strong>{L("État inattendu détecté", "Unexpected state detected")}</strong>
            <span>
              {L(
                "CBS Shield signale une modification ou un mode appliqué qui ne devrait pas exister dans ce prototype. Nettoyez et vérifiez le DNS système.",
                "CBS Shield reports a modification or enforced mode that should not exist in this prototype. Clean up and verify system DNS.",
              )}
            </span>
          </div>
        </div>
      ) : null}

      <nav className="webguard-tabs" aria-label={L("Sections Web Guard", "Web Guard sections")} role="tablist">
        {TABS.map(({ id, fr, en, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`webguard-tabs__item${tab === id ? " is-active" : ""}`}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {L(fr, en)}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="section-stack" role="tabpanel">
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-card__top">
                <div className="metric-card__icon metric-card__icon--danger"><Ban size={17} /></div>
                <Badge tone="danger" subtle>{L("Bloqués", "Blocked")}</Badge>
              </div>
              <span className="metric-card__label">{L("Domaines bloqués", "Blocked domains")}</span>
              <span className="metric-card__value">{formatNumber(counts.blocklist)}</span>
              <span className="metric-card__hint">
                {formatNumber(counts.malware)} malware · {formatNumber(counts.phishing)} {L("hameçonnage", "phishing")}
              </span>
            </div>
            <div className="metric-card">
              <div className="metric-card__top">
                <div className="metric-card__icon metric-card__icon--ok"><CheckCircle2 size={17} /></div>
                <Badge tone="ok" subtle>{L("Prioritaires", "Priority")}</Badge>
              </div>
              <span className="metric-card__label">{L("Autorisations", "Allow entries")}</span>
              <span className="metric-card__value">{formatNumber(counts.allowlist)}</span>
              <span className="metric-card__hint">
                {L("Une autorisation gagne toujours sur le blocage.", "An allow entry always wins over blocking.")}
              </span>
            </div>
            <div className="metric-card">
              <div className="metric-card__top">
                <div className="metric-card__icon"><Layers3 size={17} /></div>
                <Badge tone="info" subtle>{L("Locales", "Local")}</Badge>
              </div>
              <span className="metric-card__label">{L("Sources importées", "Imported sources")}</span>
              <span className="metric-card__value">{formatNumber(counts.filters)}</span>
              <span className="metric-card__hint">
                {L("Fichiers choisis par vous, sans flux distant.", "Files chosen by you, no remote feed.")}
              </span>
            </div>
            <div className="metric-card">
              <div className="metric-card__top">
                <div className="metric-card__icon metric-card__icon--warn"><Activity size={17} /></div>
                <Badge tone={counts.blockedEvents > 0 ? "warning" : "neutral"} subtle>
                  {L("Local", "Local")}
                </Badge>
              </div>
              <span className="metric-card__label">{L("Blocages observés", "Observed blocks")}</span>
              <span className="metric-card__value">{formatNumber(counts.blockedEvents)}</span>
              <span className="metric-card__hint">
                {formatNumber(counts.events)} {L("événement(s) conservé(s) localement.", "event(s) kept locally.")}
              </span>
            </div>
          </div>

          <div className="webguard-grid">
            <section className="panel">
              <div className="panel__head">
                <div>
                  <span className="panel__eyebrow">{L("Santé DNS", "DNS health")}</span>
                  <h2>{L("État observé du système", "Observed system state")}</h2>
                </div>
                <Badge tone={health.healthy ? "ok" : "warning"} dot>
                  {health.healthy ? L("Fonctionnel", "Operational") : L("À vérifier", "Check")}
                </Badge>
              </div>
              <div className="webguard-kv">
                <div>
                  <span>{L("Service DNS", "DNS service")}</span>
                  <strong>{health.service === "running" ? "Dnscache · " + L("actif", "running") : health.service}</strong>
                </div>
                <div>
                  <span>{L("Résolveurs configurés", "Configured resolvers")}</span>
                  <strong>{formatNumber(health.resolvers.length)}</strong>
                </div>
                <div>
                  <span>{L("Adaptateurs observés", "Observed adapters")}</span>
                  <strong>{formatNumber(health.adapters.length)}</strong>
                </div>
                <div>
                  <span>{L("VPN probable", "Probable VPN")}</span>
                  <strong>{health.probableVpn ? L("Oui, à vérifier", "Yes, check") : L("Aucun indice", "No hint")}</strong>
                </div>
              </div>
              <p className="panel__note">
                {L(
                  "Lecture seule via GetAdaptersAddresses et le registre. Aucun adaptateur, service ou résolveur n'est modifié.",
                  "Read-only via GetAdaptersAddresses and the registry. No adapter, service or resolver is changed.",
                )}
              </p>
              <button type="button" className="button button--ghost button--small" onClick={() => setTab("diagnostics")}>
                <Stethoscope size={14} /> {L("Ouvrir le diagnostic", "Open diagnostics")}
              </button>
            </section>

            <section className="panel">
              <div className="panel__head">
                <div>
                  <span className="panel__eyebrow">{L("Derniers événements", "Latest events")}</span>
                  <h2>{L("Activité locale", "Local activity")}</h2>
                </div>
                <button type="button" className="button button--ghost button--small" onClick={() => setTab("activity")}>
                  {L("Tout voir", "View all")} <ArrowRight size={14} />
                </button>
              </div>
              {view.events.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title={L("Aucun événement local", "No local event")}
                  description={L(
                    "Démarrez le prototype et testez un domaine pour produire une observation réelle. Aucune donnée n'est simulée.",
                    "Start the prototype and test a domain to produce a real observation. No data is simulated.",
                  )}
                />
              ) : (
                <ul className="webguard-event-list">
                  {view.events.slice(0, 5).map((event) => (
                    <li key={event.id}>
                      <Badge tone={EVENT_TONE[event.action]} subtle>
                        {event.action === "blocked"
                          ? L("Bloqué", "Blocked")
                          : event.action === "allowed"
                            ? L("Autorisé", "Allowed")
                            : L("Erreur", "Error")}
                      </Badge>
                      <div>
                        <strong className="mono">{event.domain}</strong>
                        <span>{formatDateTime(event.occurredAt)} · {eventDetailText(event, L)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Point de contrôle", "Control point")}</span>
                <h2>{L("Tester un domaine réel", "Test a real domain")}</h2>
              </div>
              <Badge tone={proxy.running ? "ok" : "neutral"} dot>
                {proxy.running ? L("Loopback en écoute", "Loopback listening") : L("Classificateur seul", "Classifier only")}
              </Badge>
            </div>
            <div className="webguard-test-row">
              <label className="field">
                <span className="field__label">{L("Domaine à évaluer", "Domain to evaluate")}</span>
                <input
                  className="input mono"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void runDomainTest();
                  }}
                  placeholder="example.com"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <button type="button" className="button button--primary" onClick={() => void runDomainTest()} disabled={busy !== null || !domain.trim()}>
                {busy === "test" ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}
                {L("Évaluer", "Evaluate")}
              </button>
            </div>
            {testError && (
              <div className="callout callout--danger">
                <TriangleAlert size={16} /> <span>{testError}</span>
              </div>
            )}
            {testResult && <DomainTestCard result={testResult} L={L} onStart={() => void startMonitor()} busy={busy !== null} />}
          </section>
        </div>
      )}

      {tab === "dns" && (
        <div className="section-stack" role="tabpanel">
          <div className={`banner ${proxy.running ? "banner--info" : "banner--neutral"}`}>
            {proxy.running ? <Network size={19} /> : <WifiOff size={19} />}
            <div>
              <strong>
                {proxy.running
                  ? L("Le prototype écoute localement", "The prototype is listening locally")
                  : L("Aucun filtrage actif", "No active filtering")}
              </strong>
              <span>
                {L(
                  "Le résolveur transmet les requêtes autorisées au résolveur système configuré. Les domaines bloqués reçoivent une réponse NXDOMAIN locale et ne sont pas envoyés à Internet.",
                  "The resolver forwards allowed queries to the configured system resolver. Blocked domains receive a local NXDOMAIN answer and are not sent to the Internet.",
                )}
              </span>
            </div>
          </div>

          <div className="webguard-grid">
            <section className="panel">
              <div className="panel__head">
                <div>
                  <span className="panel__eyebrow">{L("Contrôles", "Controls")}</span>
                  <h2>{L("Prototype DNS", "DNS prototype")}</h2>
                </div>
                <Badge tone={proxy.running ? "ok" : "neutral"} dot>
                  {proxy.running ? L("Actif", "Active") : L("Arrêté", "Stopped")}
                </Badge>
              </div>
              <div className="webguard-kv">
                <div>
                  <span>{L("Point d'écoute", "Listen endpoint")}</span>
                  <strong className="mono">{proxy.endpoint}</strong>
                </div>
                <div>
                  <span>{L("Mode", "Mode")}</span>
                  <strong>{L("Prototype loopback", "Loopback prototype")}</strong>
                </div>
                <div>
                  <span>{L("Démarré à", "Started at")}</span>
                  <strong>{formatDateTime(proxy.startedAt)}</strong>
                </div>
                <div>
                  <span>{L("Application système", "System enforcement")}</span>
                  <strong className="text-warning">{L("Désactivée", "Disabled")}</strong>
                </div>
              </div>
              <div className="webguard-actions">
                {proxy.running ? (
                  <button type="button" className="button button--ghost" onClick={() => void stopMonitor()} disabled={busy !== null}>
                    {busy === "monitor" ? <LoaderCircle size={15} className="spin" /> : <ShieldOff size={15} />}
                    {L("Arrêter", "Stop")}
                  </button>
                ) : (
                  <button type="button" className="button button--primary" onClick={() => void startMonitor()} disabled={busy !== null}>
                    {busy === "monitor" ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}
                    {L("Démarrer le prototype", "Start prototype")}
                  </button>
                )}
                <button type="button" className="button button--ghost" onClick={() => setTab("safety")}>
                  <ShieldAlert size={15} /> {L("Lire les limites", "Read limitations")}
                </button>
              </div>
              {proxy.lastError && <div className="callout callout--warning">{proxy.lastError}</div>}
            </section>

            <section className="panel">
              <div className="panel__head">
                <div>
                  <span className="panel__eyebrow">{L("Test réel", "Real test")}</span>
                  <h2>{L("Évaluer et interroger", "Evaluate and query")}</h2>
                </div>
                <Badge tone="info" subtle>{L("Action explicite", "Explicit action")}</Badge>
              </div>
              <div className="webguard-test-stack">
                <label className="field">
                  <span className="field__label">{L("Domaine", "Domain")}</span>
                  <input
                    className="input mono"
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void runDomainTest();
                    }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
                <button type="button" className="button button--primary" onClick={() => void runDomainTest()} disabled={busy !== null || !domain.trim()}>
                  {busy === "test" ? <LoaderCircle size={15} className="spin" /> : <FileSearch size={15} />}
                  {L("Lancer le test réel", "Run real test")}
                </button>
              </div>
              {testError && <div className="callout callout--danger">{testError}</div>}
              {testResult ? (
                <DomainTestCard result={testResult} L={L} onStart={() => void startMonitor()} busy={busy !== null} />
              ) : (
                <p className="panel__note">
                  {L(
                    "Le classificateur local s'exécute toujours. Si le prototype est arrêté, aucune requête réseau n'est envoyée et aucun blocage réel n'est observé.",
                    "The local classifier always runs. If the prototype is stopped, no network query is sent and no real block is observed.",
                  )}
                </p>
              )}
            </section>
          </div>
        </div>
      )}

      {tab === "blocklist" && (
        <div className="section-stack" role="tabpanel">
          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Règles de blocage", "Blocking rules")}</span>
                <h2>{L("Domaines bloqués", "Blocked domains")}</h2>
                <p className="panel__note">
                  {L(
                    "Une règle couvre aussi ses sous-domaines. Les autorisations restent prioritaires. Aucun domaine n'est ajouté automatiquement.",
                    "A rule also covers its subdomains. Allow entries remain higher priority. No domain is added automatically.",
                  )}
                </p>
              </div>
              <div className="row-actions">
                <Badge tone="danger">{formatNumber(counts.blocklist)}</Badge>
                <button type="button" className="button button--ghost button--small" onClick={() => void pickFilter()} disabled={busy !== null}>
                  <Download size={14} /> {L("Importer une liste", "Import list")}
                </button>
                <button
                  type="button"
                  className="button button--danger-ghost button--small"
                  onClick={() => setClearKind("blocklist")}
                  disabled={busy !== null || counts.blocklist === 0}
                >
                  <Trash2 size={14} /> {L("Tout effacer", "Clear all")}
                </button>
              </div>
            </div>

            <div className="webguard-toolbar">
              <label className="field webguard-search">
                <span className="field__label">{L("Rechercher", "Search")}</span>
                <input
                  className="input"
                  value={blockQuery}
                  onChange={(event) => setBlockQuery(event.target.value)}
                  placeholder={L("domaine, source ou catégorie…", "domain, source or category…")}
                />
              </label>
              <span className="webguard-count-note">
                {view.blocklistTruncated
                  ? L(
                      `Affichage de ${formatNumber(view.blocklist.length)} règles sur ${formatNumber(view.blocklistTotal)}.`,
                      `Showing ${formatNumber(view.blocklist.length)} rules of ${formatNumber(view.blocklistTotal)}.`,
                    )
                  : `${formatNumber(filteredBlocklist.length)} ${L("règle(s) affichée(s).", "rule(s) shown.")}`}
              </span>
            </div>

            {filteredBlocklist.length === 0 ? (
              <EmptyState
                icon={Filter}
                title={L("Aucun domaine bloqué", "No blocked domain")}
                description={L(
                  "Importez une liste locale au format hosts ou une liste de domaines. Le contenu est lu localement et vérifié avant fusion.",
                  "Import a local hosts-format or domain list. Content is read locally and validated before merging.",
                )}
                action={
                  <button type="button" className="button button--primary" onClick={() => void pickFilter()}>
                    <Download size={15} /> {L("Choisir un fichier", "Choose a file")}
                  </button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>{L("Domaine", "Domain")}</th>
                      <th>{L("Catégorie", "Category")}</th>
                      <th>{L("Source", "Source")}</th>
                      <th>{L("Importé", "Imported")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBlocklist.slice(0, 300).map((entry) => (
                      <tr key={`${entry.domain}-${entry.source}`}>
                        <td className="mono webguard-domain">{entry.domain}</td>
                        <td>
                          <Badge tone={CATEGORY_TONE[entry.category] ?? "neutral"} subtle>
                            {categoryLabel(entry.category, L)}
                          </Badge>
                        </td>
                        <td>{entry.source}</td>
                        <td>{formatDateTime(entry.importedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "allowlist" && (
        <div className="section-stack" role="tabpanel">
          <div className="banner banner--info">
            <CheckCircle2 size={19} aria-hidden="true" />
            <div>
              <strong>{L("Les autorisations gagnent toujours", "Allow entries always win")}</strong>
              <span>
                {L(
                  "Utilisez cette liste pour corriger un faux positif documenté. Elle ne désactive pas une règle de blocage globale et ne modifie pas le DNS système.",
                  "Use this list to correct a documented false positive. It does not disable a global blocking rule and does not change system DNS.",
                )}
              </span>
            </div>
          </div>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Exception manuelle", "Manual exception")}</span>
                <h2>{L("Ajouter une autorisation", "Add an allow entry")}</h2>
              </div>
              <Badge tone="ok">{formatNumber(counts.allowlist)}</Badge>
            </div>
            <div className="webguard-form">
              <label className="field">
                <span className="field__label">{L("Domaine", "Domain")}</span>
                <input
                  className="input mono"
                  value={allowDomain}
                  onChange={(event) => setAllowDomain(event.target.value)}
                  placeholder="service.example.com"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span className="field__label">{L("Motif documenté", "Documented reason")}</span>
                <input
                  className="input"
                  value={allowNote}
                  onChange={(event) => setAllowNote(event.target.value)}
                  placeholder={L("Faux positif vérifié", "Verified false positive")}
                  maxLength={200}
                />
              </label>
              <button type="button" className="button button--primary" onClick={() => void addAllowlist()} disabled={busy !== null || !allowDomain.trim()}>
                {busy === "allowlist" ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}
                {L("Autoriser ce domaine", "Allow this domain")}
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Exceptions locales", "Local exceptions")}</span>
                <h2>{L("Domaines autorisés", "Allowed domains")}</h2>
              </div>
            </div>
            {view.allowlist.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title={L("Aucune exception", "No exception")}
                description={L(
                  "Aucun domaine n'est prioritaire sur la liste de blocage pour le moment.",
                  "No domain currently takes priority over the blocklist.",
                )}
              />
            ) : (
              <div className="table-wrap">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>{L("Domaine", "Domain")}</th>
                      <th>{L("Motif", "Reason")}</th>
                      <th>{L("Ajouté", "Added")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {view.allowlist.map((entry) => (
                      <tr key={entry.domain}>
                        <td className="mono webguard-domain">{entry.domain}</td>
                        <td>{entry.note || "—"}</td>
                        <td>{formatDateTime(entry.addedAt)}</td>
                        <td className="num">
                          <button
                            type="button"
                            className="button button--ghost button--icon button--small"
                            aria-label={L("Retirer", "Remove")}
                            onClick={() => setRemoveTarget(entry.domain)}
                            disabled={busy !== null}
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "activity" && (
        <div className="section-stack" role="tabpanel">
          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Historique local", "Local history")}</span>
                <h2>{L("Activité DNS observée", "Observed DNS activity")}</h2>
                <p className="panel__note">
                  {L(
                    "Maximum 300 événements, stockés localement. Aucun domaine n'est envoyé à un service distant.",
                    "At most 300 events, stored locally. No domain is sent to a remote service.",
                  )}
                </p>
              </div>
              <button
                type="button"
                className="button button--danger-ghost button--small"
                onClick={() => setClearKind("history")}
                disabled={busy !== null || counts.events === 0}
              >
                <Trash2 size={14} /> {L("Effacer l'historique", "Clear history")}
              </button>
            </div>
            <div className="segmented webguard-filter" role="group" aria-label={L("Filtrer les événements", "Filter events")}>
              {(
                [
                  ["all", L("Tout", "All")],
                  ["blocked", L("Bloqués", "Blocked")],
                  ["allowed", L("Autorisés", "Allowed")],
                  ["error", L("Erreurs", "Errors")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={eventFilter === value ? "is-active" : ""}
                  onClick={() => setEventFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {filteredEvents.length === 0 ? (
              <EmptyState
                icon={History}
                title={L("Aucun événement pour ce filtre", "No event for this filter")}
                description={L(
                  "Les observations apparaissent après un test réel ou une requête envoyée au prototype loopback.",
                  "Observations appear after a real test or a query sent to the loopback prototype.",
                )}
              />
            ) : (
              <div className="table-wrap">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>{L("Date", "Date")}</th>
                      <th>{L("Domaine", "Domain")}</th>
                      <th>{L("Décision", "Decision")}</th>
                      <th>{L("Détail", "Detail")}</th>
                      <th>{L("Latence", "Latency")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEvents.map((event) => (
                      <tr key={event.id}>
                        <td>{formatDateTime(event.occurredAt)}</td>
                        <td className="mono webguard-domain">{event.domain}</td>
                        <td>
                          <Badge tone={EVENT_TONE[event.action]} subtle>
                            {event.action === "blocked"
                              ? L("Bloqué", "Blocked")
                              : event.action === "allowed"
                                ? L("Autorisé", "Allowed")
                                : L("Erreur", "Error")}
                          </Badge>
                        </td>
                        <td className="webguard-detail">{eventDetailText(event, L)}</td>
                        <td className="num">{event.latencyMs === null ? "—" : `${event.latencyMs} ms`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "filters" && (
        <div className="section-stack" role="tabpanel">
          <div className="banner banner--neutral">
            <Info size={19} aria-hidden="true" />
            <div>
              <strong>{L("Mises à jour manuelles uniquement", "Manual updates only")}</strong>
              <span>
                {L(
                  "CBS Shield n'interroge aucun flux distant. Vous choisissez chaque fichier local. Une liste corrompue est refusée sans remplacer la liste précédente.",
                  "CBS Shield fetches no remote feed. You choose each local file. A corrupt list is rejected without replacing the previous one.",
                )}
              </span>
              <div className="banner__actions">
                <button type="button" className="button button--primary" onClick={() => void pickFilter()} disabled={busy !== null}>
                  <Download size={15} /> {L("Importer une liste locale", "Import a local list")}
                </button>
              </div>
            </div>
          </div>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Provenance", "Provenance")}</span>
                <h2>{L("Sources de filtres", "Filter sources")}</h2>
              </div>
              <Badge tone="info">{formatNumber(counts.filters)}</Badge>
            </div>
            {view.filters.length === 0 ? (
              <EmptyState
                icon={Archive}
                title={L("Aucune source importée", "No imported source")}
                description={L(
                  "Formats acceptés : lignes de domaines, format hosts (0.0.0.0 domaine) et commentaires #. Taille maximale : 8 Mio.",
                  "Accepted formats: domain lines, hosts format (0.0.0.0 domain) and # comments. Maximum size: 8 MiB.",
                )}
              />
            ) : (
              <div className="table-wrap">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>{L("Nom", "Name")}</th>
                      <th>{L("Catégorie", "Category")}</th>
                      <th>{L("Entrées", "Entries")}</th>
                      <th>{L("Importé", "Imported")}</th>
                      <th>SHA-256</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.filters.map((source) => (
                      <tr key={source.id}>
                        <td>{source.name}</td>
                        <td>
                          <Badge tone={CATEGORY_TONE[source.category] ?? "neutral"} subtle>
                            {categoryLabel(source.category, L)}
                          </Badge>
                        </td>
                        <td className="num">{formatNumber(source.entryCount)}</td>
                        <td>{formatDateTime(source.importedAt)}</td>
                        <td className="mono webguard-hash" title={source.sha256}>
                          {truncateMiddle(source.sha256, 18)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Source autorisée", "Pinned source")}</span>
                <h2>{L("Aucun téléchargement automatique", "No automatic download")}</h2>
              </div>
              <Badge tone="warning" subtle>{L("Hors ligne", "Offline")}</Badge>
            </div>
            <div className="webguard-safety-grid">
              <div className="webguard-safety-card">
                <Database size={18} />
                <strong>{L("Stockage local", "Local storage")}</strong>
                <span>{L("Les métadonnées et les domaines restent dans le dossier de données de l'utilisateur.", "Metadata and domains stay in the user's data folder.")}</span>
              </div>
              <div className="webguard-safety-card">
                <ShieldCheck size={18} />
                <strong>{L("Vérification", "Validation")}</strong>
                <span>{L("Catégorie, taille, lignes et domaine sont validés avant fusion atomique.", "Category, size, lines and domains are validated before an atomic merge.")}</span>
              </div>
              <div className="webguard-safety-card">
                <X size={18} />
                <strong>{L("Pas de télémétrie", "No telemetry")}</strong>
                <span>{L("Aucun domaine consulté, aucune liste et aucun identifiant ne sont transmis.", "No queried domain, list or identifier is transmitted.")}</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === "diagnostics" && (
        <div className="section-stack" role="tabpanel">
          <div className="banner banner--info">
            <Stethoscope size={19} aria-hidden="true" />
            <div>
              <strong>{L("Diagnostic strictement en lecture seule", "Strictly read-only diagnostics")}</strong>
              <span>
                {L(
                  "Les informations ci-dessous décrivent l'état observé. CBS Shield ne répare pas, ne réinitialise pas et ne modifie pas la configuration réseau.",
                  "The information below describes observed state. CBS Shield does not repair, reset or modify network configuration.",
                )}
              </span>
            </div>
          </div>

          <div className="metric-grid webguard-diagnostic-metrics">
            <div className="metric-card">
              <span className="metric-card__label">{L("Service Dnscache", "Dnscache service")}</span>
              <span className="metric-card__value">{health.service === "running" ? L("Actif", "Running") : health.service}</span>
              <span className="metric-card__hint">{health.serviceObservable ? L("État lu via sc query.", "State read via sc query.") : L("Non observable.", "Not observable.")}</span>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">{L("Résolveurs", "Resolvers")}</span>
              <span className="metric-card__value">{formatNumber(health.resolvers.length)}</span>
              <span className="metric-card__hint">{L("Uniques, tous adaptateurs confondus.", "Unique, across all adapters.")}</span>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">{L("DoH automatique", "Auto DoH")}</span>
              <span className="metric-card__value">
                {health.encryptedDnsEvidence === null
                  ? L("Inconnu", "Unknown")
                  : health.encryptedDnsEvidence
                    ? L("Indice", "Hint")
                    : L("Désactivé", "Disabled")}
              </span>
              <span className="metric-card__hint">{L("Valeur registre EnableAutoDoh, non concluante.", "EnableAutoDoh registry value, not conclusive.")}</span>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">{L("Proxy WinINET", "WinINET proxy")}</span>
              <span className="metric-card__value">{health.proxyConfigured ? L("Configuré", "Configured") : L("Aucun", "None")}</span>
              <span className="metric-card__hint">{health.proxyConfigured ? truncateMiddle(health.proxyConfigured, 32) : L("Aucun proxy utilisateur observé.", "No user proxy observed.")}</span>
            </div>
          </div>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Adaptateurs", "Adapters")}</span>
                <h2>{L("Configuration DNS observée", "Observed DNS configuration")}</h2>
              </div>
              <Badge tone="neutral" subtle>{L("Lecture seule", "Read-only")}</Badge>
            </div>
            {health.adapters.length === 0 ? (
              <EmptyState
                icon={Network}
                title={L("Aucun adaptateur lisible", "No readable adapter")}
                description={L("GetAdaptersAddresses n'a retourné aucune entrée.", "GetAdaptersAddresses returned no entry.")}
              />
            ) : (
              <div className="table-wrap">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>{L("Adaptateur", "Adapter")}</th>
                      <th>{L("Type", "Type")}</th>
                      <th>{L("État", "State")}</th>
                      <th>{L("Résolveurs DNS", "DNS resolvers")}</th>
                      <th>{L("Suffixe", "Suffix")}</th>
                      <th>{L("Indice VPN", "VPN hint")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.adapters.map((adapter) => (
                      <tr key={`${adapter.name}-${adapter.description}`}>
                        <td>
                          <strong>{adapter.name}</strong>
                          <div className="webguard-adapter-desc">{adapter.description || "—"}</div>
                        </td>
                        <td>{interfaceKindLabel(adapter.interfaceKind, L)}</td>
                        <td>
                          <Badge tone={adapter.up ? "ok" : "neutral"} subtle>
                            {adapter.up ? L("Actif", "Up") : L("Inactif", "Down")}
                          </Badge>
                        </td>
                        <td>
                          <div className="webguard-pills">
                            {adapter.dnsServers.length === 0 ? (
                              <span className="webguard-muted">—</span>
                            ) : (
                              adapter.dnsServers.map((server) => (
                                <span className="webguard-pill mono" key={server}>{server}</span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="mono">{adapter.dnsSuffix || "—"}</td>
                        <td>{adapter.probableVpn ? <Badge tone="warning" subtle>{L("Probable", "Likely")}</Badge> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Résolveurs uniques", "Unique resolvers")}</span>
                <h2>{L("Cibles de transmission", "Forwarding targets")}</h2>
              </div>
            </div>
            {health.resolvers.length === 0 ? (
              <div className="callout callout--warning">
                <TriangleAlert size={16} />
                <span>{L("Aucun résolveur n'est configuré : le prototype ne peut pas démarrer.", "No resolver is configured: the prototype cannot start.")}</span>
              </div>
            ) : (
              <div className="webguard-pills">
                {health.resolvers.map((resolver) => (
                  <span className="webguard-pill mono" key={resolver}>{resolver}</span>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "safety" && (
        <div className="section-stack" role="tabpanel">
          <div className="banner banner--warning">
            <TriangleAlert size={19} aria-hidden="true" />
            <div>
              <strong>{L("Prototype — pas une protection complète", "Prototype — not complete protection")}</strong>
              <span>
                {L(
                  "Web Guard démontre un filtrage DNS local. Il ne remplace ni Microsoft Defender, ni un pare-feu, ni une passerelle DNS d'entreprise.",
                  "Web Guard demonstrates local DNS filtering. It replaces neither Microsoft Defender, nor a firewall, nor an enterprise DNS gateway.",
                )}
              </span>
            </div>
          </div>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Garanties techniques", "Technical guarantees")}</span>
                <h2>{L("Ce que CBS Shield ne fait pas", "What CBS Shield does not do")}</h2>
              </div>
              <Badge tone="ok" dot>{L("Vérifié par conception", "Enforced by design")}</Badge>
            </div>
            <div className="webguard-safety-grid">
              <div className="webguard-safety-card">
                <LockKeyhole size={18} />
                <strong>{L("Aucun réglage DNS système", "No system DNS setting")}</strong>
                <span>{L("Pas de modification de clé, d'adaptateur, de hosts ou de service.", "No key, adapter, hosts file or service change.")}</span>
              </div>
              <div className="webguard-safety-card">
                <ShieldCheck size={18} />
                <strong>{L("Aucune interception TLS", "No TLS interception")}</strong>
                <span>{L("Pas de certificat, pas de déchiffrement, pas de lecture de page.", "No certificate, no decryption, no page reading.")}</span>
              </div>
              <div className="webguard-safety-card">
                <Ban size={18} />
                <strong>{L("Aucune règle de pare-feu", "No firewall rule")}</strong>
                <span>{L("Aucun filtre WFP, pilote ou règle Windows n'est créé.", "No WFP filter, driver or Windows rule is created.")}</span>
              </div>
              <div className="webguard-safety-card">
                <ShieldOff size={18} />
                <strong>{L("Aucun mode appliqué", "No enforced mode")}</strong>
                <span>{L("Le prototype loopback n'est pas une protection système globale.", "The loopback prototype is not system-wide protection.")}</span>
              </div>
              <div className="webguard-safety-card">
                <Database size={18} />
                <strong>{L("Aucune télémétrie", "No telemetry")}</strong>
                <span>{L("Listes, événements et tests restent dans le stockage local.", "Lists, events and tests stay in local storage.")}</span>
              </div>
              <div className="webguard-safety-card">
                <WifiOff size={18} />
                <strong>{L("Aucun flux distant", "No remote feed")}</strong>
                <span>{L("Les listes sont importées manuellement depuis un fichier choisi.", "Lists are imported manually from a chosen file.")}</span>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Contournements connus", "Known bypasses")}</span>
                <h2>{L("Limites explicites du prototype", "Explicit prototype limitations")}</h2>
              </div>
            </div>
            <div className="webguard-limitations">
              {view.limitationCodes.map((code) => {
                const text = limitationText(code, L);
                return (
                  <div className="webguard-limitation" key={code}>
                    <CircleAlert size={17} />
                    <div>
                      <strong>{text.title}</strong>
                      <span>{text.detail}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="panel__eyebrow">{L("Réponse aux incidents", "Incident response")}</span>
                <h2>{L("Vérifier après un test", "Verify after a test")}</h2>
              </div>
            </div>
            <ol className="webguard-checklist">
              <li>{L("Arrêtez le prototype : le port loopback est libéré.", "Stop the prototype: the loopback port is released.")}</li>
              <li>{L("Vérifiez que le DNS Windows n'a pas changé dans le diagnostic.", "Check that Windows DNS did not change in diagnostics.")}</li>
              <li>{L("Supprimez les listes importées si elles ne sont plus nécessaires.", "Remove imported lists if they are no longer needed.")}</li>
              <li>{L("Consultez l'historique local, puis effacez-le si nécessaire.", "Review local history, then clear it if needed.")}</li>
              <li>{L("En cas de comportement réseau anormal, utilisez les outils Windows et non une modification silencieuse de CBS Shield.", "If network behaviour is abnormal, use Windows tools rather than a silent CBS Shield change.")}</li>
            </ol>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title={L("Retirer cette autorisation ?", "Remove this allow entry?")}
        eyebrow={L("Exceptions locales", "Local exceptions")}
        tone="warning"
        description={
          <span>
            {L("Le domaine", "The domain")} <strong className="mono">{removeTarget}</strong>{" "}
            {L(
              "sera de nouveau évalué par la liste de blocage. Aucun réglage système n'est modifié.",
              "will again be evaluated by the blocklist. No system setting is changed.",
            )}
          </span>
        }
        confirmLabel={L("Retirer", "Remove")}
        busy={busy === "allowlist"}
        onConfirm={() => void removeAllowlist()}
        onClose={() => setRemoveTarget(null)}
      />

      <ConfirmDialog
        open={importRequest !== null}
        title={L("Importer cette liste locale ?", "Import this local list?")}
        eyebrow={L("Filtres Web Guard", "Web Guard filters")}
        tone="warning"
        description={
          <div className="webguard-import">
            <p>
              {L("Fichier choisi :", "Selected file:")} <strong>{importRequest?.name}</strong>
            </p>
            <p>
              {L(
                "Le fichier est lu localement, limité à 8 Mio, validé, puis fusionné. Une liste invalide ne remplace pas la liste existante. Aucun contenu n'est envoyé sur le réseau.",
                "The file is read locally, limited to 8 MiB, validated, then merged. An invalid list does not replace the existing one. No content is sent over the network.",
              )}
            </p>
          </div>
        }
        confirmLabel={L("Importer", "Import")}
        busy={busy === "import"}
        onConfirm={() => void confirmImport()}
        onClose={() => setImportRequest(null)}
        requireCheckbox={L(
          "J'ai choisi ce fichier et j'autorise son import local dans Web Guard.",
          "I selected this file and authorize its local import into Web Guard.",
        )}
      >
        <label className="field">
          <span className="field__label">{L("Catégorie de la liste", "List category")}</span>
          <select
            className="input"
            value={importCategory}
            onChange={(event) => setImportCategory(event.target.value as "malware" | "phishing")}
          >
            <option value="malware">{L("Malware", "Malware")}</option>
            <option value="phishing">{L("Hameçonnage", "Phishing")}</option>
          </select>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={clearKind !== null}
        title={
          clearKind === "history"
            ? L("Effacer tout l'historique local ?", "Clear all local history?")
            : L("Effacer toutes les règles de blocage ?", "Clear all blocking rules?")
        }
        eyebrow={L("Action irréversible", "Irreversible action")}
        tone="danger"
        description={
          <span>
            {clearKind === "history"
              ? L(
                  "Les événements DNS locaux seront supprimés. Les listes et autorisations sont conservées.",
                  "Local DNS events will be deleted. Lists and allow entries are kept.",
                )
              : L(
                  "Les domaines bloqués et l'historique des sources seront supprimés. Les autorisations sont conservées. Aucun réglage DNS système n'est modifié.",
                  "Blocked domains and source history will be deleted. Allow entries are kept. No system DNS setting is changed.",
                )}
          </span>
        }
        confirmLabel={L("Effacer", "Clear")}
        busy={busy === "clear"}
        onConfirm={() => void clearData()}
        onClose={() => setClearKind(null)}
        requireCheckbox={L(
          "Je comprends que cette action supprime des données locales.",
          "I understand this action deletes local data.",
        )}
      />
    </div>
  );
}

function DomainTestCard({
  result,
  L,
  onStart,
  busy,
}: {
  result: WebGuardDomainTest;
  L: Localize;
  onStart: () => void;
  busy: boolean;
}) {
  const blocked = result.verdict.action === "blocked";
  const failed = result.queryOutcome === "upstreamFailure" || result.queryOutcome === "error";
  const cardClass = blocked && !failed
    ? "webguard-verdict webguard-verdict--blocked"
    : failed
      ? "webguard-verdict webguard-verdict--error"
      : "webguard-verdict webguard-verdict--allowed";
  const reason =
    result.verdict.reason === "allowlist"
      ? L("Autorisation prioritaire", "Allow entry takes priority")
      : result.verdict.reason === "blocklist"
        ? L("Correspondance dans la liste de blocage", "Blocklist match")
        : L("Aucune règle correspondante", "No matching rule");
  return (
    <div className={`${cardClass} webguard-test-result`} role="status">
      <div className="webguard-test-result__head">
        <div className="webguard-test-result__icon">
          {blocked && !failed ? <ShieldAlert size={22} /> : failed ? <CircleAlert size={22} /> : <CheckCircle2 size={22} />}
        </div>
        <div>
          <span className="panel__eyebrow">
            {result.queryOutcome === "notRunning"
              ? L("Classificateur local", "Local classifier")
              : L("Résultat réel", "Real result")}
          </span>
          <h3 className="mono">{result.domain}</h3>
          <p>{reason}</p>
        </div>
        <Badge tone={blocked && !failed ? "danger" : failed ? "warning" : "ok"} dot>
          {blocked && !failed
            ? result.queryOutcome === "notRunning"
              ? L("Bloqué, non appliqué", "Blocked, not enforced")
              : L("Bloqué", "Blocked")
            : failed
              ? L("Erreur", "Error")
              : L("Autorisé", "Allowed")}
        </Badge>
      </div>
      <div className="webguard-kv webguard-kv--compact">
        <div>
          <span>{L("Requête loopback", "Loopback query")}</span>
          <strong>
            {result.queryOutcome === "notRunning"
              ? L("Non envoyée", "Not sent")
              : result.queryOutcome === "blocked"
                ? "NXDOMAIN"
                : result.rcode === null
                  ? "—"
                  : `RCODE ${result.rcode}`}
          </strong>
        </div>
        <div>
          <span>{L("Latence", "Latency")}</span>
          <strong>{result.latencyMs === null ? "—" : `${result.latencyMs} ms`}</strong>
        </div>
        <div>
          <span>{L("Point d'écoute", "Endpoint")}</span>
          <strong className="mono">{result.endpoint}</strong>
        </div>
        <div>
          <span>{L("Règle", "Rule")}</span>
          <strong className="mono">{result.verdict.matchedRule ?? "—"}</strong>
        </div>
      </div>
      <p className="webguard-test-result__detail">{domainTestDetailText(result, L)}</p>
      {!result.proxyRunning && (
        <button type="button" className="button button--ghost button--small" onClick={onStart} disabled={busy}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <ShieldCheck size={14} />}
          {L("Démarrer le prototype pour un test réseau réel", "Start the prototype for a real network test")}
        </button>
      )}
    </div>
  );
}
