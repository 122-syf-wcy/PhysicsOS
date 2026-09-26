use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
pub struct UpdateState(pub Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    pub published_at: Option<String>,
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<UpdateInfo>, String> {
    *state.0.lock().map_err(|_| "update state is poisoned")? = None;
    let updater = app
        .updater()
        .map_err(|error| format!("cannot initialize updater: {error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("cannot check for updates: {error}"))?;
    let Some(update) = update else {
        return Ok(None);
    };
    let info = UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
        published_at: update.date.map(|date| date.to_string()),
    };
    *state.0.lock().map_err(|_| "update state is poisoned")? = Some(update);
    Ok(Some(info))
}

#[tauri::command]
pub async fn update_install(version: String, state: State<'_, UpdateState>) -> Result<(), String> {
    let update = state
        .0
        .lock()
        .map_err(|_| "update state is poisoned")?
        .take()
        .ok_or_else(|| "check for an update before installing it".to_string())?;
    if update.version != version {
        return Err(format!(
            "checked version {} does not match requested version {}",
            update.version, version
        ));
    }
    update
        .download_and_install(|_chunk_length, _content_length| {}, || {})
        .await
        .map_err(|error| format!("cannot download and install update: {error}"))
}
