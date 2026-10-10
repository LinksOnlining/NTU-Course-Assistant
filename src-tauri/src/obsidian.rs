//! Obsidian integration is a launcher only. It never opens or writes vault contents.
use serde::Deserialize;
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Deserialize)]
struct VaultRecord {
    path: String,
    #[serde(default)]
    open: bool,
    #[serde(default)]
    ts: u64,
}

#[derive(Deserialize)]
struct ObsidianConfig {
    vaults: HashMap<String, VaultRecord>,
}

fn active_vault() -> Result<(String, PathBuf), String> {
    let appdata = env::var_os("APPDATA").ok_or("无法定位 Windows 应用配置目录。")?;
    let contents = fs::read(Path::new(&appdata).join("obsidian").join("obsidian.json"))
        .map_err(|_| "未找到 Obsidian 的知识库配置。请先启动 Obsidian 并打开知识库。")?;
    let config: ObsidianConfig =
        serde_json::from_slice(&contents).map_err(|_| "Obsidian 的知识库配置无法解析。")?;
    let active = config
        .vaults
        .values()
        .filter(|record| {
            let path = Path::new(&record.path);
            path.is_dir() && path.join(".obsidian").is_dir()
        })
        .max_by_key(|record| (record.open, record.ts))
        .ok_or("未找到可访问的 Obsidian 知识库。请先在 Obsidian 中打开知识库。")?;
    let path = PathBuf::from(&active.path);
    let name = path
        .file_name()
        .and_then(|part| part.to_str())
        .filter(|name| !name.is_empty())
        .ok_or("Obsidian 知识库名称无效。")?;
    Ok((name.to_string(), path))
}

/// Percent-encode every non-RFC3986 unreserved UTF-8 byte. No user input enters a shell.
fn url_component(value: &str) -> String {
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            result.push(char::from(byte));
        } else {
            result.push_str(&format!("%{byte:02X}"));
        }
    }
    result
}

fn action_uri(action: &str, vault: &str, has_inbox: bool) -> Result<String, String> {
    let vault = url_component(vault);
    match action {
        "vault" => Ok(format!("obsidian://open?vault={vault}")),
        "daily" => Ok(format!("obsidian://daily?vault={vault}")),
        "inbox" if has_inbox => {
            let query = url_component("path:\"00 收集箱\"");
            Ok(format!("obsidian://search?vault={vault}&query={query}"))
        }
        "inbox" => Err("知识库中未找到「00 收集箱」文件夹，请在 Obsidian 中确认目录。".into()),
        _ => Err("不支持的 Obsidian 操作。".into()),
    }
}

#[tauri::command]
pub fn get_obsidian_vault() -> Result<String, String> {
    active_vault().map(|(name, _)| name)
}

#[tauri::command]
pub fn open_obsidian(action: String) -> Result<(), String> {
    let (vault, path) = active_vault()?;
    let uri = action_uri(&action, &vault, path.join("00 收集箱").is_dir())?;
    // explorer.exe delegates the registered obsidian:// scheme to Windows.
    // The argument is a single fixed-scheme URI, never interpolated into a shell command.
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(uri)
            .spawn()
            .map_err(|_| "无法打开 Obsidian。请检查 Obsidian 是否已安装并注册链接协议。")?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = uri;
        Err("当前仅支持 Windows 上启动 Obsidian。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{action_uri, url_component};

    #[test]
    fn obsidian_urls_are_encoded_and_actions_are_restricted() {
        assert_eq!(
            action_uri("vault", "My Vault", false).unwrap(),
            "obsidian://open?vault=My%20Vault"
        );
        assert_eq!(
            action_uri("daily", "笔记 库", false).unwrap(),
            "obsidian://daily?vault=%E7%AC%94%E8%AE%B0%20%E5%BA%93"
        );
        assert!(action_uri("inbox", "First", false).is_err());
        let inbox = action_uri("inbox", "First", true).unwrap();
        assert!(inbox.starts_with("obsidian://search?vault=First&query="));
        assert!(inbox.contains("path%3A%2200%20"));
        assert!(action_uri("open:evil", "First", true).is_err());
        assert_eq!(url_component("a&b?"), "a%26b%3F");
    }
}
