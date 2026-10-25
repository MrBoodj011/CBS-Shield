use serde::Serialize;

/// Serializable error returned to the React UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }

    pub fn confirmation_required(action: &str) -> Self {
        Self::new(
            "confirmationRequired",
            format!("Confirmation explicite requise pour {action}."),
        )
    }
}

impl From<cbs_core::CoreError> for CommandError {
    fn from(error: cbs_core::CoreError) -> Self {
        use cbs_core::CoreError;
        let code = match &error {
            CoreError::EngineNotFound => "engineMissing",
            CoreError::SignaturesMissing => "signaturesMissing",
            CoreError::NoTargets => "noTargets",
            CoreError::TargetNotFound(_)
            | CoreError::InvalidTarget(_)
            | CoreError::ForbiddenPath(_) => "invalidTarget",
            CoreError::Spawn(_) => "engineError",
            CoreError::Io(_) => "internal",
        };
        Self::new(code, error.to_string())
    }
}

impl From<cbs_store::StoreError> for CommandError {
    fn from(error: cbs_store::StoreError) -> Self {
        Self::new("storageError", error.to_string())
    }
}

impl From<cbs_quarantine::QuarantineError> for CommandError {
    fn from(error: cbs_quarantine::QuarantineError) -> Self {
        use cbs_quarantine::QuarantineError;
        let code = match &error {
            QuarantineError::NotFound(_) => "notFound",
            QuarantineError::AlreadyExists(_) => "alreadyExists",
            QuarantineError::TooLarge(_) => "fileTooLarge",
            QuarantineError::NotAFile(_) => "notAFile",
            QuarantineError::InvalidVault(_) | QuarantineError::Crypto(_) => "vaultError",
            QuarantineError::Io(_) => "quarantineIo",
        };
        Self::new(code, error.to_string())
    }
}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        Self::new("ioError", error.to_string())
    }
}

impl From<tauri::Error> for CommandError {
    fn from(error: tauri::Error) -> Self {
        Self::new("uiError", error.to_string())
    }
}
