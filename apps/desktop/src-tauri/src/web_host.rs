use crate::startup_state::StartupState;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const WEB_HOST_PORT: &str = "38971";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Runtime {
    child: Option<Child>,
    startup: StartupState,
}

#[derive(Default)]
pub struct WebHostState {
    inner: Arc<Mutex<Runtime>>,
}

fn reap(mut child: Child) {
    let _ = child.kill();
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    // Reaping continues off the IPC thread if the OS delays process teardown.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

impl WebHostState {
    pub(crate) fn stop(&self) {
        let Ok(mut guard) = self.inner.lock() else {
            return;
        };
        guard.startup.generation += 1;
        if let Some(child) = guard.child.take() {
            reap(child);
        }
    }
}

impl Drop for WebHostState {
    fn drop(&mut self) {
        self.stop();
    }
}

fn parse_ready_url(line: &str) -> Option<&str> {
    let marker = "dsh web: ";
    let start = line.find(marker)? + marker.len();
    let url = line[start..].split_whitespace().next()?;
    let origin = format!("http://127.0.0.1:{WEB_HOST_PORT}");
    (url == origin || url.starts_with(&format!("{origin}/"))).then_some(url)
}

fn auth_ready() -> bool {
    let address = format!("127.0.0.1:{WEB_HOST_PORT}")
        .parse()
        .expect("fixed loopback address");
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(200)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));
    if stream
        .write_all(
            b"GET /physicsos/auth/me HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .is_err()
    {
        return false;
    }
    let mut buffer = [0_u8; 128];
    let Ok(size) = stream.read(&mut buffer) else {
        return false;
    };
    let response = String::from_utf8_lossy(&buffer[..size]);
    response.starts_with("HTTP/1.1 401 ") || response.starts_with("HTTP/1.1 200 ")
}

fn show_startup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let origin = if cfg!(target_os = "windows") {
            "http://tauri.localhost/startup.html"
        } else {
            "tauri://localhost/startup.html"
        };
        if let Ok(url) = origin.parse() {
            let _ = window.navigate(url);
        }
        let _ = window.show();
    }
}

fn fail(app: &AppHandle, inner: &Arc<Mutex<Runtime>>, generation: u64, message: String) {
    let Ok(mut runtime) = inner.lock() else {
        return;
    };
    if !runtime.startup.fail(generation, message) {
        return;
    }
    if let Some(child) = runtime.child.take() {
        reap(child);
    }
    // Keep generation check and navigation in the same critical section.
    show_startup(app);
}

fn drain<R: Read + Send + 'static>(
    reader: R,
    inner: Arc<Mutex<Runtime>>,
    generation: u64,
    ready: Option<mpsc::Sender<String>>,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Some(sender) = &ready {
                if let Some(url) = parse_ready_url(&line) {
                    let _ = sender.send(url.to_string());
                }
            }
            if let Ok(mut runtime) = inner.lock() {
                runtime.startup.log(generation, line);
            }
        }
    });
}

fn remote_url(raw: &str) -> Result<tauri::Url, String> {
    let url: tauri::Url = raw
        .parse()
        .map_err(|error| format!("服务器地址无效：{error}"))?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("服务器地址必须是 HTTP(S) 地址，且不能包含账号密码。".into());
    }
    Ok(url)
}

pub fn start(app: &AppHandle, state: &WebHostState) -> Result<(), String> {
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "web host state is poisoned")?;
    if let Some(child) = runtime.child.take() {
        reap(child);
    }
    let generation = runtime.startup.begin();
    let server_url = std::env::var("PHYSICSOS_DESKTOP_SERVER_URL")
        .ok()
        .or_else(|| option_env!("PHYSICSOS_DESKTOP_SERVER_URL").map(str::to_string));
    if let Some(raw) = server_url {
        let navigation = remote_url(&raw).and_then(|url| {
            app.get_webview_window("main")
                .ok_or_else(|| "main window is missing".to_string())?
                .navigate(url)
                .map_err(|error| error.to_string())
        });
        match navigation {
            Ok(()) => {
                runtime.startup.ready(generation);
            }
            Err(error) => {
                runtime.startup.fail(generation, error);
            }
        }
        return Ok(());
    }

    let launch = (|| {
        let launch = crate::sidecar::resolve_launch_spec(app)?;
        let mut command = Command::new(&launch.command);
        command
            .args(&launch.args)
            .args(["web", "--port", WEB_HOST_PORT])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(directory) = &launch.working_directory {
            command.current_dir(directory);
        }
        command
            .spawn()
            .map_err(|error| format!("无法启动本地服务：{error}"))
    })();
    let mut child = match launch {
        Ok(child) => child,
        Err(error) => {
            runtime.startup.fail(generation, error);
            return Ok(());
        }
    };
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    runtime.child = Some(child);
    drop(runtime);

    let (sender, receiver) = mpsc::channel();
    drain(stdout, state.inner.clone(), generation, Some(sender));
    drain(stderr, state.inner.clone(), generation, None);
    let inner = state.inner.clone();
    let app = app.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut ready_url = None;
        loop {
            if let Ok(url) = receiver.try_recv() {
                ready_url = Some(url);
            }
            let Ok(mut runtime) = inner.lock() else {
                return;
            };
            if runtime.startup.generation != generation {
                return;
            }
            let exited = runtime
                .child
                .as_mut()
                .and_then(|child| child.try_wait().ok())
                .flatten();
            if let Some(status) = exited {
                drop(runtime);
                fail(
                    &app,
                    &inner,
                    generation,
                    format!("本地服务已退出（{status}）。请查看诊断信息后重试。"),
                );
                return;
            }
            if runtime
                .startup
                .timeout(generation, started.elapsed(), STARTUP_TIMEOUT)
            {
                let message = runtime.startup.message.clone();
                drop(runtime);
                fail(&app, &inner, generation, message);
                return;
            }
            let starting = runtime.startup.phase == "starting";
            drop(runtime);
            if starting && ready_url.is_some() && auth_ready() {
                let Ok(mut runtime) = inner.lock() else {
                    return;
                };
                if runtime.startup.generation != generation {
                    return;
                }
                let navigation = ready_url
                    .as_ref()
                    .unwrap()
                    .parse::<tauri::Url>()
                    .map_err(|error| error.to_string())
                    .and_then(|url| {
                        app.get_webview_window("main")
                            .ok_or_else(|| "main window is missing".to_string())?
                            .navigate(url)
                            .map_err(|error| error.to_string())
                    });
                match navigation {
                    Ok(()) => {
                        runtime.startup.ready(generation);
                    }
                    Err(message) => {
                        drop(runtime);
                        fail(&app, &inner, generation, message);
                        return;
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
    Ok(())
}

#[tauri::command]
pub fn web_host_status(state: State<'_, WebHostState>) -> Result<Value, String> {
    let runtime = state
        .inner
        .lock()
        .map_err(|_| "web host state is poisoned")?;
    Ok(
        json!({ "generation": runtime.startup.generation, "phase": runtime.startup.phase, "message": runtime.startup.message, "logs": runtime.startup.logs }),
    )
}

#[tauri::command]
pub fn web_host_retry(app: AppHandle, state: State<'_, WebHostState>) -> Result<Value, String> {
    start(&app, &state)?;
    web_host_status(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_the_expected_loopback_ready_url() {
        assert_eq!(
            parse_ready_url("dsh web: http://127.0.0.1:38971 (LAN: http://192.168.1.2:38971)"),
            Some("http://127.0.0.1:38971")
        );
        assert_eq!(
            parse_ready_url("dsh web: http://127.0.0.1:38971.evil/"),
            None
        );
        assert_eq!(parse_ready_url("dsh web: https://example.com"), None);
        assert_eq!(parse_ready_url("starting"), None);
    }

    #[test]
    fn remote_mode_rejects_non_web_urls_and_credentials() {
        assert!(remote_url("https://physicsos.example/").is_ok());
        assert!(remote_url("file:///etc/passwd").is_err());
        assert!(remote_url("https://user:password@example.com").is_err());
    }
}
