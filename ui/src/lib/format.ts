const numberFormatter = new Intl.NumberFormat("fr-FR");

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return numberFormatter.format(value);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${formatNumber(bytes)} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals).replace(".", ",")} ${units[unitIndex]}`;
}

export function formatDuration(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined) return "—";
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))} ms`;
  const totalSeconds = milliseconds / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0).replace(".", ",")} s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return `${minutes} min ${seconds.toString().padStart(2, "0")} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${(minutes % 60).toString().padStart(2, "0")} min`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

const OUTCOME_LABELS: Record<string, string> = {
  clean: "Aucune menace",
  detected: "Menaces détectées",
  cancelled: "Scan annulé",
  completedWithErrors: "Terminé avec erreurs",
  failed: "Échec",
};

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome;
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

export function signatureStateLabel(state: string): string {
  switch (state) {
    case "upToDate":
      return "À jour";
    case "outdated":
      return "À mettre à jour";
    case "missing":
      return "Absentes";
    default:
      return "Inconnu";
  }
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
