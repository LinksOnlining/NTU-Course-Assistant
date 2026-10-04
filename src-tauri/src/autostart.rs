use tauri::AppHandle;

#[tauri::command]
pub async fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    is_enabled(&app)
}

#[tauri::command]
pub async fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    set_enabled(&app, enabled)?;
    is_enabled(&app)
}

#[cfg(target_os = "windows")]
fn is_enabled(_app: &AppHandle) -> Result<bool, String> {
    windows::has_expected_current_user_value()
}

#[cfg(not(target_os = "windows"))]
fn is_enabled(app: &AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;

    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn set_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|error| error.to_string())?;
        windows::quote_current_user_value()
    } else {
        manager.disable().map_err(|error| error.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn set_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|error| error.to_string())
    } else {
        manager.disable().map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::{ffi::c_void, ptr, slice};

    use std::io::ErrorKind;

    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_READ},
        RegKey,
    };

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const RUN_VALUE_NAME: &str = "Links Workplace";

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn CommandLineToArgvW(command_line: *const u16, argument_count: *mut i32) -> *mut *mut u16;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
        fn CompareStringOrdinal(
            string1: *const u16,
            count1: i32,
            string2: *const u16,
            count2: i32,
            ignore_case: i32,
        ) -> i32;
        fn GetFullPathNameW(
            file_name: *const u16,
            buffer_length: u32,
            buffer: *mut u16,
            file_part: *mut *mut u16,
        ) -> u32;
    }

    struct LocalAllocation(*mut c_void);

    impl Drop for LocalAllocation {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: CommandLineToArgvW allocated this block with LocalAlloc semantics.
                unsafe { LocalFree(self.0) };
            }
        }
    }

    fn current_executable() -> Result<String, String> {
        let path = std::env::current_exe().map_err(|error| error.to_string())?;
        path.to_str()
            .map(str::to_owned)
            .ok_or_else(|| "Links executable path is not valid Unicode.".to_owned())
    }

    fn quoted_run_value(executable: &str) -> String {
        format!("\"{executable}\"")
    }

    fn is_expected_run_value(value: &str, executable: &str) -> bool {
        let Some(actual_executable) = first_argument(value) else {
            return false;
        };
        let Some(actual_full_path) = full_path(&actual_executable) else {
            return false;
        };
        let Some(expected_full_path) = full_path(executable) else {
            return false;
        };

        ordinal_ignore_case_equal(&actual_full_path, &expected_full_path)
    }

    fn ordinal_ignore_case_equal(left: &str, right: &str) -> bool {
        let left: Vec<u16> = left.encode_utf16().collect();
        let right: Vec<u16> = right.encode_utf16().collect();
        if left.len() > i32::MAX as usize || right.len() > i32::MAX as usize {
            return false;
        }

        // SAFETY: both slices remain alive and their lengths fit the API's signed counts.
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

    fn first_argument(command_line: &str) -> Option<String> {
        let command_line = command_line.trim();
        if command_line.is_empty() || command_line.contains('\0') {
            return None;
        }

        let mut wide_command_line: Vec<u16> = command_line.encode_utf16().collect();
        wide_command_line.push(0);
        let mut argument_count = 0;
        // SAFETY: wide_command_line is null-terminated and argument_count points to writable memory.
        let arguments = unsafe {
            CommandLineToArgvW(wide_command_line.as_ptr(), &mut argument_count as *mut i32)
        };
        if arguments.is_null() {
            return None;
        }

        let _allocation = LocalAllocation(arguments.cast());
        if argument_count < 1 {
            return None;
        }
        // SAFETY: CommandLineToArgvW returned an array with argument_count valid entries.
        let first = unsafe { *arguments };
        if first.is_null() {
            return None;
        }

        let mut length = 0;
        // SAFETY: each argv entry is a null-terminated UTF-16 string owned by the returned block.
        while unsafe { *first.add(length) } != 0 {
            length += 1;
        }
        // SAFETY: the previous loop established the string length before the null terminator.
        let first_argument = unsafe { slice::from_raw_parts(first, length) };
        String::from_utf16(first_argument).ok()
    }

    fn full_path(path: &str) -> Option<String> {
        let path = path.trim().trim_matches('"').trim();
        if path.is_empty() || path.contains('\0') {
            return None;
        }

        let mut wide_path: Vec<u16> = path.encode_utf16().collect();
        wide_path.push(0);
        let mut buffer = vec![0_u16; 32_768];
        // SAFETY: both buffers are valid for their declared lengths; file_part is not requested.
        let length = unsafe {
            GetFullPathNameW(
                wide_path.as_ptr(),
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

    pub(super) fn has_expected_current_user_value() -> Result<bool, String> {
        let executable = current_executable()?;
        let run_key =
            match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_READ) {
                Ok(key) => key,
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
                Err(error) => return Err(error.to_string()),
            };
        let value: String = match run_key.get_value(RUN_VALUE_NAME) {
            Ok(value) => value,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };

        Ok(is_expected_run_value(&value, &executable))
    }

    pub(super) fn quote_current_user_value() -> Result<(), String> {
        let value = quoted_run_value(&current_executable()?);
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(RUN_KEY)
            .map_err(|error| error.to_string())?;
        key.set_value(RUN_VALUE_NAME, &value)
            .map_err(|error| error.to_string())
    }

    #[cfg(test)]
    mod tests {
        use super::{first_argument, is_expected_run_value, quoted_run_value};

        const EXECUTABLE: &str = r"C:\Program Files\Links Workplace\links-workplace.exe";

        #[test]
        fn quotes_executable_paths_containing_spaces() {
            assert_eq!(
                quoted_run_value(r"C:\Program Files\Links Workplace\links-workplace.exe"),
                r#""C:\Program Files\Links Workplace\links-workplace.exe""#
            );
        }

        #[test]
        fn only_the_exact_quoted_executable_is_enabled() {
            assert!(is_expected_run_value(
                r#""C:\Program Files\Links Workplace\links-workplace.exe""#,
                EXECUTABLE
            ));
            assert!(is_expected_run_value(
                r#""c:\program files\links workplace\links-workplace.exe""#,
                EXECUTABLE
            ));
            assert!(!is_expected_run_value(EXECUTABLE, EXECUTABLE));
            assert!(!is_expected_run_value(
                &format!("{EXECUTABLE}.fake"),
                EXECUTABLE
            ));
        }

        #[test]
        fn accepts_quoted_executable_with_legal_arguments() {
            assert!(is_expected_run_value(
                r#""C:\Program Files\Links Workplace\links-workplace.exe" --background"#,
                EXECUTABLE
            ));
            assert!(is_expected_run_value(
                r#""C:\Program Files\Links Workplace\.\links-workplace.exe" --background"#,
                EXECUTABLE
            ));
        }

        #[test]
        fn accepts_unquoted_executable_without_spaces() {
            let executable = r"C:\Links\links-workplace.exe";
            assert!(is_expected_run_value(executable, executable));
        }

        #[test]
        fn rejects_unquoted_executable_with_spaces() {
            assert!(!is_expected_run_value(EXECUTABLE, EXECUTABLE));
        }

        #[test]
        fn rejects_wrong_executable_and_executable_lookalikes() {
            assert!(!is_expected_run_value(
                r#""C:\Other\other.exe""#,
                EXECUTABLE
            ));
            assert!(!is_expected_run_value(
                r#""C:\Program Files\Links Workplace\links-workplace.exe.fake""#,
                EXECUTABLE
            ));
        }

        #[test]
        fn does_not_accept_links_path_only_as_an_argument() {
            assert!(!is_expected_run_value(
                r#""C:\Other\other.exe" "C:\Program Files\Links Workplace\links-workplace.exe""#,
                EXECUTABLE
            ));
        }

        #[test]
        fn native_parser_handles_spaces_and_escaped_quotes_in_arguments() {
            assert_eq!(
                first_argument(
                    r#""C:\Program Files\Links Workplace\links-workplace.exe" --label "Links \"Workplace\"""#
                ),
                Some(EXECUTABLE.to_owned())
            );
            assert!(is_expected_run_value(
                r#""C:\Program Files\Links Workplace\links-workplace.exe" --label "Links \"Workplace\"""#,
                EXECUTABLE
            ));
            assert!(!is_expected_run_value(
                r#"\"C:\Program Files\Links Workplace\links-workplace.exe\""#,
                EXECUTABLE
            ));
        }
    }
}
