use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

const MAX_MESSAGE_BYTES: usize = 1_048_576;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const SIDECAR_PROTOCOL_VERSION: u8 = 1;
const ALLOWED_METHODS: &[&str] = &["session/create", "session/send", "run/cancel", "run/resume"];

type PendingRequest = oneshot::Sender<Result<Value, String>>;
type PendingRequests = Arc<Mutex<HashMap<u64, PendingRequest>>>;

#[derive(Default)]
pub struct SidecarState {
    inner: tokio::sync::Mutex<Option<SidecarProcess>>,
}

struct SidecarProcess {
    child: Child,
    stdin: ChildStdin,
    pending: PendingRequests,
    next_id: u64,
}

#[derive(Debug, PartialEq)]
pub(crate) struct SidecarLaunchSpec {
    pub(crate) command: PathBuf,
    pub(crate) args: Vec<PathBuf>,
    pub(crate) sidecar_args: Vec<PathBuf>,
    pub(crate) working_directory: Option<PathBuf>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarManifest {
    version: u8,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    sidecar_args: Vec<String>,
    #[serde(default)]
    working_directory: Option<String>,
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Debug, PartialEq)]
enum SidecarFrame {
    Response {
        id: u64,
        result: Result<Value, String>,
    },
    Event(Value),
}

fn parse_frame(line: &str) -> Result<SidecarFrame, String> {
    let value: Value = serde_json::from_str(line)
        .map_err(|error| format!("sidecar emitted malformed JSON: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "sidecar frame must be a JSON object".to_string())?;
    if let Some(id) = object.get("id").and_then(Value::as_u64) {
        if let Some(error) = object.get("error") {
            return Ok(SidecarFrame::Response {
                id,
                result: Err(error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("sidecar request failed")
                    .to_string()),
            });
        }
        return Ok(SidecarFrame::Response {
            id,
            result: Ok(object.get("result").cloned().unwrap_or(Value::Null)),
        });
    }
    if object.contains_key("event") {
        return Ok(SidecarFrame::Event(value));
    }
    Err("sidecar frame must contain id or event".into())
}

fn assert_method(method: &str) -> Result<(), String> {
    if ALLOWED_METHODS.contains(&method) {
        Ok(())
    } else {
        Err(format!("sidecar method is not allowed: {method}"))
    }
}

fn fail_pending(pending: &PendingRequests, message: String) {
    let Ok(mut requests) = pending.lock() else {
        return;
    };
    for (_, sender) in requests.drain() {
        let _ = sender.send(Err(message.clone()));
    }
}

fn resolve_manifest_path(root: &Path, value: &str) -> Result<PathBuf, String> {
    let mut resolved = root.to_path_buf();
    for component in Path::new(value).components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("sidecar manifest path must not contain '..'".into());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("sidecar manifest paths must be relative".into());
            }
        }
    }
    if resolved == root {
        return Err("sidecar manifest path must not be empty".into());
    }
    Ok(resolved)
}

fn parse_launch_manifest(
    manifest_path: &Path,
    contents: &str,
) -> Result<SidecarLaunchSpec, String> {
    let manifest: SidecarManifest = serde_json::from_str(contents)
        .map_err(|error| format!("cannot parse sidecar manifest: {error}"))?;
    if manifest.version != 1 {
        return Err(format!(
            "unsupported sidecar manifest version: {}",
            manifest.version
        ));
    }
    if manifest.command.trim().is_empty() {
        return Err("sidecar manifest command must not be empty".into());
    }
    let root = manifest_path
        .parent()
        .ok_or_else(|| "sidecar manifest has no parent directory".to_string())?;
    let args = manifest
        .args
        .iter()
        .map(|argument| resolve_manifest_path(root, argument))
        .collect::<Result<Vec<_>, _>>()?;
    let sidecar_args = manifest
        .sidecar_args
        .iter()
        .map(|argument| resolve_manifest_path(root, argument))
        .collect::<Result<Vec<_>, _>>()?;
    let working_directory = manifest
        .working_directory
        .as_deref()
        .map(|directory| resolve_manifest_path(root, directory))
        .transpose()?;
    let command = if manifest.command.starts_with('.')
        || manifest.command.contains('/')
        || manifest.command.contains('\\')
    {
        resolve_manifest_path(root, &manifest.command)?
    } else {
        PathBuf::from(manifest.command)
    };
    Ok(SidecarLaunchSpec {
        command,
        args,
        sidecar_args,
        working_directory,
    })
}

fn read_launch_manifest(manifest_path: &Path) -> Result<SidecarLaunchSpec, String> {
    let contents = std::fs::read_to_string(manifest_path).map_err(|error| {
        format!(
            "cannot read agent sidecar manifest {}: {error}",
            manifest_path.display()
        )
    })?;
    parse_launch_manifest(manifest_path, &contents)
}

pub(crate) fn resolve_launch_spec(app: &AppHandle) -> Result<SidecarLaunchSpec, String> {
    if let Ok(executable) = std::env::var("PHYSICSOS_AGENT_SIDECAR") {
        if !executable.trim().is_empty() {
            return Ok(SidecarLaunchSpec {
                command: PathBuf::from(executable),
                args: Vec::new(),
                sidecar_args: Vec::new(),
                working_directory: None,
            });
        }
    }

    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("agent-sidecar").join("sidecar.json"));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("agent-sidecar")
            .join("sidecar.json"),
    );

    for candidate in &candidates {
        if candidate.is_file() {
            return read_launch_manifest(candidate);
        }
    }
    Err(format!(
        "agent sidecar is not packaged; run scripts/desktop/package-sidecar.mjs (checked {})",
        candidates
            .iter()
            .map(|candidate| candidate.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

#[tauri::command]
pub async fn sidecar_start(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), String> {
    let launch = resolve_launch_spec(&app)?;
    let mut guard = state.inner.lock().await;
    if guard.is_some() {
        return Err("agent sidecar is already running".into());
    }

    let mut command = Command::new(&launch.command);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if let Some(directory) = &launch.working_directory {
        command.current_dir(directory);
    }
    let agent_args = if launch.sidecar_args.is_empty() {
        launch.args.clone()
    } else {
        launch.sidecar_args.clone()
    };
    command.args(&agent_args);
    let mut child = command.spawn().map_err(|error| {
        format!(
            "cannot start agent sidecar {}: {error}",
            launch.command.display()
        )
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "agent sidecar stdin was not available".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "agent sidecar stdout was not available".to_string())?;
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let reader_pending = Arc::clone(&pending);
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    fail_pending(
                        &reader_pending,
                        format!("cannot read agent sidecar: {error}"),
                    );
                    return;
                }
            };
            match parse_frame(&line) {
                Ok(SidecarFrame::Response { id, result }) => {
                    if let Ok(mut requests) = reader_pending.lock() {
                        if let Some(sender) = requests.remove(&id) {
                            let _ = sender.send(result);
                        }
                    }
                }
                Ok(SidecarFrame::Event(event)) => {
                    let _ = app.emit("sidecar://event", event);
                }
                Err(error) => {
                    eprintln!("{error}");
                }
            }
        }
        fail_pending(
            &reader_pending,
            "agent sidecar closed its output stream".to_string(),
        );
    });

    *guard = Some(SidecarProcess {
        child,
        stdin,
        pending,
        next_id: 1,
    });
    Ok(())
}

pub async fn request(
    app: &AppHandle,
    state: &SidecarState,
    method: &str,
    params: Option<Value>,
) -> Result<Value, String> {
    assert_method(method)?;
    let cookie = current_session_cookie(app).await?;
    let params = request_params(params, cookie)?;
    let encoded = serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    }))
    .map_err(|error| format!("cannot encode sidecar request: {error}"))?;
    if encoded.len() > MAX_MESSAGE_BYTES {
        return Err("sidecar request exceeds 1 MiB".into());
    }

    let (receiver, id, pending) = {
        let mut guard = state.inner.lock().await;
        let process = guard
            .as_mut()
            .ok_or_else(|| "agent sidecar is not running".to_string())?;
        let id = process.next_id;
        process.next_id += 1;
        let (sender, receiver) = oneshot::channel();
        process
            .pending
            .lock()
            .map_err(|_| "sidecar pending request map is poisoned")?
            .insert(id, sender);
        let request = serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
        .map_err(|error| format!("cannot encode sidecar request: {error}"))?;
        if let Err(error) = process
            .stdin
            .write_all(&request)
            .and_then(|_| process.stdin.write_all(b"\n"))
        {
            process
                .pending
                .lock()
                .map_err(|_| "sidecar pending request map is poisoned")?
                .remove(&id);
            return Err(format!("cannot write to agent sidecar: {error}"));
        }
        process
            .stdin
            .flush()
            .map_err(|error| format!("cannot flush agent sidecar request: {error}"))?;
        (receiver, id, Arc::clone(&process.pending))
    };

    match tokio::time::timeout(REQUEST_TIMEOUT, receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("agent sidecar dropped the request".into()),
        Err(_) => {
            if let Ok(mut requests) = pending.lock() {
                requests.remove(&id);
            }
            Err("agent sidecar request timed out".into())
        }
    }
}

fn request_params(params: Option<Value>, cookie: Option<String>) -> Result<Value, String> {
    let mut object = match params.unwrap_or_else(|| json!({})) {
        Value::Object(object) => object,
        Value::Null => serde_json::Map::new(),
        _ => return Err("sidecar request params must be a JSON object".into()),
    };
    object.insert(
        "__physicsosProtocolVersion".into(),
        json!(SIDECAR_PROTOCOL_VERSION),
    );
    if let Some(cookie) = cookie {
        object.insert("__physicsosSessionCookie".into(), Value::String(cookie));
    }
    Ok(Value::Object(object))
}

async fn current_session_cookie(app: &AppHandle) -> Result<Option<String>, String> {
    let app = app.clone();
    match tauri::async_runtime::spawn_blocking(move || -> Result<Option<String>, String> {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(None);
        };
        let harness_url = std::env::var("PHYSICSOS_HARNESS_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:38971/".to_string());
        let harness_url = tauri::Url::parse(&harness_url)
            .map_err(|error| format!("PHYSICSOS_HARNESS_URL is invalid: {error}"))?;
        let cookies = window
            .cookies_for_url(harness_url)
            .map_err(|error| format!("cannot read desktop session cookies: {error}"))?;
        Ok(cookies
            .into_iter()
            .find(|cookie| cookie.name() == "physicsos_session")
            .map(|cookie| format!("{}={}", cookie.name(), cookie.value())))
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(format!("cannot read desktop session cookies: {error}")),
    }
}

pub(crate) async fn stop(state: &SidecarState) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let Some(mut process) = guard.take() else {
        return Ok(());
    };
    process
        .child
        .kill()
        .map_err(|error| format!("cannot stop agent sidecar: {error}"))?;
    fail_pending(&process.pending, "agent sidecar stopped".into());
    Ok(())
}

#[tauri::command]
pub async fn sidecar_stop(state: State<'_, SidecarState>) -> Result<(), String> {
    stop(&state).await
}

#[tauri::command]
pub async fn sidecar_status(state: State<'_, SidecarState>) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    let Some(process) = guard.as_mut() else {
        return Ok(false);
    };
    match process.child.try_wait() {
        Ok(Some(_)) => {
            *guard = None;
            Ok(false)
        }
        Ok(None) => Ok(true),
        Err(error) => Err(format!("cannot inspect agent sidecar: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_response_and_event_frames() {
        assert_eq!(
            parse_frame(r#"{"id":7,"result":{"runId":"run_1"}}"#).unwrap(),
            SidecarFrame::Response {
                id: 7,
                result: Ok(json!({ "runId": "run_1" }))
            }
        );
        assert_eq!(
            parse_frame(r#"{"event":{"type":"text_delta","text":"hello"}}"#).unwrap(),
            SidecarFrame::Event(json!({
                "event": { "type": "text_delta", "text": "hello" }
            }))
        );
    }

    #[test]
    fn rejects_unknown_methods() {
        assert!(assert_method("session/send").is_ok());
        assert!(assert_method("shell/run").is_err());
    }

    #[test]
    fn parses_bundled_manifest_with_relative_paths() {
        let spec = parse_launch_manifest(
            Path::new("/app/resources/agent-sidecar/sidecar.json"),
            r#"{
              "version": 1,
              "command": "./runtime/node",
              "args": ["./runtime/lib/bin.js"],
              "sidecarArgs": ["./runtime/sidecar/bridge.mjs"],
              "workingDirectory": "./runtime"
            }"#,
        )
        .unwrap();

        assert_eq!(
            spec.command,
            PathBuf::from("/app/resources/agent-sidecar/runtime/node")
        );
        assert_eq!(
            spec.args,
            vec![PathBuf::from(
                "/app/resources/agent-sidecar/runtime/lib/bin.js"
            )]
        );
        assert_eq!(
            spec.sidecar_args,
            vec![PathBuf::from(
                "/app/resources/agent-sidecar/runtime/sidecar/bridge.mjs"
            )]
        );
        assert_eq!(
            spec.working_directory,
            Some(PathBuf::from("/app/resources/agent-sidecar/runtime"))
        );
        assert!(parse_launch_manifest(
            Path::new("/app/resources/agent-sidecar/sidecar.json"),
            r#"{"version":1,"command":"./runtime/node","args":["../../escape.js"]}"#,
        )
        .is_err());
    }

    #[test]
    fn parses_windows_node_executable_from_the_bundled_runtime() {
        let spec = parse_launch_manifest(
            Path::new("/app/resources/agent-sidecar/sidecar.json"),
            r#"{
              "version": 1,
              "command": "./runtime/node.exe",
              "args": ["./runtime/lib/bin.js"],
              "sidecarArgs": ["./runtime/sidecar/bridge.mjs"],
              "workingDirectory": "./runtime"
            }"#,
        )
        .unwrap();

        assert_eq!(
            spec.command,
            PathBuf::from("/app/resources/agent-sidecar/runtime/node.exe")
        );
    }

    #[test]
    fn injects_protocol_version_and_session_cookie() {
        let params = request_params(
            Some(json!({ "sessionId": "session-1" })),
            Some("physicsos_session=fixture".into()),
        )
        .unwrap();
        assert_eq!(params["sessionId"], "session-1");
        assert_eq!(params["__physicsosProtocolVersion"], 1);
        assert_eq!(
            params["__physicsosSessionCookie"],
            "physicsos_session=fixture"
        );
        assert!(request_params(Some(json!(["not", "an", "object"])), None).is_err());
    }
}
