mod scanner;

use scanner::{
    apply_openclaw_deploy_inner, check_openclaw_auth_inner, fetch_openclaw_catalog_inner,
    fetch_openclaw_latest_version_inner, fetch_openclaw_runtime_overview_inner,
    fetch_openclaw_skill_detail_inner, fetch_openclaw_skills_inner, install_dependency_inner,
    install_openclaw_inner, launch_openclaw_auth_inner, launch_openclaw_gateway_inner,
    launch_openclaw_skill_install_inner, open_external_url_inner, open_openclaw_dashboard_inner,
    register_openclaw_scan_dir_inner, scan_environment_inner, switch_mirror_mode_inner,
    uninstall_openclaw_inner, update_openclaw_inner, DependencyId, EnvironmentScan,
    InstallLaunchResult, MirrorMode, MirrorSwitchResult, OpenClawAuthLaunchResult,
    OpenClawAuthStatusResult, OpenClawCatalog, OpenClawDashboardLaunchResult,
    OpenClawDeployRequest, OpenClawDeployResult, OpenClawGatewayLaunchResult,
    OpenClawInstallLaunchResult, OpenClawLatestVersion, OpenClawRuntimeOverview,
    OpenClawScanPathResult, OpenClawSkillDetail, OpenClawSkillInstallLaunchResult,
    OpenClawSkillsCatalog, OpenClawUninstallResult, OpenClawUpdateResult,
};
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn minimize_main_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_main_window_maximize(window: tauri::Window) -> Result<bool, String> {
    let maximized = window.is_maximized().map_err(|error| error.to_string())?;

    if maximized {
        window.unmaximize().map_err(|error| error.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|error| error.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn close_main_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn is_main_window_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|error| error.to_string())
}

#[tauri::command]
fn start_drag_main_window(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())?;
    }

    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
async fn scan_environment(force: Option<bool>) -> Result<EnvironmentScan, String> {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || scan_environment_inner(force))
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
async fn fetch_openclaw_catalog(force: Option<bool>) -> Result<OpenClawCatalog, String> {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || fetch_openclaw_catalog_inner(force))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_openclaw_runtime_overview(
    force: Option<bool>,
) -> Result<OpenClawRuntimeOverview, String> {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || fetch_openclaw_runtime_overview_inner(force))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_openclaw_latest_version(
    force: Option<bool>,
) -> Result<OpenClawLatestVersion, String> {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || fetch_openclaw_latest_version_inner(force))
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
async fn uninstall_openclaw() -> Result<OpenClawUninstallResult, String> {
    tauri::async_runtime::spawn_blocking(uninstall_openclaw_inner)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_openclaw() -> Result<OpenClawUpdateResult, String> {
    tauri::async_runtime::spawn_blocking(update_openclaw_inner)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn register_openclaw_scan_dir(path: String) -> Result<OpenClawScanPathResult, String> {
    tauri::async_runtime::spawn_blocking(move || register_openclaw_scan_dir_inner(path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_external_url_inner(url))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn launch_openclaw_auth(provider_id: String) -> Result<OpenClawAuthLaunchResult, String> {
    tauri::async_runtime::spawn_blocking(move || launch_openclaw_auth_inner(provider_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn check_openclaw_auth(provider_id: String) -> Result<OpenClawAuthStatusResult, String> {
    tauri::async_runtime::spawn_blocking(move || check_openclaw_auth_inner(provider_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn launch_openclaw_gateway() -> Result<OpenClawGatewayLaunchResult, String> {
    tauri::async_runtime::spawn_blocking(launch_openclaw_gateway_inner)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_openclaw_dashboard(
    app: tauri::AppHandle,
) -> Result<OpenClawDashboardLaunchResult, String> {
    let launch = tauri::async_runtime::spawn_blocking(open_openclaw_dashboard_inner)
        .await
        .map_err(|error| error.to_string())??;

    let dashboard_url =
        Url::parse(&launch.url).map_err(|error| format!("解析 Dashboard 链接失败: {error}"))?;
    let label = "openclaw-dashboard";

    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
    }

    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(dashboard_url))
        .title("OpenClaw Dashboard")
        .inner_size(1440.0, 960.0)
        .min_inner_size(1100.0, 720.0)
        .center()
        .build()
        .map_err(|error| format!("打开 Dashboard 窗口失败: {error}"))?;

    Ok(OpenClawDashboardLaunchResult {
        opened: true,
        url: launch.url,
        message: format!("{} 已在应用内打开 Dashboard。", launch.message),
    })
}

#[tauri::command]
async fn apply_openclaw_deploy(
    request: OpenClawDeployRequest,
) -> Result<OpenClawDeployResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_openclaw_deploy_inner(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_openclaw_skills() -> Result<OpenClawSkillsCatalog, String> {
    tauri::async_runtime::spawn_blocking(fetch_openclaw_skills_inner)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_openclaw_skill_detail(name: String) -> Result<OpenClawSkillDetail, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_openclaw_skill_detail_inner(name))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn launch_openclaw_skill_install(
    skill_name: String,
    action_id: String,
) -> Result<OpenClawSkillInstallLaunchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        launch_openclaw_skill_install_inner(skill_name, action_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            minimize_main_window,
            toggle_main_window_maximize,
            close_main_window,
            is_main_window_maximized,
            start_drag_main_window,
            scan_environment,
            install_dependency,
            switch_mirror_mode,
            fetch_openclaw_catalog,
            fetch_openclaw_runtime_overview,
            fetch_openclaw_latest_version,
            install_openclaw,
            uninstall_openclaw,
            update_openclaw,
            register_openclaw_scan_dir,
            open_external_url,
            launch_openclaw_auth,
            check_openclaw_auth,
            launch_openclaw_gateway,
            open_openclaw_dashboard,
            apply_openclaw_deploy,
            fetch_openclaw_skills,
            fetch_openclaw_skill_detail,
            launch_openclaw_skill_install
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OpenClaw deployer");
}
