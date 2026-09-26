use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const WEB_HOST_PORT: &str = "38971";

#[derive(Default)]
pub struct WebHostState {
    child: Mutex<Option<Child>>,
}

fn parse_ready_url(line: &str) -> Option<&str> {
    let marker = "dsh web: ";
    let start = line.find(marker)? + marker.len();
    let url = line[start..].split_whitespace().next()?;
    let origin = format!("http://127.0.0.1:{WEB_HOST_PORT}");
    (url == origin || url.starts_with(&format!("{origin}/"))).then_some(url)
}

pub fn start(app: &AppHandle, state: &WebHostState) -> Result<(), String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "web host state is poisoned")?;
    if guard.is_some() {
        return Ok(());
    }

    let port = WEB_HOST_PORT
        .parse::<u16>()
        .map_err(|error| format!("desktop web host port is invalid: {error}"))?;
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|error| format!("desktop web host port is unavailable: {error}"))?;
    drop(listener);

    let launch = crate::sidecar::resolve_launch_spec(app)?;
    let mut command = Command::new(&launch.command);
    command
        .args(&launch.args)
        .args(["web", "--port", WEB_HOST_PORT])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if let Some(directory) = &launch.working_directory {
        command.current_dir(directory);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("cannot start desktop web host: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "desktop web host stdout was not available".to_string())?;
    *guard = Some(child);
    drop(guard);

    let app = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let Some(url) = parse_ready_url(&line) else {
                continue;
            };
            let Ok(url) = url.parse::<tauri::Url>() else {
                eprintln!("desktop web host emitted an invalid URL: {url}");
                return;
            };
            let Some(window) = app.get_webview_window("main") else {
                eprintln!("desktop web host could not find the main window");
                return;
            };
            eprintln!("desktop web host ready: {url}");
            if let Err(error) = window.navigate(url) {
                eprintln!("desktop web host navigation failed: {error}");
                return;
            }
            if let Err(error) = window.show() {
                eprintln!("desktop web host could not show the main window: {error}");
            }
            return;
        }
        eprintln!("desktop web host exited before reporting a URL");
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_loopback_ready_url() {
        assert_eq!(
            parse_ready_url("dsh web: http://127.0.0.1:38971 (LAN: http://192.168.1.2:38971)"),
            Some("http://127.0.0.1:38971")
        );
        assert_eq!(parse_ready_url("dsh web: https://example.com"), None);
        assert_eq!(parse_ready_url("starting"), None);
    }
}
