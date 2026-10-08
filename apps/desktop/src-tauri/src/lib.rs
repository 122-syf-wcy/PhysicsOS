mod platform;
mod sidecar;
mod startup_state;
mod updater;
mod web_host;

use platform::{device_identity, platform_data_dir, storage_read, storage_write};
use serde_json::Value;
use sidecar::{sidecar_start, sidecar_status, sidecar_stop, SidecarState};
use tauri::Manager;
use updater::{update_check, update_install, UpdateState};
use web_host::{web_host_retry, web_host_status, WebHostState};

#[tauri::command]
async fn sidecar_request(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    sidecar::request(&app, &state, &method, params).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SidecarState::default())
        .manage(UpdateState::default())
        .manage(WebHostState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            if !cfg!(debug_assertions)
                || std::env::var_os("PHYSICSOS_DESKTOP_WEB_HOST").is_some()
                || std::env::var_os("PHYSICSOS_DESKTOP_SERVER_URL").is_some()
                || option_env!("PHYSICSOS_DESKTOP_SERVER_URL").is_some()
            {
                let state = app.state::<WebHostState>();
                // Expected startup failures are stored for the visible startup
                // page; they must not abort the desktop application's setup.
                web_host::start(app.handle(), &state).map_err(std::io::Error::other)?;
            } else if let (Some(window), Some(url)) = (
                app.get_webview_window("main"),
                app.config().build.dev_url.clone(),
            ) {
                window.navigate(url).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            device_identity,
            platform_data_dir,
            storage_read,
            storage_write,
            update_check,
            update_install,
            sidecar_start,
            sidecar_request,
            sidecar_stop,
            sidecar_status,
            web_host_status,
            web_host_retry,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build PhysicsOS desktop shell");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(host) = app_handle.try_state::<WebHostState>() {
                host.stop();
            }
            if let Some(sidecar) = app_handle.try_state::<SidecarState>() {
                let _ = tauri::async_runtime::block_on(sidecar::stop(&sidecar));
            }
        }
    });
}
