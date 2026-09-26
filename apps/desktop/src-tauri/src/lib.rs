mod platform;
mod sidecar;
mod updater;
mod web_host;

use platform::{device_identity, platform_data_dir, storage_read, storage_write};
use serde_json::Value;
use sidecar::{sidecar_start, sidecar_status, sidecar_stop, SidecarState};
use tauri::Manager;
use updater::{update_check, update_install, UpdateState};
use web_host::WebHostState;

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
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SidecarState::default())
        .manage(UpdateState::default())
        .manage(WebHostState::default())
        .setup(|app| {
            /* 服务器模式：设了 PHYSICSOS_DESKTOP_SERVER_URL（构建期 option_env!
               或运行期环境变量）就直接连共享服务器，不再启动本机 Harness——
               账号、数据、模型调用都在服务器侧。 */
            let server_url = std::env::var("PHYSICSOS_DESKTOP_SERVER_URL")
                .ok()
                .or_else(|| option_env!("PHYSICSOS_DESKTOP_SERVER_URL").map(str::to_string));
            if let Some(raw) = server_url {
                let url = raw
                    .parse::<tauri::Url>()
                    .map_err(std::io::Error::other)?;
                let window = app
                    .get_webview_window("main")
                    .ok_or_else(|| std::io::Error::other("main window is missing"))?;
                window.navigate(url).map_err(std::io::Error::other)?;
                window.show()?;
                return Ok(());
            }
            if !cfg!(debug_assertions) || std::env::var_os("PHYSICSOS_DESKTOP_WEB_HOST").is_some() {
                let state = app.state::<WebHostState>();
                web_host::start(app.handle(), &state).map_err(std::io::Error::other)?;
            } else if let Some(window) = app.get_webview_window("main") {
                window.show()?;
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
        ])
        .run(tauri::generate_context!())
        .expect("failed to run PhysicsOS desktop shell");
}
