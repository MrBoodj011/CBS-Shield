//! Small filesystem helpers shared by the scanner and the desktop shell.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

/// Stream a file through SHA-256 and return `(size, lowercase hex digest)`.
pub fn sha256_file(path: &Path) -> std::io::Result<(u64, String)> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut size = 0u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size += read as u64;
        hasher.update(&buffer[..read]);
    }
    Ok((size, format!("{:x}", hasher.finalize())))
}

/// Absolute path of a tool shipped in the Windows system directory
/// (`C:\Windows\System32\<relative>`), resolved with `GetSystemDirectoryW`.
///
/// Launching helpers by bare name (`sc`, `curl.exe`, ...) lets Windows search
/// the application directory and the current directory first, so a planted
/// binary next to a per-user install could be executed instead. Off Windows,
/// or if the API fails, the bare name is returned unchanged.
pub fn system_tool(relative: &str) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        if let Some(dir) = windows_dir(true) {
            return dir.join(relative);
        }
    }
    std::path::PathBuf::from(relative)
}

/// Absolute path of a tool in the Windows directory itself (`explorer.exe`).
pub fn windows_tool(relative: &str) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        if let Some(dir) = windows_dir(false) {
            return dir.join(relative);
        }
    }
    std::path::PathBuf::from(relative)
}

#[cfg(windows)]
fn windows_dir(system: bool) -> Option<std::path::PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::SystemInformation::{
        GetSystemDirectoryW, GetSystemWindowsDirectoryW,
    };
    let mut buffer = [0u16; 520];
    // SAFETY: the buffer pointer and its length in u16 units are valid for
    // the duration of the call; the API writes at most `len` units.
    let written = unsafe {
        if system {
            GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32)
        } else {
            GetSystemWindowsDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32)
        }
    } as usize;
    if written == 0 || written >= buffer.len() {
        return None;
    }
    Some(std::path::PathBuf::from(std::ffi::OsString::from_wide(
        &buffer[..written],
    )))
}

#[cfg(all(test, windows))]
mod system_tool_tests {
    use super::{system_tool, windows_tool};

    #[test]
    fn system_tools_resolve_to_absolute_existing_paths() {
        let sc = system_tool("sc.exe");
        assert!(sc.is_absolute(), "{sc:?}");
        assert!(sc.is_file(), "{sc:?}");
        let explorer = windows_tool("explorer.exe");
        assert!(explorer.is_absolute(), "{explorer:?}");
        assert!(explorer.is_file(), "{explorer:?}");
    }
}
