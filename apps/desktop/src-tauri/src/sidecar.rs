use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

const MAX_MESSAGE_BYTES: usize = 1_048_576;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
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

#[tauri::command]
pub async fn sidecar_start(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), String> {
    let executable = std::env::var("PHYSICSOS_AGENT_SIDECAR")
        .map_err(|_| "PHYSICSOS_AGENT_SIDECAR is not configured".to_string())?;
    let mut guard = state.inner.lock().await;
    if guard.is_some() {
        return Err("agent sidecar is already running".into());
    }

    let mut child = Command::new(&executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("cannot start agent sidecar {executable}: {error}"))?;
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
    state: &SidecarState,
    method: &str,
    params: Option<Value>,
) -> Result<Value, String> {
    assert_method(method)?;
    let params = params.unwrap_or(Value::Null);
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

#[tauri::command]
pub async fn sidecar_stop(state: State<'_, SidecarState>) -> Result<(), String> {
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
}
