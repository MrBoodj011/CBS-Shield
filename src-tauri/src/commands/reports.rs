//! Scan report export. The destination path is chosen by the user through the
//! native save dialog; the backend only serializes data already in the local
//! history database.

use cbs_store::{ScanDetails, StoredDetection};
use serde::Serialize;
use tauri::State;

use crate::error::CommandError;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub format: String,
    pub bytes: usize,
}

#[tauri::command]
pub fn export_scan_report(
    state: State<'_, AppState>,
    scan_id: i64,
    format: String,
    path: String,
) -> Result<ExportResult, CommandError> {
    let details = state
        .store
        .get_scan(scan_id)?
        .ok_or_else(|| CommandError::new("scanNotFound", "Ce rapport de scan est introuvable."))?;
    let content = render_export(&details, &format)?;
    let target = std::path::PathBuf::from(&path);
    if target.is_dir() {
        return Err(CommandError::new(
            "invalidExportPath",
            "La destination est un dossier, pas un fichier.",
        ));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(CommandError::new(
                "invalidExportPath",
                "Le dossier de destination est introuvable.",
            ));
        }
    }
    std::fs::write(&target, content.as_bytes()).map_err(|err| {
        CommandError::new(
            "exportFailed",
            format!("Impossible d'écrire le rapport : {err}"),
        )
    })?;
    Ok(ExportResult {
        path: target.display().to_string(),
        format,
        bytes: content.len(),
    })
}

pub fn render_export(details: &ScanDetails, format: &str) -> Result<String, CommandError> {
    match format {
        "json" => render_json(details),
        "csv" => Ok(render_csv(details)),
        "md" => Ok(render_markdown(details)),
        "txt" => Ok(render_text(details)),
        _ => Err(CommandError::new(
            "unsupportedFormat",
            "Format d'export non pris en charge (json, csv, md ou txt).",
        )),
    }
}

fn render_json(details: &ScanDetails) -> Result<String, CommandError> {
    #[derive(Serialize)]
    struct Payload<'a> {
        product: &'static str,
        version: &'static str,
        exported_at: String,
        scan: &'a cbs_store::ScanRecord,
        detections: &'a [StoredDetection],
    }
    let payload = Payload {
        product: "CBS Shield",
        version: env!("CARGO_PKG_VERSION"),
        exported_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        scan: &details.scan,
        detections: &details.detections,
    };
    serde_json::to_string_pretty(&payload)
        .map_err(|err| CommandError::internal(format!("sérialisation impossible : {err}")))
}

fn render_csv(details: &ScanDetails) -> String {
    let scan = &details.scan;
    let mut out = String::from(
        "scan_id,uuid,started_at,finished_at,duration_ms,outcome,row_type,path,threat,size_bytes,sha256,message\n",
    );
    for detection in &details.detections {
        out.push_str(&format!(
            "{},{},{},{},{},{},detection,{},{},{},{},\n",
            scan.id,
            csv_field(&scan.uuid),
            csv_field(&scan.started_at),
            csv_field(&scan.finished_at),
            scan.duration_ms,
            csv_field(&scan.outcome),
            csv_field(&detection.file_path),
            csv_field(&detection.threat_name),
            detection
                .file_size_bytes
                .map(|value| value.to_string())
                .unwrap_or_default(),
            csv_field(detection.sha256.as_deref().unwrap_or("")),
        ));
    }
    if let Some(fatal) = &scan.fatal_error {
        out.push_str(&format!(
            "{},{},{},{},{},{},error,,,,,{}\n",
            scan.id,
            csv_field(&scan.uuid),
            csv_field(&scan.started_at),
            csv_field(&scan.finished_at),
            scan.duration_ms,
            csv_field(&scan.outcome),
            csv_field(fatal),
        ));
    }
    out
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn render_markdown(details: &ScanDetails) -> String {
    let scan = &details.scan;
    let mut out = String::new();
    out.push_str("# CBS Shield — Rapport de scan\n\n");
    out.push_str(&format!("- **Identifiant** : `{}`\n", scan.uuid));
    out.push_str(&format!("- **Début** : {}\n", scan.started_at));
    out.push_str(&format!("- **Fin** : {}\n", scan.finished_at));
    out.push_str(&format!("- **Durée** : {} ms\n", scan.duration_ms));
    out.push_str(&format!("- **Résultat** : {}\n", scan.outcome));
    out.push_str(&format!(
        "- **Fichiers analysés** : {}\n",
        scan.files_scanned
    ));
    out.push_str(&format!("- **Menaces** : {}\n", scan.infected_files));
    out.push_str(&format!("- **Erreurs** : {}\n", scan.error_count));
    if let Some(version) = &scan.engine_version {
        out.push_str(&format!("- **Moteur ClamAV** : {version}\n"));
    }
    if let Some(version) = &scan.signature_version {
        out.push_str(&format!("- **Version des signatures (CVD)** : {version}\n"));
    }
    out.push_str("\n## Cibles\n\n");
    for target in &scan.targets {
        out.push_str(&format!("- `{}`\n", md_escape(target)));
    }
    out.push_str("\n## Détections\n\n");
    if details.detections.is_empty() {
        out.push_str("Aucune.\n");
    } else {
        out.push_str("| Fichier | Menace | Taille | SHA-256 |\n|---|---|---|---|\n");
        for detection in &details.detections {
            out.push_str(&format!(
                "| `{}` | {} | {} | `{}` |\n",
                md_escape(&detection.file_path),
                md_escape(&detection.threat_name),
                detection
                    .file_size_bytes
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "—".to_string()),
                detection.sha256.as_deref().unwrap_or("—"),
            ));
        }
    }
    if let Some(fatal) = &scan.fatal_error {
        out.push_str(&format!("\n## Erreur fatale\n\n{}\n", fatal));
    }
    out.push_str("\n> CBS Shield est un scanner manuel à la demande. Il ne remplace pas Microsoft Defender.\n");
    out
}

fn render_text(details: &ScanDetails) -> String {
    let scan = &details.scan;
    let mut out = String::new();
    out.push_str("CBS Shield — Rapport de scan\n");
    out.push_str("============================\n\n");
    out.push_str(&format!("Identifiant : {}\n", scan.uuid));
    out.push_str(&format!("Début       : {}\n", scan.started_at));
    out.push_str(&format!("Fin         : {}\n", scan.finished_at));
    out.push_str(&format!("Durée       : {} ms\n", scan.duration_ms));
    out.push_str(&format!("Résultat    : {}\n", scan.outcome));
    out.push_str(&format!("Fichiers    : {}\n", scan.files_scanned));
    out.push_str(&format!("Menaces     : {}\n", scan.infected_files));
    out.push_str(&format!("Erreurs     : {}\n", scan.error_count));
    out.push_str("\nCibles :\n");
    for target in &scan.targets {
        out.push_str(&format!("  - {target}\n"));
    }
    out.push_str("\nDétections :\n");
    if details.detections.is_empty() {
        out.push_str("  Aucune\n");
    } else {
        for detection in &details.detections {
            out.push_str(&format!(
                "  - {} | {} | SHA-256 {}\n",
                detection.file_path,
                detection.threat_name,
                detection.sha256.as_deref().unwrap_or("indisponible")
            ));
        }
    }
    if let Some(fatal) = &scan.fatal_error {
        out.push_str(&format!("\nErreur fatale : {fatal}\n"));
    }
    out.push_str("\nCBS Shield est un scanner manuel à la demande.\n");
    out
}

fn md_escape(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_quotes_commas_and_quotes() {
        assert_eq!(csv_field("plain"), "plain");
        assert_eq!(csv_field("a,b"), "\"a,b\"");
        assert_eq!(csv_field("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn rejects_unknown_export_format() {
        let details = ScanDetails {
            scan: cbs_store::ScanRecord {
                id: 1,
                uuid: "u".into(),
                started_at: "s".into(),
                finished_at: "f".into(),
                duration_ms: 1,
                targets: vec![],
                files_scanned: 0,
                infected_files: 0,
                error_count: 0,
                outcome: "clean".into(),
                cancelled: false,
                engine_version: None,
                signature_version: None,
                fatal_error: None,
            },
            detections: vec![],
        };
        assert!(render_export(&details, "pdf").is_err());
    }

    #[test]
    fn markdown_lists_detections_and_targets() {
        let details = ScanDetails {
            scan: cbs_store::ScanRecord {
                id: 2,
                uuid: "abc".into(),
                started_at: "2026-10-26T10:00:00Z".into(),
                finished_at: "2026-10-26T10:01:00Z".into(),
                duration_ms: 60_000,
                targets: vec!["C:\\samples".into()],
                files_scanned: 4,
                infected_files: 1,
                error_count: 0,
                outcome: "detected".into(),
                cancelled: false,
                engine_version: Some("1.5.4".into()),
                signature_version: Some("28164".into()),
                fatal_error: None,
            },
            detections: vec![StoredDetection {
                id: 1,
                scan_id: 2,
                file_path: "C:\\samples\\eicar.com".into(),
                threat_name: "Eicar-Test-Signature".into(),
                file_size_bytes: Some(68),
                sha256: Some("abc123".into()),
            }],
        };
        let markdown = render_export(&details, "md").unwrap();
        assert!(markdown.contains("Eicar-Test-Signature"));
        assert!(markdown.contains("C:\\samples"));
        assert!(markdown.contains("CVD"));
    }
}
