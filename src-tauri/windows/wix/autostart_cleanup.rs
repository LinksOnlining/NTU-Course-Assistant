fn should_remove_owned_value(current_value: Option<&str>, expected_executable: &str) -> bool {
    let Some(current_value) = current_value else {
        return false;
    };

    let current_value = current_value.trim_end_matches(char::is_whitespace);
    let current_path = current_value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(current_value);

    current_path.eq_ignore_ascii_case(expected_executable)
}

#[cfg(test)]
mod tests {
    use super::should_remove_owned_value;

    const EXPECTED: &str = r"C:\Program Files\Links Workplace\links-workplace.exe";

    #[test]
    fn autostart_off_is_a_successful_noop() {
        assert!(!should_remove_owned_value(None, EXPECTED));
    }

    #[test]
    fn removes_the_exact_links_workplace_registration() {
        assert!(should_remove_owned_value(
            Some(r"C:\Program Files\Links Workplace\links-workplace.exe "),
            EXPECTED
        ));
    }

    #[test]
    fn removes_the_quoted_links_workplace_registration() {
        assert!(should_remove_owned_value(
            Some(r#""C:\Program Files\Links Workplace\links-workplace.exe""#),
            EXPECTED
        ));
    }

    #[test]
    fn an_absent_registration_is_idempotent() {
        assert!(!should_remove_owned_value(None, EXPECTED));
    }

    #[test]
    fn a_same_name_registration_pointing_elsewhere_is_preserved() {
        assert!(!should_remove_owned_value(
            Some(r"C:\Tools\another-app.exe"),
            EXPECTED
        ));
    }

    #[test]
    fn a_registration_owned_by_another_user_install_is_preserved() {
        assert!(!should_remove_owned_value(
            Some(r"D:\Users\Other\AppData\Local\Links Workplace\links-workplace.exe"),
            EXPECTED
        ));
    }

    #[test]
    fn removes_the_registration_even_if_the_target_executable_was_deleted() {
        // Ownership is determined by the registry data, never by target file existence.
        assert!(should_remove_owned_value(
            Some(r"C:\Program Files\Links Workplace\links-workplace.exe "),
            EXPECTED
        ));
    }

    #[test]
    fn repeated_cleanup_keeps_the_already_absent_value_absent() {
        assert!(!should_remove_owned_value(None, EXPECTED));
    }
}

#[cfg(all(windows, not(test)))]
mod windows_action {
    use super::should_remove_owned_value;
    use std::ffi::c_void;
    use std::ptr;

    type Hkey = *mut c_void;

    const HKEY_CURRENT_USER: Hkey = (-2_147_483_647isize) as Hkey;
    const KEY_QUERY_VALUE: u32 = 0x0001;
    const KEY_SET_VALUE: u32 = 0x0002;
    const KEY_WOW64_64KEY: u32 = 0x0100;
    const REG_SZ: u32 = 1;
    const ERROR_SUCCESS: u32 = 0;
    const ERROR_FILE_NOT_FOUND: u32 = 2;
    const ERROR_PATH_NOT_FOUND: u32 = 3;
    const ERROR_MORE_DATA: u32 = 234;
    const ERROR_INSTALL_FAILURE: u32 = 1603;
    const INSTALLMESSAGE_INFO: u32 = 0x0400_0000;
    const RUN_VALUE_NAME: &str = "Links Workplace";
    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(
            key: Hkey,
            sub_key: *const u16,
            options: u32,
            desired_access: u32,
            result: *mut Hkey,
        ) -> u32;
        fn RegQueryValueExW(
            key: Hkey,
            value_name: *const u16,
            reserved: *mut u32,
            value_type: *mut u32,
            data: *mut u8,
            data_size: *mut u32,
        ) -> u32;
        fn RegDeleteValueW(key: Hkey, value_name: *const u16) -> u32;
        fn RegCloseKey(key: Hkey) -> u32;
    }

    #[link(name = "msi")]
    extern "system" {
        fn MsiCreateRecord(fields: u32) -> u32;
        fn MsiRecordSetStringW(record: u32, field: u32, value: *const u16) -> u32;
        fn MsiProcessMessage(install: u32, message_type: u32, record: u32) -> i32;
        fn MsiCloseHandle(handle: u32) -> u32;
        fn MsiGetPropertyW(
            install: u32,
            name: *const u16,
            value: *mut u16,
            value_size: *mut u32,
        ) -> u32;
    }

    #[link(name = "secur32")]
    extern "system" {
        fn GetUserNameExW(name_format: u32, name_buffer: *mut u16, size: *mut u32) -> i32;
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn log_info(install: u32, message: &str) {
        let record = MsiCreateRecord(1);
        if record == 0 {
            return;
        }

        let message = wide_null(message);
        if MsiRecordSetStringW(record, 0, message.as_ptr()) == ERROR_SUCCESS {
            MsiProcessMessage(install, INSTALLMESSAGE_INFO, record);
        }
        MsiCloseHandle(record);
    }

    fn current_windows_identity() -> Result<String, u32> {
        const NAME_SAM_COMPATIBLE: u32 = 2;
        let mut buffer = [0u16; 512];
        let mut size = buffer.len() as u32;
        if unsafe { GetUserNameExW(NAME_SAM_COMPATIBLE, buffer.as_mut_ptr(), &mut size) } == 0 {
            return Err(ERROR_INSTALL_FAILURE);
        }

        let length = buffer
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(buffer.len());
        String::from_utf16(&buffer[..length]).map_err(|_| ERROR_INSTALL_FAILURE)
    }

    unsafe fn log_error(install: u32, stage: &str, status: u32) {
        log_info(
            install,
            &format!("Links Workplace autostart cleanup: {stage} failed; status={status}"),
        );
    }

    unsafe fn custom_action_data(install: u32) -> Result<String, u32> {
        let name = wide_null("CustomActionData");
        let mut size = 0;
        // MsiGetPropertyW requires a valid output buffer for its size probe.
        let mut probe = [0u16; 1];
        let first = MsiGetPropertyW(install, name.as_ptr(), probe.as_mut_ptr(), &mut size);
        if first != ERROR_MORE_DATA || size == 0 || size > 32_768 {
            log_error(install, "CustomActionData size probe", first);
            return Err(if first == ERROR_SUCCESS {
                ERROR_INSTALL_FAILURE
            } else {
                first
            });
        }

        let mut buffer = vec![0; size as usize + 1];
        let mut capacity = buffer.len() as u32;
        let status = MsiGetPropertyW(install, name.as_ptr(), buffer.as_mut_ptr(), &mut capacity);
        if status != ERROR_SUCCESS || capacity == 0 || capacity > size {
            log_error(install, "CustomActionData read", status);
            return Err(if status == ERROR_SUCCESS {
                ERROR_INSTALL_FAILURE
            } else {
                status
            });
        }

        String::from_utf16(&buffer[..capacity as usize]).map_err(|_| {
            log_error(
                install,
                "CustomActionData UTF-16 decode",
                ERROR_INSTALL_FAILURE,
            );
            ERROR_INSTALL_FAILURE
        })
    }

    unsafe fn current_run_value(key: Hkey, value_name: &[u16]) -> Result<Option<String>, u32> {
        let mut value_type = 0;
        let mut byte_count = 0;
        let status = RegQueryValueExW(
            key,
            value_name.as_ptr(),
            ptr::null_mut(),
            &mut value_type,
            ptr::null_mut(),
            &mut byte_count,
        );
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if status != ERROR_SUCCESS {
            return Err(status);
        }
        if value_type != REG_SZ || byte_count == 0 || byte_count > 65_536 || byte_count % 2 != 0 {
            return Ok(None);
        }

        let mut buffer = vec![0u16; byte_count as usize / 2];
        let status = RegQueryValueExW(
            key,
            value_name.as_ptr(),
            ptr::null_mut(),
            &mut value_type,
            buffer.as_mut_ptr().cast(),
            &mut byte_count,
        );
        if status == ERROR_FILE_NOT_FOUND || status == ERROR_MORE_DATA {
            return Ok(None);
        }
        if status != ERROR_SUCCESS || value_type != REG_SZ || byte_count % 2 != 0 {
            return Err(status);
        }

        buffer.truncate(byte_count as usize / 2);
        if let Some(end) = buffer.iter().position(|value| *value == 0) {
            buffer.truncate(end);
        }
        Ok(String::from_utf16(&buffer).ok())
    }

    unsafe fn remove_if_owned(install: u32) -> Result<(), u32> {
        let identity = current_windows_identity().map_err(|status| {
            log_error(install, "Windows identity lookup", status);
            status
        })?;
        log_info(
            install,
            &format!("Links Workplace autostart cleanup: WindowsIdentity={identity}"),
        );

        let expected_executable = custom_action_data(install)?;
        let run_key = wide_null(RUN_KEY);
        let value_name = wide_null(RUN_VALUE_NAME);
        let mut key = ptr::null_mut();
        let status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            run_key.as_ptr(),
            0,
            KEY_QUERY_VALUE | KEY_SET_VALUE | KEY_WOW64_64KEY,
            &mut key,
        );
        if status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND {
            log_info(
                install,
                "Links Workplace autostart cleanup: HKCU Run key absent; no-op",
            );
            return Ok(());
        }
        if status != ERROR_SUCCESS {
            log_error(install, "HKCU Run key open", status);
            return Err(status);
        }

        let result = (|| {
            let current = current_run_value(key, &value_name).map_err(|status| {
                log_error(install, "Links Workplace Run value read", status);
                status
            })?;
            if !should_remove_owned_value(current.as_deref(), &expected_executable) {
                log_info(
                    install,
                    "Links Workplace autostart cleanup: target value absent or not owned; unchanged",
                );
                return Ok(());
            }

            // Re-read immediately before deletion so a value changed during the first read is preserved.
            let current = current_run_value(key, &value_name).map_err(|status| {
                log_error(install, "Links Workplace Run value recheck", status);
                status
            })?;
            if !should_remove_owned_value(current.as_deref(), &expected_executable) {
                log_info(
                    install,
                    "Links Workplace autostart cleanup: target changed before deletion; unchanged",
                );
                return Ok(());
            }

            match RegDeleteValueW(key, value_name.as_ptr()) {
                ERROR_SUCCESS | ERROR_FILE_NOT_FOUND => {
                    log_info(
                        install,
                        "Links Workplace autostart cleanup: exact owned value removed",
                    );
                    Ok(())
                }
                error => {
                    log_error(install, "Links Workplace Run value deletion", error);
                    Err(error)
                }
            }
        })();

        RegCloseKey(key);
        result
    }

    #[no_mangle]
    pub extern "system" fn RemoveLinksWorkplaceAutostart(install: u32) -> u32 {
        match unsafe { remove_if_owned(install) } {
            Ok(()) => ERROR_SUCCESS,
            Err(_) => ERROR_INSTALL_FAILURE,
        }
    }
}
