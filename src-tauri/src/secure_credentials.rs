//! Shared adapter for the operating-system credential vault.
//! Secrets are addressed by service/account and are never returned to UI status calls.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CredentialError {
    Unavailable,
}

#[cfg(target_os = "windows")]
pub(crate) fn set(service: &str, account: &str, secret: &str) -> Result<(), CredentialError> {
    keyring::Entry::new(service, account)
        .map_err(|_| CredentialError::Unavailable)?
        .set_password(secret)
        .map_err(|_| CredentialError::Unavailable)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn set(_service: &str, _account: &str, _secret: &str) -> Result<(), CredentialError> {
    Err(CredentialError::Unavailable)
}

#[cfg(target_os = "windows")]
pub(crate) fn get(service: &str, account: &str) -> Result<Option<String>, CredentialError> {
    match keyring::Entry::new(service, account)
        .map_err(|_| CredentialError::Unavailable)?
        .get_password()
    {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(CredentialError::Unavailable),
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn get(_service: &str, _account: &str) -> Result<Option<String>, CredentialError> {
    Err(CredentialError::Unavailable)
}

#[cfg(target_os = "windows")]
pub(crate) fn delete(service: &str, account: &str) -> Result<(), CredentialError> {
    match keyring::Entry::new(service, account)
        .map_err(|_| CredentialError::Unavailable)?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(CredentialError::Unavailable),
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn delete(_service: &str, _account: &str) -> Result<(), CredentialError> {
    Err(CredentialError::Unavailable)
}
