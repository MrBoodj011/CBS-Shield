use super::*;

/// Non-Windows hosts (other OSes, tests/CI on foreign platforms) get an
/// explicit unsupported error rather than fabricated data.
pub fn capture_snapshot() -> Result<NetSnapshot, NetmonError> {
    Err(NetmonError::Unsupported)
}
