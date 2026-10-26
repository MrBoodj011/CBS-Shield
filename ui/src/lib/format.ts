let currentLanguage: "fr" | "en" = "fr";

/** Called by the i18n provider so every formatter follows the active language. */
export function setFormatLanguage(language: string): void {
  currentLanguage = language === "en" ? "en" : "fr";
}

function locale(): string {
  return currentLanguage === "en" ? "en-US" : "fr-FR";
}

function numberFormatter(): Intl.NumberFormat {
  return new Intl.NumberFormat(locale());
}

function decimal(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(locale(), {
    maximumFractionDigits,
  }).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return numberFormatter().format(value);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  const byteUnit = currentLanguage === "en" ? "B" : "o";
  if (bytes < 1024) return `${formatNumber(bytes)} ${byteUnit}`;
  const units =
    currentLanguage === "en"
      ? ["KB", "MB", "GB", "TB"]
      : ["Ko", "Mo", "Go", "To"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${decimal(value, decimals)} ${units[unitIndex]}`;
}

export function formatDuration(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined) return "—";
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))} ms`;
  const totalSeconds = milliseconds / 1000;
  if (totalSeconds < 60) {
    return `${decimal(totalSeconds, totalSeconds < 10 ? 1 : 0)} s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) {
    return `${minutes} min ${seconds.toString().padStart(2, "0")} s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${(minutes % 60).toString().padStart(2, "0")} min`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(date);
}

const OUTCOME_LABELS: Record<string, { fr: string; en: string }> = {
  clean: { fr: "Aucune menace", en: "No threat" },
  detected: { fr: "Menaces détectées", en: "Threats detected" },
  cancelled: { fr: "Scan annulé", en: "Scan cancelled" },
  completedWithErrors: {
    fr: "Terminé avec erreurs",
    en: "Completed with errors",
  },
  failed: { fr: "Échec", en: "Failed" },
};

export function outcomeLabel(outcome: string): string {
  const label = OUTCOME_LABELS[outcome];
  if (!label) return outcome;
  return label[currentLanguage];
}

export type Tone = "ok" | "warning" | "danger" | "neutral" | "info";

export function outcomeTone(outcome: string): Tone {
  switch (outcome) {
    case "clean":
      return "ok";
    case "detected":
      return "danger";
    case "cancelled":
      return "neutral";
    case "completedWithErrors":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

const SIGNATURE_STATE_LABELS: Record<string, { fr: string; en: string }> = {
  upToDate: { fr: "À jour", en: "Up to date" },
  outdated: { fr: "À mettre à jour", en: "Outdated" },
  missing: { fr: "Absentes", en: "Missing" },
  unknown: { fr: "Inconnu", en: "Unknown" },
};

export function signatureStateLabel(state: string): string {
  return SIGNATURE_STATE_LABELS[state]?.[currentLanguage] ?? state;
}

export function signatureStateTone(state: string): Tone {
  switch (state) {
    case "upToDate":
      return "ok";
    case "outdated":
      return "warning";
    case "missing":
      return "danger";
    default:
      return "neutral";
  }
}

const PROFILE_LABELS: Record<string, { fr: string; en: string }> = {
  quick: { fr: "Analyse rapide", en: "Quick scan" },
  full: { fr: "Analyse complète", en: "Full scan" },
  custom: { fr: "Analyse personnalisée", en: "Custom scan" },
};

export function profileLabel(profile: string | null | undefined): string {
  if (!profile) return "—";
  return PROFILE_LABELS[profile]?.[currentLanguage] ?? profile;
}

/**
 * Localized explanation of the engine freshness. The backend also returns a
 * French `message`, but it is only used for hard errors; this text follows the
 * interface language and never invents a signature count.
 */
export function freshnessText(
  state: string,
  ageDays: number | null | undefined,
  thresholdDays: number | null | undefined,
): string {
  const age = ageDays ?? null;
  const threshold = thresholdDays ?? null;
  if (state === "upToDate") {
    const ageText =
      age === 0
        ? currentLanguage === "en"
          ? "less than a day"
          : "moins d'un jour"
        : currentLanguage === "en"
          ? `${age ?? "—"} day(s)`
          : `${age ?? "—"} jour(s)`;
    return currentLanguage === "en"
      ? `Signatures up to date (age: ${ageText}, threshold: ${threshold ?? "—"} day(s)).`
      : `Signatures à jour (âge : ${ageText}, seuil : ${threshold ?? "—"} jour(s)).`;
  }
  if (state === "outdated") {
    return currentLanguage === "en"
      ? `Signatures are ${age ?? "—"} day(s) old (threshold: ${threshold ?? "—"} day(s)). Scanning remains available.`
      : `Signatures âgées de ${age ?? "—"} jour(s) (seuil : ${threshold ?? "—"} jour(s)). L'analyse reste possible.`;
  }
  if (state === "missing") {
    return currentLanguage === "en"
      ? "No usable ClamAV signature database was found."
      : "Aucune base de signatures ClamAV exploitable n'a été trouvée.";
  }
  return currentLanguage === "en"
    ? "The signature state could not be determined."
    : "L'état des signatures n'a pas pu être déterminé.";
}

export function truncateMiddle(value: string, max = 64): string {
  if (value.length <= max) return value;
  const left = Math.floor((max - 1) / 2);
  const right = max - 1 - left;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return hash.length > 16 ? `${hash.slice(0, 12)}…${hash.slice(-4)}` : hash;
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

export function fileBaseName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
