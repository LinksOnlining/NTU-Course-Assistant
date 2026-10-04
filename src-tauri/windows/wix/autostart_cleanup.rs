const RUN_VALUE_NAMES: [&str; 2] = ["Links Workplace", "links-workplace"];
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

fn is_valid_windows_sid(value: &str) -> bool {
    let mut parts = value.split('-');
    matches!(parts.next(), Some("S"))
        && matches!(parts.next(), Some("1"))
        && parts.all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        && value.split('-').count() >= 4
        && value.len() <= 184
}

fn user_run_key_path(sid: &str) -> Option<String> {
    is_valid_windows_sid(sid).then(|| format!(r"{sid}\{RUN_KEY}"))
}

fn is_owned_run_value_name(value_name: &str) -> bool {
    RUN_VALUE_NAMES
        .iter()
        .any(|owned_name| value_name.eq_ignore_ascii_case(owned_name))
}

#[cfg(windows)]
fn command_line_executable(command_line: &str) -> Option<String> {
    use std::ffi::c_void;

    #[link(name = "shell32")]
    extern "system" {
        fn CommandLineToArgvW(command_line: *const u16, argc: *mut i32) -> *mut *mut u16;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }

    let command_line = command_line.trim();
    if command_line.is_empty() || command_line.contains('\0') {
        return None;
    }

    let wide: Vec<u16> = command_line
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut argc = 0;
    let argv = unsafe { CommandLineToArgvW(wide.as_ptr(), &mut argc) };
    if argv.is_null() || argc < 1 {
        if !argv.is_null() {
            unsafe { LocalFree(argv.cast()) };
        }
        return None;
    }

    let executable = unsafe {
        let first = *argv;
        if first.is_null() {
            None
        } else {
            let mut length = 0usize;
            while *first.add(length) != 0 {
                length += 1;
            }
            String::from_utf16(std::slice::from_raw_parts(first, length)).ok()
        }
    };
    unsafe { LocalFree(argv.cast()) };
    executable.filter(|path| !path.is_empty() && !path.contains('"'))
}

#[cfg(not(windows))]
fn command_line_executable(command_line: &str) -> Option<String> {
    let command_line = command_line.trim();
    if command_line.is_empty() || command_line.contains('\0') {
        return None;
    }

    let mut executable = String::new();
    let mut quoted = false;
    let mut escaped = false;
    for character in command_line.chars() {
        if escaped {
            executable.push(character);
            escaped = false;
        } else if character == '\\' {
            executable.push(character);
            escaped = true;
        } else if character == '"' {
            quoted = !quoted;
        } else if character.is_whitespace() && !quoted {
            break;
        } else {
            executable.push(character);
        }
    }

    (!quoted && !executable.is_empty() && !executable.contains('"')).then_some(executable)
}

#[cfg(windows)]
fn normalize_full_path(path: &str) -> Option<String> {
    use std::ptr;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFullPathNameW(
            file_name: *const u16,
            buffer_length: u32,
            buffer: *mut u16,
            file_part: *mut *mut u16,
        ) -> u32;
    }

    let path = trim_outer_quotes(path.trim());
    if path.is_empty() || path.contains('\0') || path.contains('"') {
        return None;
    }

    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let required = unsafe { GetFullPathNameW(wide.as_ptr(), 0, ptr::null_mut(), ptr::null_mut()) };
    if required == 0 || required > 32_768 {
        return None;
    }

    let mut buffer = vec![0u16; required as usize + 1];
    let length = unsafe {
        GetFullPathNameW(
            wide.as_ptr(),
            buffer.len() as u32,
            buffer.as_mut_ptr(),
            ptr::null_mut(),
        )
    } as usize;
    if length == 0 || length >= buffer.len() {
        return None;
    }
    String::from_utf16(&buffer[..length]).ok()
}

#[cfg(not(windows))]
fn normalize_full_path(path: &str) -> Option<String> {
    let path = trim_outer_quotes(path.trim());
    (!path.is_empty() && !path.contains('\0') && !path.contains('"'))
        .then(|| path.replace('/', "\\"))
}

fn trim_outer_quotes(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(value)
}

#[cfg(windows)]
fn paths_equal_ordinal_ignore_case(left: &str, right: &str) -> bool {
    #[link(name = "kernel32")]
    extern "system" {
        fn CompareStringOrdinal(
            string1: *const u16,
            count1: i32,
            string2: *const u16,
            count2: i32,
            ignore_case: i32,
        ) -> i32;
    }

    let left: Vec<u16> = left.encode_utf16().collect();
    let right: Vec<u16> = right.encode_utf16().collect();
    if left.len() > i32::MAX as usize || right.len() > i32::MAX as usize {
        return false;
    }
    unsafe {
        CompareStringOrdinal(
            left.as_ptr(),
            left.len() as i32,
            right.as_ptr(),
            right.len() as i32,
            1,
        ) == 2
    }
}

#[cfg(not(windows))]
fn paths_equal_ordinal_ignore_case(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn should_remove_owned_value(current_value: Option<&str>, expected_executable: &str) -> bool {
    let Some(current_value) = current_value else {
        return false;
    };
    let Some(expected_path) = normalize_full_path(expected_executable) else {
        return false;
    };

    let current_value = current_value.trim();

    // Compatibility for the exact legacy unquoted path with spaces. Do not
    // extend this exception to a prefix or to a command line with arguments.
    if normalize_full_path(current_value)
        .is_some_and(|path| paths_equal_ordinal_ignore_case(&path, &expected_path))
    {
        return true;
    }

    command_line_executable(current_value)
        .and_then(|path| normalize_full_path(&path))
        .is_some_and(|path| paths_equal_ordinal_ignore_case(&path, &expected_path))
}

#[cfg(test)]
mod tests {
    use super::{
        command_line_executable, is_owned_run_value_name, is_valid_windows_sid,
        should_remove_owned_value, user_run_key_path,
    };

    const EXPECTED: &str = r"C:\Program Files\Links Workplace\links-workplace.exe";

    #[test]
    fn autostart_off_is_a_successful_noop() {
        assert!(!should_remove_owned_value(None, EXPECTED));
    }

    #[test]
    fn removes_exact_legacy_unquoted_path_with_spaces() {
        assert!(should_remove_owned_value(
            Some(r"C:\Program Files\Links Workplace\links-workplace.exe "),
            EXPECTED
        ));
    }

    #[test]
    fn removes_quoted_executable_with_and_without_arguments() {
        assert!(should_remove_owned_value(
            Some(r#""C:\Program Files\Links Workplace\links-workplace.exe""#),
            EXPECTED
        ));
        assert!(should_remove_owned_value(
            Some(r#""C:\Program Files\Links Workplace\links-workplace.exe" --autostart"#),
            EXPECTED
        ));
    }

    #[test]
    fn removes_unquoted_executable_without_spaces_with_arguments() {
        let expected = r"C:\Links\links-workplace.exe";
        assert!(should_remove_owned_value(
            Some(r"C:\Links\links-workplace.exe --autostart"),
            expected
        ));
    }

    #[test]
    fn executable_comparison_is_case_insensitive() {
        assert!(should_remove_owned_value(
            Some(r#""c:\program files\LINKS WORKPLACE\LINKS-WORKPLACE.EXE" --quiet"#),
            EXPECTED
        ));
    }

    #[test]
    fn wrong_executables_and_similar_names_are_preserved() {
        assert!(!should_remove_owned_value(
            Some(r#""C:\Program Files\Other\other.exe""#),
            EXPECTED
        ));
        assert!(!should_remove_owned_value(
            Some(r#""C:\Program Files\Links Workplace\links-workplace.exe.fake""#),
            EXPECTED
        ));
    }

    #[test]
    fn a_links_path_used_only_as_another_exes_argument_is_preserved() {
        assert!(!should_remove_owned_value(
            Some(r#""C:\Tools\other.exe" "C:\Program Files\Links Workplace\links-workplace.exe""#),
            EXPECTED
        ));
    }

    #[test]
    fn windows_command_parser_handles_escaped_quotes_in_later_arguments() {
        assert_eq!(
            command_line_executable(
                r#""C:\Program Files\Links Workplace\links-workplace.exe" --label=\"Links Workplace\""#
            )
            .as_deref(),
            Some(EXPECTED)
        );
    }

    #[test]
    fn unquoted_legacy_path_with_extra_arguments_is_not_fuzzy_matched() {
        assert!(!should_remove_owned_value(
            Some(r"C:\Program Files\Links Workplace\links-workplace.exe --autostart"),
            EXPECTED
        ));
    }

    #[test]
    fn only_the_two_explicit_links_run_value_names_are_owned() {
        assert!(is_owned_run_value_name("Links Workplace"));
        assert!(is_owned_run_value_name("links-workplace"));
        assert!(is_owned_run_value_name("LINKS WORKPLACE"));
        assert!(!is_owned_run_value_name("Other Startup"));
        assert!(!is_owned_run_value_name("Links Workplace Helper"));
    }

    #[test]
    fn target_user_sid_is_validated_before_building_the_hku_run_path() {
        let sid = "S-1-5-21-111111111-222222222-333333333-1001";
        assert!(is_valid_windows_sid(sid));
        assert_eq!(
            user_run_key_path(sid).as_deref(),
            Some(
                r"S-1-5-21-111111111-222222222-333333333-1001\Software\Microsoft\Windows\CurrentVersion\Run"
            )
        );
        assert!(!is_valid_windows_sid("S-1-5-21-evil"));
        assert!(user_run_key_path("S-1-5-21-evil").is_none());
        assert!(!is_valid_windows_sid(""));
    }

    #[cfg(windows)]
    #[test]
    fn full_path_normalization_resolves_dot_segments() {
        assert!(should_remove_owned_value(
            Some(r#""C:\Program Files\Links Workplace\..\Links Workplace\links-workplace.exe""#),
            EXPECTED
        ));
    }
}

#[cfg(all(windows, not(test)))]
mod windows_action {
    use super::{
        is_owned_run_value_name, is_valid_windows_sid, should_remove_owned_value,
        user_run_key_path, RUN_VALUE_NAMES,
    };
    use std::ffi::c_void;
    use std::ptr;

    type Hkey = *mut c_void;

    const HKEY_USERS: Hkey = (-2_147_483_645isize) as Hkey;
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

    unsafe fn log_error(install: u32, stage: &str, status: u32) {
        log_info(
            install,
            &format!("Links Workplace autostart cleanup: {stage} failed; status={status}"),
        );
    }

    unsafe fn msi_property(install: u32, property: &str, label: &str) -> Result<String, u32> {
        let name = wide_null(property);
        let mut size = 0;
        // Keep the valid one-unit probe required by MsiGetPropertyW. In
        // particular, do not regress the 80ca1efe CustomActionData fix.
        let mut probe = [0u16; 1];
        let first = MsiGetPropertyW(install, name.as_ptr(), probe.as_mut_ptr(), &mut size);
        if first != ERROR_MORE_DATA || size == 0 || size > 32_768 {
            log_error(install, &format!("{label} size probe"), first);
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
            log_error(install, &format!("{label} read"), status);
            return Err(if status == ERROR_SUCCESS {
                ERROR_INSTALL_FAILURE
            } else {
                status
            });
        }

        let length = buffer
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(capacity as usize);
        String::from_utf16(&buffer[..length]).map_err(|_| {
            log_error(
                install,
                &format!("{label} UTF-16 decode"),
                ERROR_INSTALL_FAILURE,
            );
            ERROR_INSTALL_FAILURE
        })
    }

    unsafe fn custom_action_data(install: u32) -> Result<String, u32> {
        msi_property(install, "CustomActionData", "CustomActionData")
    }

    unsafe fn target_user_sid(install: u32) -> Result<String, u32> {
        let sid = msi_property(install, "UserSID", "UserSID")?;
        if !is_valid_windows_sid(&sid) {
            log_error(install, "UserSID validation", ERROR_INSTALL_FAILURE);
            return Err(ERROR_INSTALL_FAILURE);
        }
        Ok(sid)
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
        let sid = target_user_sid(install)?;
        let expected_executable = custom_action_data(install)?;
        let sid_key = wide_null(&sid);
        let mut user_hive = ptr::null_mut();
        let status = RegOpenKeyExW(
            HKEY_USERS,
            sid_key.as_ptr(),
            0,
            KEY_QUERY_VALUE | KEY_WOW64_64KEY,
            &mut user_hive,
        );
        if status != ERROR_SUCCESS {
            log_error(install, "target user hive open", status);
            return Err(status);
        }
        RegCloseKey(user_hive);

        let Some(run_key_path) = user_run_key_path(&sid) else {
            log_error(install, "target Run path validation", ERROR_INSTALL_FAILURE);
            return Err(ERROR_INSTALL_FAILURE);
        };
        let run_key_name = wide_null(&run_key_path);
        let mut key = ptr::null_mut();
        let status = RegOpenKeyExW(
            HKEY_USERS,
            run_key_name.as_ptr(),
            0,
            KEY_QUERY_VALUE | KEY_SET_VALUE | KEY_WOW64_64KEY,
            &mut key,
        );
        if status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND {
            log_info(
                install,
                "Links Workplace autostart cleanup: target user's Run key absent; no-op",
            );
            return Ok(());
        }
        if status != ERROR_SUCCESS {
            log_error(install, "target user's Run key open", status);
            return Err(status);
        }

        let result = (|| {
            for owned_name in RUN_VALUE_NAMES {
                if !is_owned_run_value_name(owned_name) {
                    continue;
                }
                let value_name = wide_null(owned_name);
                let current = current_run_value(key, &value_name).map_err(|status| {
                    log_error(install, "owned Run value read", status);
                    status
                })?;
                if !should_remove_owned_value(current.as_deref(), &expected_executable) {
                    continue;
                }

                // Re-read immediately before deletion so a value changed during
                // the first read is preserved.
                let current = current_run_value(key, &value_name).map_err(|status| {
                    log_error(install, "owned Run value recheck", status);
                    status
                })?;
                if !should_remove_owned_value(current.as_deref(), &expected_executable) {
                    log_info(
                        install,
                        "Links Workplace autostart cleanup: owned Run value changed before deletion; unchanged",
                    );
                    continue;
                }

                match RegDeleteValueW(key, value_name.as_ptr()) {
                    ERROR_SUCCESS | ERROR_FILE_NOT_FOUND => log_info(
                        install,
                        "Links Workplace autostart cleanup: exact owned Run value removed",
                    ),
                    error => {
                        log_error(install, "owned Run value deletion", error);
                        return Err(error);
                    }
                }
            }
            Ok(())
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
