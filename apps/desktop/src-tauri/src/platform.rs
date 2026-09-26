use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum DevicePlatform {
    Macos,
    Windows,
    Linux,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DeviceIdentity {
    pub raw: String,
    pub hashed: String,
    pub platform: DevicePlatform,
}

fn validate_storage_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 128 {
        return Err("storage key must contain 1-128 characters".into());
    }
    let mut chars = key.chars();
    let first = chars.next().expect("non-empty key checked above");
    if !first.is_ascii_alphanumeric() {
        return Err("storage key must start with an ASCII letter or digit".into());
    }
    if !chars
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'))
    {
        return Err("storage key contains an unsupported character".into());
    }
    if key.contains("..") {
        return Err("storage key must not contain '..'".into());
    }
    Ok(())
}

fn storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve application data directory: {error}"))?
        .join("storage");
    fs::create_dir_all(&root)
        .map_err(|error| format!("cannot create application storage directory: {error}"))?;
    Ok(root)
}

#[tauri::command]
pub fn platform_data_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| format!("cannot resolve application data directory: {error}"))
}

#[tauri::command]
pub fn storage_read(app: AppHandle, key: String) -> Result<Option<String>, String> {
    validate_storage_key(&key)?;
    let path = storage_root(&app)?.join(key);
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("cannot read local storage: {error}")),
    }
}

#[tauri::command]
pub fn storage_write(app: AppHandle, key: String, value: String) -> Result<(), String> {
    validate_storage_key(&key)?;
    let path = storage_root(&app)?.join(key);
    fs::write(path, value).map_err(|error| format!("cannot write local storage: {error}"))
}

fn parse_ioreg_platform_uuid(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let marker = "\"IOPlatformUUID\" = \"";
        let start = line.find(marker)? + marker.len();
        let rest = &line[start..];
        let end = rest.find('"')?;
        let value = &rest[..end];
        (!value.is_empty()).then(|| value.to_string())
    })
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_windows_machine_guid(output: &str) -> Option<String> {
    output
        .lines()
        .find(|line| line.to_ascii_lowercase().contains("machineguid"))
        .and_then(|line| line.split_whitespace().last())
        .map(ToOwned::to_owned)
}

#[cfg(target_os = "macos")]
fn raw_machine_id() -> Result<(String, DevicePlatform), String> {
    let output = Command::new("/usr/sbin/ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .map_err(|error| format!("cannot read macOS hardware identity: {error}"))?;
    if !output.status.success() {
        return Err(format!("ioreg exited with status {}", output.status));
    }
    parse_ioreg_platform_uuid(&String::from_utf8_lossy(&output.stdout))
        .map(|raw| (raw, DevicePlatform::Macos))
        .ok_or_else(|| "macOS hardware identity did not contain IOPlatformUUID".into())
}

#[cfg(target_os = "windows")]
fn raw_machine_id() -> Result<(String, DevicePlatform), String> {
    let output = Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .map_err(|error| format!("cannot read Windows hardware identity: {error}"))?;
    if !output.status.success() {
        return Err(format!("reg exited with status {}", output.status));
    }
    parse_windows_machine_guid(&String::from_utf8_lossy(&output.stdout))
        .map(|raw| (raw, DevicePlatform::Windows))
        .ok_or_else(|| "Windows hardware identity did not contain MachineGuid".into())
}

#[cfg(target_os = "linux")]
fn raw_machine_id() -> Result<(String, DevicePlatform), String> {
    for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(raw) = fs::read_to_string(path) {
            let raw = raw.trim();
            if !raw.is_empty() {
                return Ok((raw.to_string(), DevicePlatform::Linux));
            }
        }
    }
    Err("Linux machine-id was not available".into())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn raw_machine_id() -> Result<(String, DevicePlatform), String> {
    Ok((Uuid::new_v4().simple().to_string(), DevicePlatform::Unknown))
}

fn read_salt(path: &Path) -> io::Result<String> {
    let existing = fs::read_to_string(path)?;
    let value = existing.trim();
    if value.len() < 32 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "device salt is too short",
        ));
    }
    Ok(value.to_string())
}

fn load_or_create_salt(path: &Path) -> Result<String, String> {
    match read_salt(path) {
        Ok(value) => return Ok(value),
        Err(error) if error.kind() != io::ErrorKind::NotFound => {
            return Err(format!("cannot read device salt: {error}"))
        }
        Err(_) => {}
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create device identity directory: {error}"))?;
    }
    let generated = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => {
            file.write_all(generated.as_bytes())
                .map_err(|error| format!("cannot persist device salt: {error}"))?;
            Ok(generated)
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            read_salt(path).map_err(|read_error| format!("cannot read device salt: {read_error}"))
        }
        Err(error) => Err(format!("cannot persist device salt: {error}")),
    }
}

fn hash_identity(raw: &str, salt: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(raw.as_bytes());
    digest.update(salt.as_bytes());
    format!("{:x}", digest.finalize())
}

#[tauri::command]
pub fn device_identity(app: AppHandle) -> Result<DeviceIdentity, String> {
    let (raw, platform) = raw_machine_id()?;
    let identity_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve application data directory: {error}"))?;
    let salt = load_or_create_salt(&identity_root.join("device-salt"))?;
    Ok(DeviceIdentity {
        hashed: hash_identity(&raw, &salt),
        raw,
        platform,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_keys_stay_inside_the_cache() {
        assert!(validate_storage_key("physicsos.notice.last").is_ok());
        assert!(validate_storage_key("../license").is_err());
        assert!(validate_storage_key(".hidden").is_err());
        assert!(validate_storage_key("a/b").is_err());
    }

    #[test]
    fn device_hash_is_stable_and_salted() {
        let first = hash_identity("machine-1", "salt-a");
        assert_eq!(first, hash_identity("machine-1", "salt-a"));
        assert_ne!(first, hash_identity("machine-1", "salt-b"));
        assert_eq!(first.len(), 64);
    }

    #[test]
    fn parses_macos_platform_uuid() {
        let output = r#"
          | "IOPlatformUUID" = "C9A76F8B-1234-5678-90AB-CDEF12345678"
        "#;
        assert_eq!(
            parse_ioreg_platform_uuid(output).as_deref(),
            Some("C9A76F8B-1234-5678-90AB-CDEF12345678")
        );
    }

    #[test]
    fn parses_windows_machine_guid() {
        let output = r#"
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography
    MachineGuid    REG_SZ    3f2504e0-4f89-11d3-9a0c-0305e82c3301
"#;
        assert_eq!(
            parse_windows_machine_guid(output).as_deref(),
            Some("3f2504e0-4f89-11d3-9a0c-0305e82c3301")
        );
    }
}
