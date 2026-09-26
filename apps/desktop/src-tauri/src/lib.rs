mod platform;
mod sidecar;
mod updater;

use platform::{device_identity, platform_data_dir, storage_read, storage_write};
use serde_json::Value;
use sidecar::{sidecar_start, sidecar_status, sidecar_stop, SidecarState};
use updater::{update_check, update_install, UpdateState};

#[tauri::command]
async fn sidecar_request(
    state: tauri::State<'_, SidecarState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    sidecar::request(&state, &method, params).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SidecarState::default())
        .manage(UpdateState::default())
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
