//! Protection of the quarantine encryption key.
//!
//! On Windows the key is protected with DPAPI scoped to the current user, so a
//! copied vault (blobs + key file) cannot be decrypted by another account or on
//! another machine. On other platforms (tests/CI only) the key file itself is
//! the secret and receives owner-only permissions.

use crate::QuarantineError;

#[cfg(windows)]
pub fn protect(data: &[u8]) -> Result<Vec<u8>, QuarantineError> {
    dpapi_call(data, true)
}

#[cfg(windows)]
pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, QuarantineError> {
    dpapi_call(data, false)
}

#[cfg(windows)]
fn dpapi_call(data: &[u8], protect: bool) -> Result<Vec<u8>, QuarantineError> {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    // CRYPTPROTECT_UI_FORBIDDEN: never show a UI prompt from a background command.
    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        if protect {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null::<c_void>(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null::<c_void>(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };

    if ok == 0 {
        return Err(QuarantineError::Crypto(format!(
            "DPAPI a refusé l'opération : {}",
            std::io::Error::last_os_error()
        )));
    }

    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut c_void);
    }
    Ok(result)
}

#[cfg(not(windows))]
pub fn protect(data: &[u8]) -> Result<Vec<u8>, QuarantineError> {
    Ok(data.to_vec())
}

#[cfg(not(windows))]
pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, QuarantineError> {
    Ok(data.to_vec())
}
