mod scanner;

use scanner::{
    fetch_openclaw_catalog_inner, install_dependency_inner, install_openclaw_inner,
    register_openclaw_scan_dir_inner, scan_environment_inner, switch_mirror_mode_inner,
    DependencyId, EnvironmentScan, InstallLaunchResult, MirrorMode, MirrorSwitchResult,
    OpenClawCatalog, OpenClawInstallLaunchResult, OpenClawScanPathResult,
};

#[tauri::command]
async fn scan_environment() -> Result<EnvironmentScan, String> {
    tauri::async_runtime::spawn_blocking(scan_environment_inner)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn install_dependency(id: DependencyId) -> Result<InstallLaunchResult, String> {
    tauri::async_runtime::spawn_blocking(move || install_dependency_inner(id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn switch_mirror_mode(mode: MirrorMode) -> Result<MirrorSwitchResult, String> {
    tauri::async_runtime::spawn_blocking(move || switch_mirror_mode_inner(mode))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_openclaw_catalog() -> Result<OpenClawCatalog, String> {
    tauri::async_runtime::spawn_blocking(fetch_openclaw_catalog_inner)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn install_openclaw() -> Result<OpenClawInstallLaunchResult, String> {
    tauri::async_runtime::spawn_blocking(install_openclaw_inner)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn register_openclaw_scan_dir(path: String) -> Result<OpenClawScanPathResult, String> {
    tauri::async_runtime::spawn_blocking(move || register_openclaw_scan_dir_inner(path))
        .await
        .map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_environment,
            install_dependency,
            switch_mirror_mode,
            fetch_openclaw_catalog,
            install_openclaw,
            register_openclaw_scan_dir
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OpenClaw deployer");
}
