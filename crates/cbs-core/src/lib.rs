//! CBS Shield core: domain models, ClamAV discovery and scan orchestration.
//!
//! This crate contains no UI and no storage code. It can be reused by the Tauri
//! shell, by a future CLI, or by tests.

pub mod engine;
pub mod error;
pub mod fsutil;
pub mod model;
pub mod parser;
pub mod scan;

pub use engine::{detect_engine, locate_clamscan, locate_freshclam, EnginePaths};
pub use error::CoreError;
pub use model::{
    Detection, EngineStatus, ScanErrorRecord, ScanEvent, ScanOutcome, ScanReport, ScanRequest,
    SignatureState,
};
pub use scan::Scanner;
