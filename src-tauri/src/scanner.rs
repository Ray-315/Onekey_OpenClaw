use regex::Regex;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const NODE_REQUIRED_VERSION: &str = "22+";
const NODE_INDEX_URL: &str = "https://nodejs.org/download/release/latest-v22.x/";
const NODE_MIRROR_BASE: &str = "https://registry.npmmirror.com/-/binary/node/latest-v22.x/";
const NODE_PKG_FALLBACK: &str = "https://nodejs.org/download/release/latest-v22.x/node-v22.22.1.pkg";
const NODE_MSI_X64_FALLBACK: &str =
    "https://nodejs.org/download/release/latest-v22.x/node-v22.22.1-x64.msi";
const NODE_MSI_ARM64_FALLBACK: &str =
    "https://nodejs.org/download/release/latest-v22.x/node-v22.22.1-arm64.msi";
const NPM_MIRROR_REGISTRY: &str = "https://registry.npmmirror.com";
const GIT_WINDOWS_PAGE: &str = "https://git-scm.com/install/windows.html";
const GIT_WINDOWS_X64_FALLBACK: &str =
    "https://github.com/git-for-windows/git/releases/latest/download/Git-64-bit.exe";
const GIT_WINDOWS_ARM64_FALLBACK: &str =
    "https://github.com/git-for-windows/git/releases/latest/download/Git-arm64.exe";
const HOMEBREW_TUNA_BREW_GIT_REMOTE: &str =
    "https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git";
const HOMEBREW_TUNA_CORE_GIT_REMOTE: &str =
    "https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git";
const HOMEBREW_TUNA_INSTALL_REPO: &str =
    "https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/install.git";
const HOMEBREW_TUNA_API_DOMAIN: &str =
    "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api";
const HOMEBREW_TUNA_BOTTLE_DOMAIN: &str =
    "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles";
const HOMEBREW_INSTALL_COMMAND: &str =
    "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"";
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const DASHBOARD_TIMEOUT: Duration = Duration::from_secs(8);
const OPENCLAW_HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
const OPENCLAW_MODELS_TIMEOUT: Duration = Duration::from_secs(15);
const OPENCLAW_NPM_REGISTRY_OFFICIAL: &str = "https://registry.npmjs.org";
const OPENCLAW_NPMRC_BEGIN: &str = "# >>> openclaw-deployer mirror >>>";
const OPENCLAW_NPMRC_END: &str = "# <<< openclaw-deployer mirror <<<";
const ZAI_GLOBAL_BASE_URL: &str = "https://api.z.ai/api/paas/v4";
const ZAI_CN_BASE_URL: &str = "https://open.bigmodel.cn/api/paas/v4";
const MOONSHOT_GLOBAL_BASE_URL: &str = "https://api.moonshot.ai/v1";
const MOONSHOT_CN_BASE_URL: &str = "https://api.moonshot.cn/v1";
const MINIMAX_GLOBAL_BASE_URL: &str = "https://api.minimax.io/anthropic";
const MINIMAX_CN_BASE_URL: &str = "https://api.minimaxi.com/anthropic";
const PROVIDER_ROUTE_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DependencyId {
    Node,
    Npm,
    Git,
    Homebrew,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MirrorMode {
    Official,
    China,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Installed,
    Missing,
    Outdated,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentScan {
    pub platform: Platform,
    pub scanned_at: String,
    pub mirror_mode: MirrorMode,
    pub checks: Vec<DependencyCheck>,
    pub overall_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyCheck {
    pub id: DependencyId,
    pub title: String,
    pub status: CheckStatus,
    pub version: Option<String>,
    pub required_version: Option<String>,
    pub summary: String,
    pub action_label: String,
    pub action_enabled: bool,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLaunchResult {
    pub id: DependencyId,
    pub strategy: String,
    pub started: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorSwitchResult {
    pub mode: MirrorMode,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeployAuthMode {
    Api,
    Login,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawProviderModel {
    pub id: String,
    pub title: String,
    #[serde(rename = "ref")]
    pub ref_value: String,
    pub auth_modes: Vec<DeployAuthMode>,
    pub supports_login: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawProviderCatalog {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub models: Vec<OpenClawProviderModel>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenClawRuntimeStatus {
    Running,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawCatalog {
    pub installed: bool,
    pub version: Option<String>,
    pub message: String,
    pub runtime_status: OpenClawRuntimeStatus,
    pub scan_paths: Vec<String>,
    pub providers: Vec<OpenClawProviderCatalog>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawRuntimeOverview {
    pub installed: bool,
    pub version: Option<String>,
    pub message: String,
    pub runtime_status: OpenClawRuntimeStatus,
    pub scan_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawInstallLaunchResult {
    pub started: bool,
    pub strategy: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawScanPathResult {
    pub path: String,
    pub message: String,
    pub scan_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawDeployRequest {
    pub primary_provider_id: String,
    #[serde(default)]
    pub primary_provider_route_id: String,
    pub primary_model_ref: String,
    pub auth_mode: DeployAuthMode,
    #[serde(default)]
    pub api_secret: String,
    #[serde(default)]
    pub fallback_model_ref: String,
    pub auto_start_gateway: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawDeployResult {
    pub applied: bool,
    pub started_gateway: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawAuthLaunchResult {
    pub started: bool,
    pub provider: String,
    pub command: String,
    pub message: String,
    pub auth_store_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawAuthStatusResult {
    pub provider: String,
    pub connected: bool,
    pub message: String,
    pub auth_store_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawGatewayLaunchResult {
    pub started: bool,
    pub command: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawDashboardLaunchResult {
    pub opened: bool,
    pub url: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSkillRequirements {
    #[serde(default)]
    pub bins: Vec<String>,
    #[serde(default)]
    pub any_bins: Vec<String>,
    #[serde(default)]
    pub env: Vec<String>,
    #[serde(default)]
    pub config: Vec<String>,
    #[serde(default)]
    pub os: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSkillInstallAction {
    pub id: String,
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub bins: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSkillSummary {
    pub name: String,
    pub description: String,
    pub emoji: Option<String>,
    pub eligible: bool,
    pub disabled: bool,
    pub blocked_by_allowlist: bool,
    pub source: String,
    pub bundled: bool,
    pub homepage: Option<String>,
    pub primary_env: Option<String>,
    pub missing: OpenClawSkillRequirements,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSkillsCatalog {
    pub workspace_dir: String,
    pub managed_skills_dir: String,
    pub ready_count: usize,
    pub total_count: usize,
    pub skills: Vec<OpenClawSkillSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSkillDetail {
    pub name: String,
    pub description: String,
    pub emoji: Option<String>,
    pub source: String,
    pub bundled: bool,
    pub file_path: String,
    pub base_dir: String,
    pub skill_key: String,
    pub eligible: bool,
    pub disabled: bool,
    pub blocked_by_allowlist: bool,
    pub homepage: Option<String>,
    pub primary_env: Option<String>,
    pub requirements: OpenClawSkillRequirements,
    pub missing: OpenClawSkillRequirements,
    #[serde(default)]
    pub install: Vec<OpenClawSkillInstallAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSkillInstallLaunchResult {
    pub started: bool,
    pub skill_name: String,
    pub action_id: String,
    pub command: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawOpenClawSkillsCatalog {
    workspace_dir: String,
    managed_skills_dir: String,
    skills: Vec<OpenClawSkillSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    #[serde(default = "default_mirror_mode")]
    mirror_mode: MirrorMode,
    #[serde(default)]
    openclaw_scan_dirs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProbeResult {
    status: CheckStatus,
    version: Option<String>,
    details: Option<String>,
}

#[derive(Debug, Clone)]
struct ProbeSnapshot {
    node: ProbeResult,
    npm: ProbeResult,
    git: ProbeResult,
    homebrew: Option<ProbeResult>,
}

pub fn scan_environment_inner() -> Result<EnvironmentScan, String> {
    let platform = current_platform()?;
    let snapshot = probe_snapshot(platform);
    Ok(build_scan(platform, load_app_settings().mirror_mode, snapshot))
}

pub fn fetch_openclaw_catalog_inner() -> Result<OpenClawCatalog, String> {
    let scan_paths = configured_openclaw_scan_dirs_as_strings();
    let version_probe = probe_openclaw_version();

    match version_probe.status {
        CheckStatus::Installed => {
            let (providers, message) = match load_openclaw_provider_catalog() {
                Ok(providers) if providers.is_empty() => (
                    providers,
                    "已检测到 OpenClaw，但当前未从 CLI 返回可用模型列表。".to_string(),
                ),
                Ok(providers) => (
                    providers,
                    "已检测到 OpenClaw，可继续选择 provider 和模型。".to_string(),
                ),
                Err(error) => (
                    Vec::new(),
                    format!("已检测到 OpenClaw，但暂时无法读取模型列表：{error}"),
                ),
            };
            Ok(OpenClawCatalog {
                installed: true,
                version: version_probe.version,
                message,
                runtime_status: probe_openclaw_runtime_status(),
                scan_paths,
                providers,
            })
        }
        _ => Ok(OpenClawCatalog {
            installed: false,
            version: None,
            message: "请先安装 OpenClaw，再通过 CLI 拉取可用 provider 和模型列表。".into(),
            runtime_status: OpenClawRuntimeStatus::Stopped,
            scan_paths,
            providers: Vec::new(),
        }),
    }
}

pub fn fetch_openclaw_runtime_overview_inner() -> Result<OpenClawRuntimeOverview, String> {
    let scan_paths = configured_openclaw_scan_dirs_as_strings();
    let version_probe = probe_openclaw_version();
    let installed = matches!(
        version_probe.status,
        CheckStatus::Installed | CheckStatus::Outdated
    ) || resolve_openclaw_executable().is_some();
    let runtime_status = if installed {
        probe_openclaw_runtime_status()
    } else {
        OpenClawRuntimeStatus::Stopped
    };
    let message = match (installed, runtime_status) {
        (false, _) => "未检测到 OpenClaw CLI。".to_string(),
        (true, OpenClawRuntimeStatus::Running) => "Gateway 正在运行。".to_string(),
        (true, OpenClawRuntimeStatus::Stopped) => "已检测到 OpenClaw CLI，Gateway 当前未启动。".to_string(),
    };

    Ok(OpenClawRuntimeOverview {
        installed,
        version: version_probe.version,
        message,
        runtime_status,
        scan_paths,
    })
}

pub fn install_dependency_inner(id: DependencyId) -> Result<InstallLaunchResult, String> {
    let platform = current_platform()?;
    let mirror_mode = load_app_settings().mirror_mode;
    match (platform, id) {
        (_, DependencyId::Node) => install_node(platform, mirror_mode, DependencyId::Node),
        (_, DependencyId::Npm) => install_node(platform, mirror_mode, DependencyId::Npm),
        (Platform::Windows, DependencyId::Git) => install_git_windows(),
        (Platform::Macos, DependencyId::Git) => install_git_macos(mirror_mode),
        (Platform::Macos, DependencyId::Homebrew) => install_homebrew(mirror_mode),
        (Platform::Windows, DependencyId::Homebrew) => Err("Windows 不支持 Homebrew 安装。".into()),
    }
}

pub fn install_openclaw_inner() -> Result<OpenClawInstallLaunchResult, String> {
    let platform = current_platform()?;
    let mirror_mode = load_app_settings().mirror_mode;
    let default_scan_dir = default_openclaw_bin_dir()?;
    register_openclaw_scan_dir(default_scan_dir.clone())?;

    match platform {
        Platform::Macos => {
            run_in_terminal(&openclaw_install_macos_command(mirror_mode))?;
            Ok(OpenClawInstallLaunchResult {
                started: true,
                strategy: "open-terminal".into(),
                message: format!(
                    "已拉起 Terminal 执行 OpenClaw 官方安装脚本。默认检测目录已设为 {}；安装完成后请返回本页重新检测。",
                    default_scan_dir.display()
                ),
            })
        }
        Platform::Windows => {
            launch_openclaw_windows_installer(mirror_mode)?;
            Ok(OpenClawInstallLaunchResult {
                started: true,
                strategy: "open-powershell".into(),
                message: "已拉起 PowerShell 执行 OpenClaw 官方安装脚本。安装完成后请返回本页重新检测。".into(),
            })
        }
    }
}

pub fn register_openclaw_scan_dir_inner(path: String) -> Result<OpenClawScanPathResult, String> {
    let normalized = normalize_openclaw_scan_dir_input(&path)?;
    let registered = register_openclaw_scan_dir(normalized)?;

    Ok(OpenClawScanPathResult {
        path: registered.display().to_string(),
        message: "已加入 OpenClaw 扫描目录，重新检测时会优先检查这里。".into(),
        scan_paths: configured_openclaw_scan_dirs_as_strings(),
    })
}

pub fn open_external_url_inner(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("链接为空，无法打开。".into());
    }

    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("只允许打开 http 或 https 链接。".into());
    }

    let mut command = match env::consts::OS {
        "macos" => {
            let mut command = Command::new("open");
            command.arg(trimmed);
            command
        }
        "windows" => {
            let mut command = Command::new("cmd");
            command.args(["/C", "start", ""]).arg(trimmed);
            command
        }
        _ => {
            let mut command = Command::new("xdg-open");
            command.arg(trimmed);
            command
        }
    };

    with_standard_tool_paths(&mut command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开外部链接失败: {error}"))
}

pub fn launch_openclaw_auth_inner(provider_id: String) -> Result<OpenClawAuthLaunchResult, String> {
    let login = resolve_openclaw_auth_flow(&provider_id)?;
    run_in_terminal(&login.command)?;

    Ok(OpenClawAuthLaunchResult {
        started: true,
        provider: provider_id,
        command: login.command,
        message: login.launch_message,
        auth_store_path: login.auth_store_path.display().to_string(),
    })
}

pub fn check_openclaw_auth_inner(provider_id: String) -> Result<OpenClawAuthStatusResult, String> {
    let login = resolve_openclaw_auth_flow(&provider_id)?;
    let connected = auth_store_has_provider_profile(&login.auth_store_path, &login.auth_providers)?;
    let message = if connected {
        format!("已检测到 {} 的授权配置，可以继续部署。", login.display_name)
    } else {
        login.pending_message
    };

    Ok(OpenClawAuthStatusResult {
        provider: provider_id,
        connected,
        message,
        auth_store_path: login.auth_store_path.display().to_string(),
    })
}

pub fn launch_openclaw_gateway_inner() -> Result<OpenClawGatewayLaunchResult, String> {
    let command = build_gateway_run_command();
    run_in_terminal(&command)?;

    Ok(OpenClawGatewayLaunchResult {
        started: true,
        command,
        message: "已在 Terminal 中拉起 `openclaw gateway run --allow-unconfigured`。保留这个窗口，Gateway 才会持续运行。".into(),
    })
}

pub fn apply_openclaw_deploy_inner(
    request: OpenClawDeployRequest,
) -> Result<OpenClawDeployResult, String> {
    let primary_model_ref = request.primary_model_ref.trim().to_string();
    if primary_model_ref.is_empty() {
        return Err("请先选择主模型，再开始部署。".into());
    }

    let fallback_model_ref = request
        .fallback_model_ref
        .trim()
        .to_string();
    let fallback_model_ref = (!fallback_model_ref.is_empty() && fallback_model_ref != primary_model_ref)
        .then_some(fallback_model_ref);

    match request.auth_mode {
        DeployAuthMode::Api => {
            let secret = request.api_secret.trim();
            if secret.is_empty() {
                return Err("API Key 为空，无法应用真实部署。".into());
            }
            upsert_api_key_profile(&request.primary_provider_id, secret)?;
        }
        DeployAuthMode::Login => ensure_login_profiles_ready(&request.primary_provider_id)?,
    }

    let route_summary = configure_provider_route_for_deploy(
        &request.primary_provider_id,
        &request.primary_provider_route_id,
        &primary_model_ref,
        if request.api_secret.trim().is_empty() {
            None
        } else {
            Some(request.api_secret.trim())
        },
    )?;

    run_openclaw_command_with_timeout(
        &["models", "set", &primary_model_ref],
        OPENCLAW_MODELS_TIMEOUT,
    )?;
    run_openclaw_command_with_timeout(&["models", "fallbacks", "clear"], PROBE_TIMEOUT)?;
    if let Some(fallback) = fallback_model_ref.as_deref() {
        run_openclaw_command_with_timeout(
            &["models", "fallbacks", "add", fallback],
            OPENCLAW_MODELS_TIMEOUT,
        )?;
    }

    let session_synced = sync_openclaw_main_session_model(&primary_model_ref).unwrap_or(false);
    let session_reset = if session_synced {
        reset_openclaw_dashboard_session().unwrap_or(false)
    } else {
        false
    };

    let started_gateway = if request.auto_start_gateway {
        run_in_terminal(&build_gateway_run_command())?;
        true
    } else {
        false
    };

    let fallback_summary = fallback_model_ref
        .as_deref()
        .map(|fallback| format!("，回退模型设为 {fallback}"))
        .unwrap_or_else(|| "，并清空了回退模型".into());
    let auth_summary = match request.auth_mode {
        DeployAuthMode::Api => "已写入 API Key 配置",
        DeployAuthMode::Login => "已确认登录配置",
    };
    let route_summary = route_summary
        .map(|summary| format!("，{summary}"))
        .unwrap_or_default();
    let gateway_summary = if started_gateway {
        "并已拉起 Gateway。"
    } else {
        "Gateway 未自动启动。"
    };
    let session_summary = if session_reset {
        "当前主会话已同步到新模型并重置。"
    } else if session_synced {
        "当前主会话已同步到新模型。"
    } else {
        "当前主会话会在下次打开 Dashboard 时自动同步。"
    };

    Ok(OpenClawDeployResult {
        applied: true,
        started_gateway,
        message: format!(
            "已把主模型设置为 {primary_model_ref}{fallback_summary}，{auth_summary}{route_summary} {gateway_summary} {session_summary}"
        ),
    })
}

pub fn open_openclaw_dashboard_inner() -> Result<OpenClawDashboardLaunchResult, String> {
    let raw = run_openclaw_command_with_timeout(&["dashboard", "--no-open"], DASHBOARD_TIMEOUT)?;
    let url = extract_first_url(&raw).unwrap_or_else(|| "http://127.0.0.1:18789/".into());
    let model_synced = sync_openclaw_main_session_to_configured_model().unwrap_or(false);
    let reset_session = reset_openclaw_dashboard_session().unwrap_or(false);
    let fresh_url = normalize_dashboard_url_for_browser(&url);
    let copied = copy_text_to_clipboard(&fresh_url);

    Ok(OpenClawDashboardLaunchResult {
        opened: true,
        url: fresh_url,
        message: if copied && reset_session && model_synced {
            "已同步当前模型、重置主会话，并准备且复制带认证 token 的 Dashboard 链接。".into()
        } else if reset_session && model_synced {
            "已同步当前模型、重置主会话，并准备带认证 token 的 Dashboard 链接。".into()
        } else if reset_session {
            "已重置主会话，并准备带认证 token 的 Dashboard 链接。".into()
        } else if copied {
            "已准备并复制带认证 token 的 Dashboard 链接。".into()
        } else {
            "已准备带认证 token 的 Dashboard 链接。".into()
        },
    })
}

fn reset_openclaw_dashboard_session() -> Result<bool, String> {
    let params = json!({
        "key": "main",
        "reason": "new"
    })
    .to_string();
    run_openclaw_command_with_timeout(
        &["gateway", "call", "sessions.reset", "--params", &params, "--json"],
        PROBE_TIMEOUT,
    )
    .map(|_| true)
}

fn sync_openclaw_main_session_to_configured_model() -> Result<bool, String> {
    let Some(model_ref) = configured_openclaw_primary_model() else {
        return Ok(false);
    };
    sync_openclaw_main_session_model(&model_ref)
}

fn sync_openclaw_main_session_model(model_ref: &str) -> Result<bool, String> {
    let trimmed = model_ref.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }

    let params = json!({
        "key": "main",
        "model": trimmed
    })
    .to_string();
    run_openclaw_command_with_timeout(
        &["gateway", "call", "sessions.patch", "--params", &params, "--json"],
        PROBE_TIMEOUT,
    )
    .map(|_| true)
}

pub fn fetch_openclaw_skills_inner() -> Result<OpenClawSkillsCatalog, String> {
    let raw = run_openclaw_command_with_timeout(&["skills", "list", "--json"], OPENCLAW_MODELS_TIMEOUT)?;
    let parsed: RawOpenClawSkillsCatalog =
        serde_json::from_str(&raw).map_err(|error| format!("解析 skills 列表失败: {error}"))?;

    let ready_count = parsed.skills.iter().filter(|skill| skill.eligible).count();
    let total_count = parsed.skills.len();

    Ok(OpenClawSkillsCatalog {
        workspace_dir: parsed.workspace_dir,
        managed_skills_dir: parsed.managed_skills_dir,
        ready_count,
        total_count,
        skills: parsed.skills,
    })
}

pub fn fetch_openclaw_skill_detail_inner(name: String) -> Result<OpenClawSkillDetail, String> {
    let raw = run_openclaw_command_with_timeout(
        &["skills", "info", &name, "--json"],
        OPENCLAW_MODELS_TIMEOUT,
    )?;

    serde_json::from_str(&raw).map_err(|error| format!("解析 skill 详情失败: {error}"))
}

pub fn launch_openclaw_skill_install_inner(
    skill_name: String,
    action_id: String,
) -> Result<OpenClawSkillInstallLaunchResult, String> {
    let detail = fetch_openclaw_skill_detail_inner(skill_name.clone())?;
    let action = detail
        .install
        .iter()
        .find(|item| item.id == action_id)
        .ok_or_else(|| format!("未找到 {skill_name} 的安装动作 `{action_id}`。"))?;

    let command = build_skill_install_command(&detail, action)?;
    run_in_terminal(&command)?;

    Ok(OpenClawSkillInstallLaunchResult {
        started: true,
        skill_name,
        action_id,
        command,
        message: format!("已在 Terminal 中拉起 “{}”。", action.label),
    })
}

struct OpenClawAuthFlow {
    display_name: String,
    auth_providers: Vec<String>,
    command: String,
    launch_message: String,
    pending_message: String,
    auth_store_path: PathBuf,
}

fn resolve_openclaw_auth_flow(provider_id: &str) -> Result<OpenClawAuthFlow, String> {
    let executable = resolve_openclaw_executable()
        .map(|path| shell_quote(&path.display().to_string()))
        .unwrap_or_else(|| "openclaw".into());
    let auth_store_path = default_openclaw_state_dir()?.join("agents").join("main").join("agent").join("auth-profiles.json");

    match provider_id {
        "openai" | "openai-codex" => Ok(OpenClawAuthFlow {
            display_name: "OpenAI Codex OAuth".into(),
            auth_providers: vec!["openai-codex".into()],
            command: format!("{executable} models auth login --provider openai-codex"),
            launch_message: "已拉起 OpenAI Codex OAuth 登录。浏览器授权完成后，回到应用里点“检查授权状态”。".into(),
            pending_message: "还没有检测到 OpenAI Codex 的 OAuth 配置。完成浏览器授权后，再点一次“检查授权状态”。".into(),
            auth_store_path,
        }),
        "anthropic" => Ok(OpenClawAuthFlow {
            display_name: "Anthropic setup-token".into(),
            auth_providers: vec!["anthropic".into()],
            command: format!("{executable} models auth setup-token --provider anthropic"),
            launch_message: "已拉起 Anthropic setup-token 流程。把 token 粘贴完成后，回到应用里点“检查授权状态”。".into(),
            pending_message: "还没有检测到 Anthropic 的 setup-token 配置。完成 token 粘贴后，再点一次“检查授权状态”。".into(),
            auth_store_path,
        }),
        "google-antigravity" => Ok(OpenClawAuthFlow {
            display_name: "Google Antigravity OAuth".into(),
            auth_providers: vec!["google-antigravity".into()],
            command: format!(
                "{executable} plugins enable google-antigravity-auth && {executable} models auth login --provider google-antigravity --set-default"
            ),
            launch_message: "已拉起 Google Antigravity 登录；会先启用插件，再走 Google 账号授权。".into(),
            pending_message: "还没有检测到 Google Antigravity 的授权配置。完成浏览器授权后，再点一次“检查授权状态”。".into(),
            auth_store_path,
        }),
        "google-gemini-cli" => Ok(OpenClawAuthFlow {
            display_name: "Google Gemini CLI OAuth".into(),
            auth_providers: vec!["google-gemini-cli".into()],
            command: format!(
                "{executable} plugins enable google-gemini-cli-auth && {executable} models auth login --provider google-gemini-cli --set-default"
            ),
            launch_message: "已拉起 Gemini CLI 登录；会先启用插件，再走 Google 账号授权。".into(),
            pending_message: "还没有检测到 Gemini CLI 的授权配置。完成浏览器授权后，再点一次“检查授权状态”。".into(),
            auth_store_path,
        }),
        "qwen-portal" => Ok(OpenClawAuthFlow {
            display_name: "Qwen Portal OAuth".into(),
            auth_providers: vec!["qwen-portal".into(), "qwen".into()],
            command: format!(
                "{executable} plugins enable qwen-portal-auth && {executable} models auth login --provider qwen-portal --set-default"
            ),
            launch_message: "已拉起 Qwen Portal 设备码登录；会先启用插件，再走 Qwen 授权。".into(),
            pending_message: "还没有检测到 Qwen Portal 的授权配置。完成设备码授权后，再点一次“检查授权状态”。".into(),
            auth_store_path,
        }),
        "minimax-portal" => Ok(OpenClawAuthFlow {
            display_name: "MiniMax Portal OAuth".into(),
            auth_providers: vec!["minimax-portal".into()],
            command: format!(
                "{executable} plugins enable minimax-portal-auth && {executable} onboard --auth-choice minimax-portal"
            ),
            launch_message: "已拉起 MiniMax Coding Plan OAuth；会先启用插件，再按向导完成登录。".into(),
            pending_message: "还没有检测到 MiniMax Portal 的授权配置。完成登录后，再点一次“检查授权状态”。".into(),
            auth_store_path,
        }),
        _ => Err("当前 provider 不支持 OAuth / setup-token 登录。".into()),
    }
}

fn resolve_openclaw_executable() -> Option<PathBuf> {
    openclaw_command_candidates()
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_absolute() && path.is_file())
}

fn build_gateway_run_command() -> String {
    let executable = resolve_openclaw_executable()
        .map(|path| shell_quote(&path.display().to_string()))
        .unwrap_or_else(|| "openclaw".into());
    format!("{executable} gateway run --allow-unconfigured")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn default_openclaw_state_dir() -> Result<PathBuf, String> {
    if let Some(state_dir) = env::var_os("OPENCLAW_STATE_DIR") {
        return Ok(PathBuf::from(state_dir));
    }

    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位当前用户目录。".to_string())?;

    Ok(home.join(".openclaw"))
}

fn auth_store_has_provider_profile(path: &Path, providers: &[String]) -> Result<bool, String> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("读取 auth-profiles.json 失败: {error}")),
    };

    let value: Value = serde_json::from_str(&contents)
        .map_err(|error| format!("解析 auth-profiles.json 失败: {error}"))?;
    let Some(profiles) = value.get("profiles").and_then(Value::as_object) else {
        return Ok(false);
    };

    let provider_set = providers
        .iter()
        .map(|provider| provider.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();

    for (profile_id, entry) in profiles {
        let Some(record) = entry.as_object() else {
            continue;
        };

        let provider = record
            .get("provider")
            .and_then(Value::as_str)
            .map(|value| value.to_ascii_lowercase())
            .or_else(|| profile_id.split_once(':').map(|(provider, _)| provider.to_ascii_lowercase()));
        let credential_type = record
            .get("type")
            .or_else(|| record.get("mode"))
            .and_then(Value::as_str)
            .map(|value| value.to_ascii_lowercase());

        if let (Some(provider), Some(credential_type)) = (provider, credential_type) {
            let has_secret = auth_profile_has_secret(record, &credential_type);

            if has_secret && provider_set.contains(&provider) {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

fn auth_profile_has_secret(record: &Map<String, Value>, credential_type: &str) -> bool {
    match credential_type {
        "oauth" => record.contains_key("access") || record.contains_key("refresh"),
        "token" => record.contains_key("token"),
        "api_key" => record.contains_key("key") || record.contains_key("apiKey"),
        _ => false,
    }
}

fn default_openclaw_auth_store_path() -> Result<PathBuf, String> {
    Ok(default_openclaw_state_dir()?
        .join("agents")
        .join("main")
        .join("agent")
        .join("auth-profiles.json"))
}

fn default_openclaw_config_path() -> Result<PathBuf, String> {
    Ok(default_openclaw_state_dir()?.join("openclaw.json"))
}

fn configured_openclaw_primary_model() -> Option<String> {
    let config_path = default_openclaw_config_path().ok()?;
    let value = read_json_value_or_default(&config_path, Value::Object(Map::new())).ok()?;

    value
        .get("model")
        .and_then(Value::as_object)
        .and_then(|model| model.get("primary"))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            value
                .get("agents")
                .and_then(Value::as_object)
                .and_then(|agents| agents.get("defaults"))
                .and_then(Value::as_object)
                .and_then(|defaults| defaults.get("model"))
                .and_then(Value::as_object)
                .and_then(|model| model.get("primary"))
                .and_then(Value::as_str)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

fn split_openclaw_model_ref(model_ref: &str) -> Option<(String, String)> {
    let trimmed = model_ref.trim();
    let (provider_id, model_id) = trimmed.split_once('/')?;
    let provider_id = provider_id.trim();
    let model_id = model_id.trim();
    if provider_id.is_empty() || model_id.is_empty() {
        return None;
    }

    Some((provider_id.to_string(), model_id.to_string()))
}

fn configure_provider_route_for_deploy(
    provider_id: &str,
    route_id: &str,
    model_ref: &str,
    api_secret: Option<&str>,
) -> Result<Option<String>, String> {
    let provider_id = provider_id.trim().to_ascii_lowercase();
    if provider_id.is_empty() {
        return Ok(None);
    }

    match provider_id.as_str() {
        "zai" => configure_zai_provider_route(route_id, model_ref, api_secret).map(Some),
        "moonshot" => configure_moonshot_provider_route(route_id, model_ref).map(Some),
        "minimax" | "minimax-cn" => configure_minimax_provider_route(&provider_id, model_ref).map(Some),
        _ => Ok(None),
    }
}

fn configure_zai_provider_route(
    route_id: &str,
    model_ref: &str,
    api_secret: Option<&str>,
) -> Result<String, String> {
    let (_, model_id) = split_openclaw_model_ref(model_ref)
        .ok_or_else(|| "GLM 模型引用无效，无法配置接入路线。".to_string())?;
    let resolved_route_id = resolve_zai_route_id(route_id, &model_id, api_secret)?;
    let (route_label, base_url) = match resolved_route_id.as_str() {
        "cn" => ("BigModel CN", ZAI_CN_BASE_URL),
        "global" => ("Z.AI Global", ZAI_GLOBAL_BASE_URL),
        other => return Err(format!("不支持的 Z.AI 接入路线: {other}")),
    };

    upsert_provider_runtime_config(
        "zai",
        json!({
            "baseUrl": base_url,
            "api": "openai-completions",
            "models": [
                {
                    "id": "glm-5",
                    "name": "GLM-5",
                    "reasoning": true,
                    "input": ["text"],
                    "contextWindow": 204800,
                    "maxTokens": 131072
                },
                {
                    "id": "glm-4.7",
                    "name": "GLM-4.7",
                    "reasoning": true,
                    "input": ["text"],
                    "contextWindow": 204800,
                    "maxTokens": 131072
                },
                {
                    "id": "glm-4.7-flash",
                    "name": "GLM-4.7 Flash",
                    "reasoning": true,
                    "input": ["text"],
                    "contextWindow": 204800,
                    "maxTokens": 131072
                },
                {
                    "id": "glm-4.7-flashx",
                    "name": "GLM-4.7 FlashX",
                    "reasoning": true,
                    "input": ["text"],
                    "contextWindow": 204800,
                    "maxTokens": 131072
                }
            ]
        }),
    )?;

    Ok(format!("Z.AI 接入路线已切到 {route_label}"))
}

fn resolve_zai_route_id(
    route_id: &str,
    model_id: &str,
    api_secret: Option<&str>,
) -> Result<String, String> {
    let normalized = route_id.trim().to_ascii_lowercase();
    if matches!(normalized.as_str(), "global" | "cn") {
        return Ok(normalized);
    }

    let api_key = api_secret
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| read_api_key_profile_secret("zai").ok())
        .ok_or_else(|| "缺少 Z.AI API Key，无法自动识别 BigModel / Z.AI 路线。".to_string())?;

    let current_base_url = read_provider_base_url("zai").ok().flatten();
    let mut candidates = Vec::new();
    if let Some(base_url) = current_base_url {
        if base_url == ZAI_CN_BASE_URL {
            candidates.push(("cn", ZAI_CN_BASE_URL));
        } else if base_url == ZAI_GLOBAL_BASE_URL {
            candidates.push(("global", ZAI_GLOBAL_BASE_URL));
        }
    }
    candidates.push(("cn", ZAI_CN_BASE_URL));
    candidates.push(("global", ZAI_GLOBAL_BASE_URL));

    let mut seen = BTreeSet::new();
    for (candidate_id, base_url) in candidates {
        if !seen.insert(candidate_id) {
            continue;
        }

        if probe_openai_chat_endpoint(base_url, &api_key, model_id).is_ok() {
            return Ok(candidate_id.to_string());
        }
    }

    Err("已检测到 Z.AI API Key，但 `open.bigmodel.cn` 和 `api.z.ai` 都未通过连通性测试。请确认 Key 对应的站点，再重试。".into())
}

fn configure_moonshot_provider_route(route_id: &str, model_ref: &str) -> Result<String, String> {
    let (_, model_id) = split_openclaw_model_ref(model_ref)
        .ok_or_else(|| "Moonshot 模型引用无效，无法配置接入路线。".to_string())?;
    let normalized = route_id.trim().to_ascii_lowercase();
    let (route_label, base_url) = match normalized.as_str() {
        "" | "global" | "auto" => ("Moonshot Global", MOONSHOT_GLOBAL_BASE_URL),
        "cn" => ("Moonshot CN", MOONSHOT_CN_BASE_URL),
        other => return Err(format!("不支持的 Moonshot 接入路线: {other}")),
    };

    upsert_provider_runtime_config(
        "moonshot",
        json!({
            "baseUrl": base_url,
            "api": "openai-completions",
            "models": [
                {
                    "id": model_id,
                    "name": "Kimi K2.5",
                    "reasoning": false,
                    "input": ["text", "image"],
                    "contextWindow": 256000,
                    "maxTokens": 8192
                }
            ]
        }),
    )?;

    Ok(format!("Moonshot 接入路线已切到 {route_label}"))
}

fn configure_minimax_provider_route(provider_id: &str, model_ref: &str) -> Result<String, String> {
    let (_, model_id) = split_openclaw_model_ref(model_ref)
        .ok_or_else(|| "MiniMax 模型引用无效，无法配置接入路线。".to_string())?;
    let (route_label, base_url) = match provider_id {
        "minimax" => ("MiniMax Global", MINIMAX_GLOBAL_BASE_URL),
        "minimax-cn" => ("MiniMax CN", MINIMAX_CN_BASE_URL),
        other => return Err(format!("不支持的 MiniMax provider: {other}")),
    };

    upsert_provider_runtime_config(
        provider_id,
        json!({
            "baseUrl": base_url,
            "api": "anthropic-messages",
            "authHeader": true,
            "models": [
                {
                    "id": model_id,
                    "name": model_id,
                    "reasoning": true,
                    "input": ["text"],
                    "contextWindow": 200000,
                    "maxTokens": 8192
                }
            ]
        }),
    )?;

    Ok(format!("MiniMax 接入路线已切到 {route_label}"))
}

fn read_api_key_profile_secret(provider_id: &str) -> Result<String, String> {
    let auth_store_path = default_openclaw_auth_store_path()?;
    let value = read_json_value_or_default(
        &auth_store_path,
        json!({
            "version": 1,
            "profiles": {}
        }),
    )?;
    let Some(profiles) = value.get("profiles").and_then(Value::as_object) else {
        return Err("auth-profiles.json 中没有 profiles 字段。".into());
    };

    let profile_key = format!("{}:default", provider_id.trim().to_ascii_lowercase());
    let Some(profile) = profiles.get(&profile_key).and_then(Value::as_object) else {
        return Err(format!("没有找到 {} 的默认 API Key 配置。", provider_id));
    };

    profile
        .get("key")
        .or_else(|| profile.get("apiKey"))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{} 的默认 API Key 配置为空。", provider_id))
}

fn read_provider_base_url(provider_id: &str) -> Result<Option<String>, String> {
    let config_path = default_openclaw_config_path()?;
    let value = read_json_value_or_default(&config_path, Value::Object(Map::new()))?;
    Ok(value
        .get("models")
        .and_then(Value::as_object)
        .and_then(|models| models.get("providers"))
        .and_then(Value::as_object)
        .and_then(|providers| providers.get(provider_id))
        .and_then(Value::as_object)
        .and_then(|provider| provider.get("baseUrl"))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty()))
}

fn upsert_provider_runtime_config(provider_id: &str, patch: Value) -> Result<(), String> {
    let config_path = default_openclaw_config_path()?;
    let mut config = read_json_value_or_default(&config_path, Value::Object(Map::new()))?;
    let root = ensure_json_object(&mut config);
    let models = ensure_child_object(root, "models");
    models
        .entry("mode")
        .or_insert_with(|| Value::String("merge".into()));
    let providers = ensure_child_object(models, "providers");
    let entry = providers
        .entry(provider_id.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let provider = ensure_json_object(entry);
    let patch = patch
        .as_object()
        .ok_or_else(|| format!("provider patch `{provider_id}` 必须是对象。"))?;
    for (key, value) in patch {
        provider.insert(key.clone(), value.clone());
    }
    write_json_value(&config_path, &config)
}

fn probe_openai_chat_endpoint(base_url: &str, api_key: &str, model_id: &str) -> Result<(), String> {
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let client = Client::builder()
        .timeout(PROVIDER_ROUTE_PROBE_TIMEOUT)
        .build()
        .map_err(|error| format!("创建探测客户端失败: {error}"))?;
    let body = serde_json::to_string(&json!({
        "model": model_id,
        "messages": [
            {
                "role": "user",
                "content": "Reply with exactly OK."
            }
        ],
        "max_tokens": 16,
        "temperature": 0
    }))
    .map_err(|error| format!("序列化 provider 探测请求失败: {error}"))?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .map_err(|error| error.to_string())?;

    if response.status().is_success() {
        return Ok(());
    }

    Err(format!("HTTP {}", response.status()))
}

fn read_json_value_or_default(path: &Path, default: Value) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("解析 {} 失败: {error}", path.display())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(default),
        Err(error) => Err(format!("读取 {} 失败: {error}", path.display())),
    }
}

fn write_json_value(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 {} 失败: {error}", parent.display()))?;
    }

    let serialized = serde_json::to_string_pretty(value)
        .map_err(|error| format!("序列化 {} 失败: {error}", path.display()))?;
    fs::write(path, format!("{serialized}\n"))
        .map_err(|error| format!("写入 {} 失败: {error}", path.display()))
}

fn ensure_json_object(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }

    value.as_object_mut().expect("value should be object")
}

fn ensure_child_object<'a>(parent: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let entry = parent
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    ensure_json_object(entry)
}

fn collect_auth_profiles(
    providers: &[String],
    allowed_types: &[&str],
) -> Result<BTreeMap<String, Vec<(String, String)>>, String> {
    let auth_store_path = default_openclaw_auth_store_path()?;
    let value = read_json_value_or_default(
        &auth_store_path,
        json!({
            "version": 1,
            "profiles": {}
        }),
    )?;
    let Some(profiles) = value.get("profiles").and_then(Value::as_object) else {
        return Ok(BTreeMap::new());
    };
    let provider_set = providers
        .iter()
        .map(|provider| provider.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    let allowed_type_set = allowed_types
        .iter()
        .map(|kind| kind.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    let mut provider_to_profiles = BTreeMap::new();

    for (profile_id, entry) in profiles {
        let Some(record) = entry.as_object() else {
            continue;
        };
        let Some(provider) = record
            .get("provider")
            .and_then(Value::as_str)
            .map(|value| value.to_ascii_lowercase())
            .or_else(|| profile_id.split_once(':').map(|(provider, _)| provider.to_ascii_lowercase()))
        else {
            continue;
        };
        let Some(credential_type) = record
            .get("type")
            .or_else(|| record.get("mode"))
            .and_then(Value::as_str)
            .map(|value| value.to_ascii_lowercase())
        else {
            continue;
        };
        if !provider_set.contains(&provider)
            || !allowed_type_set.contains(&credential_type)
            || !auth_profile_has_secret(record, &credential_type)
        {
            continue;
        }

        provider_to_profiles
            .entry(provider)
            .or_insert_with(Vec::new)
            .push((profile_id.clone(), credential_type));
    }

    Ok(provider_to_profiles)
}

fn sync_auth_metadata(
    provider_to_profiles: &BTreeMap<String, Vec<(String, String)>>,
) -> Result<(), String> {
    let config_path = default_openclaw_config_path()?;
    let mut config = read_json_value_or_default(&config_path, Value::Object(Map::new()))?;
    let config_root = ensure_json_object(&mut config);
    let auth = ensure_child_object(config_root, "auth");
    ensure_child_object(auth, "profiles");
    ensure_child_object(auth, "order");

    for (provider, profiles) in provider_to_profiles {
        let order = profiles
            .iter()
            .map(|(profile_id, mode)| {
                ensure_child_object(auth, "profiles").insert(
                    profile_id.clone(),
                    json!({
                        "provider": provider,
                        "mode": mode,
                    }),
                );
                Value::String(profile_id.clone())
            })
            .collect::<Vec<_>>();
        ensure_child_object(auth, "order").insert(provider.clone(), Value::Array(order));
    }

    write_json_value(&config_path, &config)
}

fn ensure_login_profiles_ready(provider_id: &str) -> Result<(), String> {
    let flow = resolve_openclaw_auth_flow(provider_id)?;
    let provider_to_profiles = collect_auth_profiles(&flow.auth_providers, &["oauth", "token"])?;
    if provider_to_profiles.is_empty() {
        return Err(flow.pending_message);
    }

    sync_auth_metadata(&provider_to_profiles)
}

fn upsert_api_key_profile(provider_id: &str, api_secret: &str) -> Result<(), String> {
    let provider_id = provider_id.trim().to_ascii_lowercase();
    if provider_id.is_empty() {
        return Err("当前 provider 无效，无法写入 API Key。".into());
    }

    let auth_store_path = default_openclaw_auth_store_path()?;
    let mut auth_store = read_json_value_or_default(
        &auth_store_path,
        json!({
            "version": 1,
            "profiles": {}
        }),
    )?;
    let auth_root = ensure_json_object(&mut auth_store);
    auth_root.insert("version".into(), Value::Number(1.into()));
    let profiles = ensure_child_object(auth_root, "profiles");
    let profile_id = format!("{provider_id}:default");
    profiles.insert(
        profile_id,
        json!({
            "type": "api_key",
            "provider": provider_id,
            "key": api_secret,
        }),
    );
    write_json_value(&auth_store_path, &auth_store)?;

    let provider_to_profiles = collect_auth_profiles(&[provider_id], &["api_key"])?;
    sync_auth_metadata(&provider_to_profiles)
}

pub fn switch_mirror_mode_inner(mode: MirrorMode) -> Result<MirrorSwitchResult, String> {
    let mut settings = load_app_settings();
    settings.mirror_mode = mode;
    save_app_settings(settings)?;
    update_npm_mirror(mode)?;

    Ok(MirrorSwitchResult {
        mode,
        message: match mode {
            MirrorMode::Official => "已恢复官方源。".into(),
            MirrorMode::China => "已切换到国内镜像。".into(),
        },
    })
}

fn current_platform() -> Result<Platform, String> {
    match env::consts::OS {
        "macos" => Ok(Platform::Macos),
        "windows" => Ok(Platform::Windows),
        other => Err(format!("暂不支持的平台: {other}")),
    }
}

fn probe_snapshot(platform: Platform) -> ProbeSnapshot {
    let node_handle = thread::spawn(probe_node);
    let npm_handle = thread::spawn(probe_npm);
    let git_handle = thread::spawn(probe_git);
    let homebrew_handle = (platform == Platform::Macos).then(|| thread::spawn(probe_homebrew));

    ProbeSnapshot {
        node: join_probe_handle("Node.js", node_handle),
        npm: join_probe_handle("npm", npm_handle),
        git: join_probe_handle("Git", git_handle),
        homebrew: homebrew_handle.map(|handle| join_probe_handle("Homebrew", handle)),
    }
}

fn build_scan(platform: Platform, mirror_mode: MirrorMode, snapshot: ProbeSnapshot) -> EnvironmentScan {
    let checks = build_checks(platform, snapshot);
    let git_ready = checks
        .iter()
        .find(|check| check.id == DependencyId::Git)
        .is_some_and(|check| check.status == CheckStatus::Installed);
    let overall_ready = checks
        .iter()
        .filter(|check| check.visible)
        .all(|check| {
            check.status == CheckStatus::Installed
                || (platform == Platform::Macos && git_ready && check.id == DependencyId::Homebrew)
        });

    EnvironmentScan {
        platform,
        scanned_at: current_timestamp(),
        mirror_mode,
        checks,
        overall_ready,
    }
}

fn build_checks(platform: Platform, snapshot: ProbeSnapshot) -> Vec<DependencyCheck> {
    let mut checks = Vec::with_capacity(4);
    let homebrew_probe = snapshot.homebrew.clone();
    let git_ready = matches!(snapshot.git.status, CheckStatus::Installed);

    checks.push(build_node_check(snapshot.node.clone()));
    checks.push(build_npm_check(snapshot.npm.clone(), snapshot.node.clone()));
    checks.push(build_git_check(
        platform,
        snapshot.git.clone(),
        homebrew_probe.clone(),
    ));

    if platform == Platform::Macos {
        checks.push(build_homebrew_check(
            homebrew_probe.unwrap_or_else(missing_probe),
            git_ready,
        ));
    } else {
        checks.push(DependencyCheck {
            id: DependencyId::Homebrew,
            title: "Homebrew".into(),
            status: CheckStatus::Missing,
            version: None,
            required_version: None,
            summary: "Homebrew 仅在 macOS 显示。".into(),
            action_label: "当前平台不适用".into(),
            action_enabled: false,
            visible: false,
        });
    }

    checks
}

fn build_node_check(probe: ProbeResult) -> DependencyCheck {
    let (summary, action_label, action_enabled) = match probe.status {
        CheckStatus::Installed => (
            format!(
                "已检测到 Node.js {}，满足 OpenClaw 的运行时前置条件。",
                probe.version.clone().unwrap_or_else(|| "22+".into())
            ),
            "Node.js 已满足".into(),
            false,
        ),
        CheckStatus::Outdated => (
            format!(
                "检测到 Node.js {}，低于要求的 {NODE_REQUIRED_VERSION}。请升级到 22 LTS 或更高版本。",
                probe.version.clone().unwrap_or_else(|| "未知版本".into())
            ),
            "安装 Node.js 22 LTS".into(),
            true,
        ),
        CheckStatus::Missing => (
            "未检测到 Node.js，请安装 22 LTS 或更高版本。".into(),
            "安装 Node.js 22 LTS".into(),
            true,
        ),
        CheckStatus::Error => (
            format!(
                "检测 Node.js 时发生异常：{}",
                probe.details
                    .clone()
                    .unwrap_or_else(|| "命令输出无法解析".into())
            ),
            "重新安装 Node.js".into(),
            true,
        ),
    };

    DependencyCheck {
        id: DependencyId::Node,
        title: "Node.js".into(),
        status: probe.status,
        version: probe.version,
        required_version: Some(NODE_REQUIRED_VERSION.into()),
        summary,
        action_label,
        action_enabled,
        visible: true,
    }
}

fn build_npm_check(probe: ProbeResult, node_probe: ProbeResult) -> DependencyCheck {
    let node_missing = matches!(node_probe.status, CheckStatus::Missing);
    let node_broken = matches!(node_probe.status, CheckStatus::Outdated | CheckStatus::Error);

    let (summary, action_label, action_enabled) = match probe.status {
        CheckStatus::Installed => (
            format!(
                "已检测到 npm {}，可用于后续前端或依赖安装。",
                probe.version.clone().unwrap_or_else(|| "可用".into())
            ),
            "npm 已满足".into(),
            false,
        ),
        CheckStatus::Missing if node_missing => (
            "npm 将随 Node.js 一起安装，无需单独处理。".into(),
            "随 Node.js 一起安装".into(),
            true,
        ),
        CheckStatus::Missing | CheckStatus::Error if node_broken => (
            "Node.js 当前不可用，建议重新安装 Node.js 22 LTS 来恢复 npm。".into(),
            "重新安装 Node.js".into(),
            true,
        ),
        CheckStatus::Missing | CheckStatus::Error => (
            "未检测到 npm，建议重新安装 Node.js 22 LTS 修复。".into(),
            "重新安装 Node.js".into(),
            true,
        ),
        CheckStatus::Outdated => (
            "检测到异常的 npm 版本，建议重新安装 Node.js。".into(),
            "重新安装 Node.js".into(),
            true,
        ),
    };

    DependencyCheck {
        id: DependencyId::Npm,
        title: "npm".into(),
        status: probe.status,
        version: probe.version,
        required_version: None,
        summary,
        action_label,
        action_enabled,
        visible: true,
    }
}

fn build_git_check(
    platform: Platform,
    probe: ProbeResult,
    homebrew_probe: Option<ProbeResult>,
) -> DependencyCheck {
    let brew_ready = matches!(
        homebrew_probe.as_ref().map(|item| item.status),
        Some(CheckStatus::Installed)
    );

    let (summary, action_label, action_enabled) = match probe.status {
        CheckStatus::Installed => (
            format!(
                "已检测到 Git {}，可用于拉取配方和源码依赖。",
                probe.version.clone().unwrap_or_else(|| "可用".into())
            ),
            "Git 已满足".into(),
            false,
        ),
        CheckStatus::Outdated | CheckStatus::Missing | CheckStatus::Error => match platform {
            Platform::Windows => (
                "未检测到可用的 Git，将从 Git for Windows 官方安装包进行安装。".into(),
                "安装 Git".into(),
                true,
            ),
            Platform::Macos if brew_ready => (
                "未检测到可用的 Git，将通过 Homebrew 执行 brew install git。".into(),
                "安装 Git".into(),
                true,
            ),
            Platform::Macos => (
                "未检测到可用的 Git。macOS 需要先安装 Homebrew，再通过 brew 安装 Git。".into(),
                "先安装 Homebrew".into(),
                true,
            ),
        },
    };

    DependencyCheck {
        id: DependencyId::Git,
        title: "Git".into(),
        status: probe.status,
        version: probe.version,
        required_version: None,
        summary,
        action_label,
        action_enabled,
        visible: true,
    }
}

fn build_homebrew_check(probe: ProbeResult, git_ready: bool) -> DependencyCheck {
    if git_ready {
        return DependencyCheck {
            id: DependencyId::Homebrew,
            title: "Homebrew".into(),
            status: probe.status,
            version: probe.version,
            required_version: None,
            summary: "当前 Git 已可用；Homebrew 会继续显示，但不再阻塞环境检测通过。".into(),
            action_label: "当前非必需".into(),
            action_enabled: false,
            visible: true,
        };
    }

    let (summary, action_label, action_enabled) = match probe.status {
        CheckStatus::Installed => (
            format!(
                "已检测到 Homebrew {}，可用于在 macOS 上安装 Git。",
                probe.version.clone().unwrap_or_else(|| "可用".into())
            ),
            "Homebrew 已满足".into(),
            false,
        ),
        CheckStatus::Missing => (
            "未检测到 Homebrew。它是 macOS 上安装 Git 的前置依赖。".into(),
            "安装 Homebrew".into(),
            true,
        ),
        CheckStatus::Outdated | CheckStatus::Error => (
            "Homebrew 当前不可用，建议重新执行官方安装脚本。".into(),
            "安装 Homebrew".into(),
            true,
        ),
    };

    DependencyCheck {
        id: DependencyId::Homebrew,
        title: "Homebrew".into(),
        status: probe.status,
        version: probe.version,
        required_version: None,
        summary,
        action_label,
        action_enabled,
        visible: true,
    }
}

fn probe_node() -> ProbeResult {
    let output = probe_command("node", ["-v"]);
    normalize_probe(output, parse_version_like, Some(parse_node_status))
}

fn probe_npm() -> ProbeResult {
    let output = probe_command("npm", ["-v"]);
    normalize_probe(output, parse_version_like, None)
}

fn probe_git() -> ProbeResult {
    let output = probe_command("git", ["--version"]);
    normalize_probe(output, parse_git_version, None)
}

fn probe_homebrew() -> ProbeResult {
    let output = probe_command("brew", ["--version"]);
    normalize_probe(output, parse_brew_version, None)
}

fn probe_openclaw_version() -> ProbeResult {
    let output = run_openclaw_command_with_timeout(&["--version"], PROBE_TIMEOUT);
    normalize_probe(output, parse_version_like, None)
}

fn probe_openclaw_runtime_status() -> OpenClawRuntimeStatus {
    if let Some(status) = probe_openclaw_runtime_http_status() {
        return status;
    }

    for args in [
        &["health", "--json", "--timeout", "1500"][..],
        &["health", "--timeout", "1500"][..],
    ] {
        match run_openclaw_command_with_timeout(args, OPENCLAW_HEALTH_TIMEOUT) {
            Ok(raw) => {
                return if openclaw_runtime_is_running(&raw) {
                    OpenClawRuntimeStatus::Running
                } else {
                    OpenClawRuntimeStatus::Stopped
                };
            }
            Err(error) if error == "missing" => return OpenClawRuntimeStatus::Stopped,
            Err(_) => continue,
        }
    }

    OpenClawRuntimeStatus::Stopped
}

fn probe_openclaw_runtime_http_status() -> Option<OpenClawRuntimeStatus> {
    let port = configured_gateway_port().unwrap_or(18789);
    let client = Client::builder()
        .timeout(OPENCLAW_HEALTH_TIMEOUT)
        .build()
        .ok()?;

    for url in [
        format!("http://127.0.0.1:{port}/health"),
        format!("http://[::1]:{port}/health"),
    ] {
        let Ok(response) = client.get(&url).send() else {
            continue;
        };
        let Ok(body) = response.text() else {
            continue;
        };
        return Some(if openclaw_runtime_is_running(&body) {
            OpenClawRuntimeStatus::Running
        } else {
            OpenClawRuntimeStatus::Stopped
        });
    }

    None
}

fn configured_gateway_port() -> Option<u16> {
    let config_path = default_openclaw_config_path().ok()?;
    let value = read_json_value_or_default(&config_path, Value::Object(Map::new())).ok()?;
    let port = value
        .get("gateway")
        .and_then(Value::as_object)
        .and_then(|gateway| gateway.get("port"))
        .and_then(Value::as_u64)?;
    u16::try_from(port).ok()
}

fn join_probe_handle(title: &str, handle: thread::JoinHandle<ProbeResult>) -> ProbeResult {
    handle.join().unwrap_or_else(|_| ProbeResult {
        status: CheckStatus::Error,
        version: None,
        details: Some(format!("{title} 检测线程意外中止")),
    })
}

fn openclaw_runtime_is_running(raw: &str) -> bool {
    let normalized = raw.to_ascii_lowercase().replace(char::is_whitespace, "");
    normalized.contains("\"status\":\"running\"")
        || normalized.contains("\"status\":\"ok\"")
        || normalized.contains("\"ok\":true")
        || normalized.contains("\"loaded\":true")
        || normalized.contains("healthy")
        || normalized.contains("runtime:running")
        || normalized.contains("\"gateway\":\"ok\"")
        || normalized.contains("\"healthy\":true")
}

fn extract_first_url(raw: &str) -> Option<String> {
    Regex::new(r"https?://[^\s]+")
        .ok()
        .and_then(|regex| regex.find(raw))
        .map(|matched| matched.as_str().trim_end_matches('.').to_string())
}

fn normalize_dashboard_url_for_browser(url: &str) -> String {
    let nonce = current_timestamp();
    let mut parsed = reqwest::Url::parse(url)
        .or_else(|_| reqwest::Url::parse("http://127.0.0.1:18789/"))
        .expect("fallback dashboard URL should always parse");
    let token = parsed
        .query()
        .and_then(|query| extract_dashboard_param(query, "token"))
        .or_else(|| parsed.fragment().and_then(|fragment| extract_dashboard_param(fragment, "token")));
    let session = parsed
        .query()
        .and_then(|query| extract_dashboard_param(query, "session"))
        .unwrap_or_else(|| "main".into());

    if parsed.path().trim().is_empty() {
        parsed.set_path("/");
    }
    parsed.set_fragment(None);
    {
        let mut query = parsed.query_pairs_mut();
        query.clear();
        query.append_pair("openclawDeployerTs", &nonce.to_string());
        query.append_pair("session", &session);
        if let Some(token) = &token {
            query.append_pair("token", token);
        }
    }
    if let Some(token) = token {
        parsed.set_fragment(Some(&format!("token={token}")));
    }

    parsed.into()
}

fn extract_dashboard_param(raw: &str, key: &str) -> Option<String> {
    raw.trim_start_matches(['?', '#'])
        .split('&')
        .find_map(|part| {
            let (name, value) = part.split_once('=')?;
            (name == key && !value.is_empty()).then(|| value.to_string())
        })
}

fn copy_text_to_clipboard(text: &str) -> bool {
    match env::consts::OS {
        "macos" => Command::new("pbcopy")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .and_then(|mut child| {
                if let Some(mut stdin) = child.stdin.take() {
                    stdin.write_all(text.as_bytes())?;
                }
                child.wait()
            })
            .map(|status| status.success())
            .unwrap_or(false),
        _ => false,
    }
}

fn build_skill_install_command(
    detail: &OpenClawSkillDetail,
    action: &OpenClawSkillInstallAction,
) -> Result<String, String> {
    let package = action
        .bins
        .first()
        .cloned()
        .unwrap_or_else(|| detail.name.clone());

    match action.kind.as_str() {
        "brew" => Ok(format!("brew install {package}")),
        "node" => Ok(format!("npm install -g {package}")),
        "uv" => Ok(format!("uv tool install {package}")),
        "go" => {
            let repo = detail
                .homepage
                .as_deref()
                .and_then(extract_github_repo_from_url)
                .ok_or_else(|| format!("{} 当前没有可推导的 go install 地址。", detail.name))?;
            Ok(format!("go install {repo}@latest"))
        }
        other => Err(format!("当前还不支持 `{other}` 类型的自动安装。")),
    }
}

fn extract_github_repo_from_url(raw: &str) -> Option<String> {
    Regex::new(r"github\.com/([^/\s]+/[^/\s]+)")
        .ok()
        .and_then(|regex| regex.captures(raw))
        .and_then(|captures| captures.get(1).map(|value| value.as_str().trim_end_matches(".git").to_string()))
}

fn normalize_probe(
    output: Result<String, String>,
    version_parser: fn(&str) -> Option<String>,
    status_parser: Option<fn(&str, Option<String>) -> ProbeResult>,
) -> ProbeResult {
    match output {
        Ok(raw) => {
            let version = version_parser(&raw);
            if let Some(parser) = status_parser {
                return parser(&raw, version);
            }

            match version {
                Some(parsed_version) => ProbeResult {
                    status: CheckStatus::Installed,
                    version: Some(parsed_version),
                    details: None,
                },
                None if status_parser.is_none() => ProbeResult {
                    status: CheckStatus::Installed,
                    version: None,
                    details: Some(raw),
                },
                None => ProbeResult {
                    status: CheckStatus::Error,
                    version: None,
                    details: Some(raw),
                },
            }
        }
        Err(error) if error == "missing" => missing_probe(),
        Err(error) => ProbeResult {
            status: CheckStatus::Error,
            version: None,
            details: Some(error),
        },
    }
}

fn parse_node_status(raw: &str, version: Option<String>) -> ProbeResult {
    match version {
        Some(parsed_version) if node_version_supported(&parsed_version) => ProbeResult {
            status: CheckStatus::Installed,
            version: Some(parsed_version),
            details: None,
        },
        Some(parsed_version) => ProbeResult {
            status: CheckStatus::Outdated,
            version: Some(parsed_version),
            details: Some(raw.into()),
        },
        None => ProbeResult {
            status: CheckStatus::Error,
            version: None,
            details: Some(raw.into()),
        },
    }
}

fn probe_command<const N: usize>(program: &str, args: [&str; N]) -> Result<String, String> {
    let candidates = command_candidates(program);
    probe_candidates_with_timeout(&candidates, &args, PROBE_TIMEOUT)
}

fn run_openclaw_command_with_timeout(
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let candidates = openclaw_command_candidates();
    probe_candidates_with_timeout(&candidates, args, timeout)
}

fn probe_candidates_with_timeout(
    candidates: &[String],
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut last_error = "missing".to_string();

    for candidate in candidates {
        match run_command_with_timeout(candidate, args, timeout) {
            Err(error) if error == "missing" => continue,
            Ok(output) => return Ok(output),
            Err(error) => {
                last_error = error;
                continue;
            }
        }
    }

    Err(last_error)
}

fn openclaw_command_candidates() -> Vec<String> {
    openclaw_command_candidates_for_dirs(&configured_openclaw_scan_dirs(), env::consts::OS)
}

fn command_candidates(program: &str) -> Vec<String> {
    command_candidates_for_os(program, env::consts::OS)
}

fn command_candidates_for_os(program: &str, os: &str) -> Vec<String> {
    let program_path = Path::new(program);
    if program_path.components().count() > 1 {
        return vec![program.to_string()];
    }

    let mut candidates = vec![program.to_string()];
    for dir in standard_command_search_dirs_for_os(os) {
        let path = dir.join(program);
        let path_str = path.to_string_lossy().to_string();
        if !candidates.contains(&path_str) {
            candidates.push(path_str);
        }
    }

    candidates
}

#[cfg(test)]
fn openclaw_command_candidates_for_home(home: Option<&Path>, os: &str) -> Vec<String> {
    openclaw_command_candidates_for_dirs(&default_openclaw_bin_dirs_for_home(home), os)
}

fn openclaw_binary_names_for_os(os: &str) -> &'static [&'static str] {
    match os {
        "windows" => &["openclaw.cmd", "openclaw.exe", "openclaw.ps1", "openclaw"],
        _ => &["openclaw"],
    }
}

fn openclaw_command_candidates_for_dirs(bin_dirs: &[PathBuf], os: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let default_programs = openclaw_binary_names_for_os(os);

    for bin_dir in bin_dirs {
        for program in default_programs {
            let path = bin_dir.join(program);
            let path_str = path.to_string_lossy().to_string();
            if !candidates.contains(&path_str) {
                candidates.push(path_str);
            }
        }
    }

    candidates.push("openclaw".to_string());
    candidates
}

#[cfg(test)]
fn default_openclaw_bin_dirs_for_home(home: Option<&Path>) -> Vec<PathBuf> {
    let Some(home) = home else {
        return Vec::new();
    };

    vec![home.join(".openclaw").join("bin")]
}

fn with_openclaw_bin_in_path(command: &mut Command) {
    with_command_search_paths(command, configured_openclaw_scan_dirs());
}

fn with_standard_tool_paths(command: &mut Command) {
    with_command_search_paths(command, Vec::new());
}

fn with_command_search_paths(command: &mut Command, mut extra_paths: Vec<PathBuf>) {
    push_unique_paths(&mut extra_paths, standard_command_search_dirs());

    if extra_paths.is_empty() {
        return;
    }

    if let Ok(joined_paths) = env::join_paths(extra_paths) {
        command.env("PATH", joined_paths);
    }
}

fn standard_command_search_dirs() -> Vec<PathBuf> {
    standard_command_search_dirs_for_os(env::consts::OS)
}

fn standard_command_search_dirs_for_os(os: &str) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(current_path) = env::var_os("PATH") {
        push_unique_paths(&mut dirs, env::split_paths(&current_path).collect());
    }

    match os {
        "macos" => push_unique_paths(
            &mut dirs,
            vec![
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
                PathBuf::from("/usr/sbin"),
                PathBuf::from("/sbin"),
            ],
        ),
        _ => {}
    }

    dirs
}

fn run_command_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let stdout_path = probe_output_path(program, "stdout");
    let stderr_path = probe_output_path(program, "stderr");
    let stdout_file = File::create(&stdout_path).map_err(|error| error.to_string())?;
    let stderr_file = File::create(&stderr_path).map_err(|error| error.to_string())?;
    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));
    if program.contains("openclaw") {
        with_openclaw_bin_in_path(&mut command);
    } else {
        with_standard_tool_paths(&mut command);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Err("missing".into()),
        Err(error) => return Err(error.to_string()),
    };

    let start = Instant::now();
    loop {
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            cleanup_probe_output_files(&stdout_path, &stderr_path);
            return Err(format!("{program} 执行超时"));
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                let output = read_probe_output(program, status, &stdout_path, &stderr_path)?;
                cleanup_probe_output_files(&stdout_path, &stderr_path);
                return parse_probe_output(program, output);
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                cleanup_probe_output_files(&stdout_path, &stderr_path);
                return Err(error.to_string());
            }
        }
    }
}

fn probe_output_path(program: &str, stream: &str) -> PathBuf {
    let sanitized = program.replace(['/', '\\', ':'], "_");
    env::temp_dir().join(format!(
        "openclaw-deployer-{}-{stream}-{}.log",
        sanitized,
        current_timestamp()
    ))
}

fn read_probe_output(
    program: &str,
    status: std::process::ExitStatus,
    stdout_path: &Path,
    stderr_path: &Path,
) -> Result<std::process::Output, String> {
    let stdout = fs::read(stdout_path).map_err(|error| format!("{program} 读取输出失败: {error}"))?;
    let stderr = fs::read(stderr_path).map_err(|error| format!("{program} 读取输出失败: {error}"))?;

    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

fn cleanup_probe_output_files(stdout_path: &Path, stderr_path: &Path) {
    let _ = fs::remove_file(stdout_path);
    let _ = fs::remove_file(stderr_path);
}

fn parse_probe_output(program: &str, output: std::process::Output) -> Result<String, String> {
    match output.status.success() {
        true => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let merged = if stdout.is_empty() { stderr } else { stdout };
            if merged.is_empty() {
                Err(format!("{program} 返回了空输出"))
            } else {
                Ok(merged)
            }
        }
        false => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Err(if stderr.is_empty() { stdout } else { stderr })
        }
    }
}

fn parse_version_like(raw: &str) -> Option<String> {
    Regex::new(r"v?(\d+\.\d+(?:\.\d+)?)")
        .ok()
        .and_then(|regex| regex.captures(raw))
        .and_then(|captures| captures.get(1).map(|value| value.as_str().to_string()))
}

fn parse_git_version(raw: &str) -> Option<String> {
    Regex::new(r"git version (\d+\.\d+(?:\.\d+)?)")
        .ok()
        .and_then(|regex| regex.captures(raw))
        .and_then(|captures| captures.get(1).map(|value| value.as_str().to_string()))
}

fn parse_brew_version(raw: &str) -> Option<String> {
    Regex::new(r"Homebrew (\d+\.\d+(?:\.\d+)?)")
        .ok()
        .and_then(|regex| regex.captures(raw))
        .and_then(|captures| captures.get(1).map(|value| value.as_str().to_string()))
}

fn node_version_supported(version: &str) -> bool {
    version
        .split('.')
        .next()
        .and_then(|major| major.parse::<u32>().ok())
        .is_some_and(|major| major >= 22)
}

fn missing_probe() -> ProbeResult {
    ProbeResult {
        status: CheckStatus::Missing,
        version: None,
        details: None,
    }
}

fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn install_node(
    platform: Platform,
    mirror_mode: MirrorMode,
    requested_id: DependencyId,
) -> Result<InstallLaunchResult, String> {
    let url = resolve_node_download_url(platform, mirror_mode)?;
    let installer_path = download_to_temp(&url, "nodejs")?;

    match platform {
        Platform::Macos => launch_macos_installer(&installer_path)?,
        Platform::Windows => launch_windows_installer(&installer_path)?,
    }

    let noun = if requested_id == DependencyId::Npm {
        "npm 会随 Node.js 一起安装，已打开官方安装器。"
    } else {
        "已打开 Node.js 官方安装器。"
    };

    Ok(InstallLaunchResult {
        id: requested_id,
        strategy: "download-and-open".into(),
        started: true,
        message: noun.into(),
    })
}

fn install_git_windows() -> Result<InstallLaunchResult, String> {
    let url = resolve_git_windows_download_url()?;
    let installer_path = download_to_temp(&url, "git-windows")?;
    launch_windows_installer(&installer_path)?;

    Ok(InstallLaunchResult {
        id: DependencyId::Git,
        strategy: "download-and-open".into(),
        started: true,
        message: "已打开 Git for Windows 官方安装器。".into(),
    })
}

fn install_git_macos(mirror_mode: MirrorMode) -> Result<InstallLaunchResult, String> {
    let brew_probe = probe_homebrew();
    if brew_probe.status != CheckStatus::Installed {
        run_in_terminal(&homebrew_install_command(mirror_mode))?;
        return Ok(InstallLaunchResult {
            id: DependencyId::Git,
            strategy: "open-terminal".into(),
            started: true,
            message: if mirror_mode == MirrorMode::China {
                "Git 依赖 Homebrew，已拉起终端执行 Homebrew 国内镜像安装脚本。".into()
            } else {
                "Git 依赖 Homebrew，已拉起终端执行 Homebrew 官方安装脚本。".into()
            },
        });
    }

    run_in_terminal(&brew_install_git_command(mirror_mode))?;
    Ok(InstallLaunchResult {
        id: DependencyId::Git,
        strategy: "open-terminal".into(),
        started: true,
        message: if mirror_mode == MirrorMode::China {
            "已拉起终端执行 brew install git，并自动附带国内镜像环境变量。".into()
        } else {
            "已拉起终端执行 brew install git。".into()
        },
    })
}

fn install_homebrew(mirror_mode: MirrorMode) -> Result<InstallLaunchResult, String> {
    run_in_terminal(&homebrew_install_command(mirror_mode))?;
    Ok(InstallLaunchResult {
        id: DependencyId::Homebrew,
        strategy: "open-terminal".into(),
        started: true,
        message: if mirror_mode == MirrorMode::China {
            "已拉起终端执行 Homebrew 国内镜像安装脚本。".into()
        } else {
            "已拉起终端执行 Homebrew 官方安装脚本。".into()
        },
    })
}

fn resolve_node_download_url(platform: Platform, mirror_mode: MirrorMode) -> Result<String, String> {
    let fallback = match platform {
        Platform::Macos => NODE_PKG_FALLBACK,
        Platform::Windows if env::consts::ARCH == "aarch64" => NODE_MSI_ARM64_FALLBACK,
        Platform::Windows => NODE_MSI_X64_FALLBACK,
    };
    let asset_name = fallback
        .split('/')
        .last()
        .ok_or_else(|| "无法解析 Node.js 安装包文件名。".to_string())?;

    match platform {
        Platform::Macos if mirror_mode == MirrorMode::China => {
            Ok(format!("{NODE_MIRROR_BASE}{asset_name}"))
        }
        Platform::Macos => resolve_asset_url(
            NODE_INDEX_URL,
            r#"href="(node-v[\d.]+\.pkg)""#,
            NODE_PKG_FALLBACK,
        ),
        Platform::Windows => {
            let is_arm = env::consts::ARCH == "aarch64";
            if mirror_mode == MirrorMode::China {
                return Ok(format!("{NODE_MIRROR_BASE}{asset_name}"));
            }
            resolve_asset_url(
                NODE_INDEX_URL,
                if is_arm {
                    r#"href="(node-v[\d.]+-arm64\.msi)""#
                } else {
                    r#"href="(node-v[\d.]+-x64\.msi)""#
                },
                if is_arm {
                    NODE_MSI_ARM64_FALLBACK
                } else {
                    NODE_MSI_X64_FALLBACK
                },
            )
        }
    }
}

fn homebrew_install_command(mirror_mode: MirrorMode) -> String {
    match mirror_mode {
        MirrorMode::Official => HOMEBREW_INSTALL_COMMAND.into(),
        MirrorMode::China => format!(
            "export HOMEBREW_BREW_GIT_REMOTE='{HOMEBREW_TUNA_BREW_GIT_REMOTE}'; \
export HOMEBREW_CORE_GIT_REMOTE='{HOMEBREW_TUNA_CORE_GIT_REMOTE}'; \
export HOMEBREW_INSTALL_FROM_API=1; \
export HOMEBREW_API_DOMAIN='{HOMEBREW_TUNA_API_DOMAIN}'; \
export HOMEBREW_BOTTLE_DOMAIN='{HOMEBREW_TUNA_BOTTLE_DOMAIN}'; \
tmp_dir=\"$(mktemp -d /tmp/openclaw-brew-install.XXXXXX)\"; \
git clone --depth=1 '{HOMEBREW_TUNA_INSTALL_REPO}' \"$tmp_dir/install\" && /bin/bash \"$tmp_dir/install/install.sh\""
        ),
    }
}

fn brew_install_git_command(mirror_mode: MirrorMode) -> String {
    match mirror_mode {
        MirrorMode::Official => "brew install git".into(),
        MirrorMode::China => format!(
            "export HOMEBREW_BREW_GIT_REMOTE='{HOMEBREW_TUNA_BREW_GIT_REMOTE}'; \
export HOMEBREW_CORE_GIT_REMOTE='{HOMEBREW_TUNA_CORE_GIT_REMOTE}'; \
export HOMEBREW_INSTALL_FROM_API=1; \
export HOMEBREW_API_DOMAIN='{HOMEBREW_TUNA_API_DOMAIN}'; \
export HOMEBREW_BOTTLE_DOMAIN='{HOMEBREW_TUNA_BOTTLE_DOMAIN}'; \
brew install git"
        ),
    }
}

fn openclaw_install_macos_command(_mirror_mode: MirrorMode) -> String {
    format!(
        "export npm_config_registry='{OPENCLAW_NPM_REGISTRY_OFFICIAL}'; \
export OPENCLAW_NPM_LOGLEVEL='error'; \
curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh | bash -s -- --no-onboard"
    )
}

fn resolve_git_windows_download_url() -> Result<String, String> {
    let is_arm = env::consts::ARCH == "aarch64";
    resolve_asset_url(
        GIT_WINDOWS_PAGE,
        if is_arm {
            r#"(https://github\.com/git-for-windows/git/releases/download/[^"]+/Git-arm64\.exe)"#
        } else {
            r#"(https://github\.com/git-for-windows/git/releases/download/[^"]+/Git-64-bit\.exe)"#
        },
        if is_arm {
            GIT_WINDOWS_ARM64_FALLBACK
        } else {
            GIT_WINDOWS_X64_FALLBACK
        },
    )
}

fn resolve_asset_url(page_url: &str, pattern: &str, fallback: &str) -> Result<String, String> {
    let client = http_client()?;
    let response = client
        .get(page_url)
        .send()
        .map_err(|error| format!("请求下载页面失败: {error}"))?;

    let html = response
        .text()
        .map_err(|error| format!("读取下载页面失败: {error}"))?;

    let regex = Regex::new(pattern).map_err(|error| error.to_string())?;
    let Some(captures) = regex.captures(&html) else {
        return Ok(fallback.into());
    };
    let matched = captures
        .get(1)
        .map(|value| value.as_str())
        .unwrap_or(fallback);

    if matched.starts_with("http://") || matched.starts_with("https://") {
        return Ok(matched.into());
    }

    Ok(format!("{}{}", page_url, matched))
}

fn download_to_temp(url: &str, prefix: &str) -> Result<PathBuf, String> {
    let client = http_client()?;
    let mut response = client
        .get(url)
        .send()
        .map_err(|error| format!("下载依赖失败: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("下载依赖失败，状态码: {}", response.status()));
    }

    let filename = url
        .split('/')
        .last()
        .filter(|name| !name.is_empty())
        .unwrap_or("installer.bin");

    let target_dir = env::temp_dir().join("openclaw-deployer-downloads").join(prefix);
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let target_path = target_dir.join(filename);
    let mut file = File::create(&target_path).map_err(|error| error.to_string())?;
    io::copy(&mut response, &mut file).map_err(|error| error.to_string())?;

    Ok(target_path)
}

fn launch_macos_installer(installer_path: &PathBuf) -> Result<(), String> {
    Command::new("open")
        .arg(installer_path)
        .status()
        .map_err(|error| error.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("无法拉起 macOS 安装器。".into())
            }
        })
}

fn launch_windows_installer(installer_path: &PathBuf) -> Result<(), String> {
    let escaped_path = installer_path
        .display()
        .to_string()
        .replace('\'', "''");

    Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("Start-Process -FilePath '{escaped_path}'"),
        ])
        .status()
        .map_err(|error| error.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("无法拉起 Windows 安装器。".into())
            }
        })
}

fn run_in_terminal(command: &str) -> Result<(), String> {
    let escaped_command = command.replace('\\', "\\\\").replace('"', "\\\"");
    Command::new("osascript")
        .args([
            "-e",
            &format!(
                "tell application \"Terminal\" to do script \"{}\"",
                escaped_command
            ),
            "-e",
            "tell application \"Terminal\" to activate",
        ])
        .status()
        .map_err(|error| error.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("无法拉起 Terminal。".into())
            }
        })
}

fn launch_openclaw_windows_installer(_mirror_mode: MirrorMode) -> Result<(), String> {
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Start-Process powershell -ArgumentList '-NoExit','-Command',\"$env:npm_config_registry='{OPENCLAW_NPM_REGISTRY_OFFICIAL}'; & ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard\""
            ),
        ])
        .status()
        .map_err(|error| error.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("无法拉起 OpenClaw Windows 安装脚本。".into())
            }
        })
}

fn load_openclaw_provider_catalog() -> Result<Vec<OpenClawProviderCatalog>, String> {
    let raw = match run_openclaw_command_with_timeout(
        &["models", "list", "--all", "--json"],
        OPENCLAW_MODELS_TIMEOUT,
    ) {
        Ok(raw) => raw,
        Err(error) if error.contains("执行超时") => return Err(error),
        Err(_) => {
            run_openclaw_command_with_timeout(&["models", "list", "--all"], OPENCLAW_MODELS_TIMEOUT)?
        }
    };

    Ok(parse_openclaw_provider_catalog(&raw))
}

fn parse_openclaw_provider_catalog(raw: &str) -> Vec<OpenClawProviderCatalog> {
    let refs = parse_openclaw_model_refs(raw);
    let mut grouped: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

    for model_ref in refs {
        if let Some((provider_id, _)) = model_ref.split_once('/') {
            grouped
                .entry(provider_id.to_string())
                .or_default()
                .insert(model_ref);
        }
    }

    grouped
        .into_iter()
        .map(|(provider_id, refs)| {
            let models = refs
                .into_iter()
                .map(|model_ref| OpenClawProviderModel {
                    id: model_ref.clone(),
                    title: format_model_title(&model_ref),
                    ref_value: model_ref.clone(),
                    auth_modes: auth_modes_for_provider(&provider_id),
                    supports_login: supports_provider_login(&provider_id),
                })
                .collect::<Vec<_>>();

            OpenClawProviderCatalog {
                id: provider_id.clone(),
                title: provider_display_name(&provider_id),
                summary: format!("通过 openclaw models list 检测到 {} 个可用模型。", models.len()),
                models,
            }
        })
        .collect()
}

fn parse_openclaw_model_refs(raw: &str) -> Vec<String> {
    let mut refs = Vec::new();

    if let Ok(value) = serde_json::from_str::<Value>(raw) {
        collect_model_refs_from_value(&value, &mut refs);
    }

    if refs.is_empty() {
        refs.extend(parse_model_refs_from_text(raw));
    }

    let mut deduped = BTreeSet::new();
    for item in refs {
        if looks_like_model_ref(&item) {
            deduped.insert(item);
        }
    }

    deduped.into_iter().collect()
}

fn collect_model_refs_from_value(value: &Value, refs: &mut Vec<String>) {
    match value {
        Value::String(item) => {
            if looks_like_model_ref(item) {
                refs.push(item.clone());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_model_refs_from_value(item, refs);
            }
        }
        Value::Object(map) => {
            if let Some(model_ref) = extract_model_ref_from_object(map) {
                refs.push(model_ref);
            }

            for item in map.values() {
                collect_model_refs_from_value(item, refs);
            }
        }
        _ => {}
    }
}

fn extract_model_ref_from_object(map: &Map<String, Value>) -> Option<String> {
    for key in ["ref", "modelRef", "model_ref", "value", "name", "id"] {
        if let Some(Value::String(candidate)) = map.get(key) {
            if looks_like_model_ref(candidate) {
                return Some(candidate.clone());
            }
        }
    }

    let provider = map
        .get("provider")
        .and_then(Value::as_str)
        .or_else(|| map.get("providerId").and_then(Value::as_str))
        .or_else(|| map.get("provider_id").and_then(Value::as_str));
    let model = map
        .get("model")
        .and_then(Value::as_str)
        .or_else(|| map.get("modelId").and_then(Value::as_str))
        .or_else(|| map.get("model_id").and_then(Value::as_str))
        .or_else(|| map.get("slug").and_then(Value::as_str));

    match (provider, model) {
        (Some(provider_id), Some(model_id)) => {
            let candidate = format!("{provider_id}/{model_id}");
            looks_like_model_ref(&candidate).then_some(candidate)
        }
        _ => None,
    }
}

fn parse_model_refs_from_text(raw: &str) -> Vec<String> {
    Regex::new(r"([a-z0-9][a-z0-9-]*/[A-Za-z0-9._:-]+)")
        .ok()
        .map(|regex| {
            regex
                .captures_iter(raw)
                .filter_map(|captures| captures.get(1).map(|value| value.as_str().to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn looks_like_model_ref(candidate: &str) -> bool {
    if candidate.contains(' ') {
        return false;
    }

    candidate
        .split_once('/')
        .map(|(provider, model)| !provider.is_empty() && !model.is_empty())
        .unwrap_or(false)
}

fn provider_display_name(provider_id: &str) -> String {
    match provider_id {
        "zai" => "Z.AI / GLM".into(),
        "minimax" => "MiniMax Global".into(),
        "minimax-cn" => "MiniMax CN".into(),
        "minimax-portal" => "MiniMax OAuth".into(),
        "moonshot" => "Moonshot / Kimi".into(),
        "openai" => "OpenAI".into(),
        "openai-codex" => "OpenAI Codex".into(),
        "anthropic" => "Anthropic".into(),
        "google" => "Google Gemini".into(),
        "google-antigravity" => "Google Antigravity".into(),
        "google-gemini-cli" => "Google Gemini CLI".into(),
        "google-vertex" => "Google Vertex".into(),
        "qwen" => "Qwen".into(),
        "qwen-portal" => "Qwen OAuth".into(),
        other => other.to_string(),
    }
}

fn format_model_title(model_ref: &str) -> String {
    model_ref
        .split_once('/')
        .map(|(_, model)| model.replace(['_', '-'], " "))
        .map(|label| {
            label
                .split_whitespace()
                .map(|segment| {
                    let mut chars = segment.chars();
                    match chars.next() {
                        Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                        None => String::new(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_else(|| model_ref.to_string())
}

fn supports_provider_login(provider_id: &str) -> bool {
    matches!(
        provider_id,
        "openai-codex"
            | "anthropic"
            | "google-antigravity"
            | "google-gemini-cli"
            | "qwen-portal"
            | "minimax-portal"
    )
}

fn auth_modes_for_provider(provider_id: &str) -> Vec<DeployAuthMode> {
    match provider_id {
        "openai-codex" => vec![DeployAuthMode::Login],
        "anthropic" => vec![DeployAuthMode::Api, DeployAuthMode::Login],
        "google-antigravity" | "google-gemini-cli" | "qwen-portal" | "minimax-portal" => {
            vec![DeployAuthMode::Login]
        }
        _ => vec![DeployAuthMode::Api],
    }
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())
}

fn default_mirror_mode() -> MirrorMode {
    MirrorMode::Official
}

fn default_app_settings() -> AppSettings {
    AppSettings {
        mirror_mode: default_mirror_mode(),
        openclaw_scan_dirs: Vec::new(),
    }
}

fn app_settings_path() -> Result<PathBuf, String> {
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位当前用户目录。".to_string())?;

    Ok(home.join(".openclaw-deployer").join("settings.json"))
}

fn load_app_settings() -> AppSettings {
    let Ok(path) = app_settings_path() else {
        return default_app_settings();
    };

    let Ok(contents) = fs::read_to_string(path) else {
        return default_app_settings();
    };

    serde_json::from_str(&contents).unwrap_or_else(|_| default_app_settings())
}

fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    let path = app_settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

fn default_openclaw_bin_dir() -> Result<PathBuf, String> {
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位当前用户目录。".to_string())?;

    Ok(home.join(".openclaw").join("bin"))
}

fn configured_openclaw_scan_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    push_unique_paths(&mut dirs, detect_openclaw_bin_dirs());

    for raw_dir in load_app_settings().openclaw_scan_dirs {
        let path = PathBuf::from(raw_dir);
        push_unique_path(&mut dirs, path);
    }

    if dirs.is_empty() {
        if let Ok(default_dir) = default_openclaw_bin_dir() {
            dirs.push(default_dir);
        }
    }

    dirs
}

fn configured_openclaw_scan_dirs_as_strings() -> Vec<String> {
    configured_openclaw_scan_dirs()
        .into_iter()
        .map(|path| path.display().to_string())
        .collect()
}

fn detect_openclaw_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(path_dir) = detect_openclaw_dir_from_path() {
        push_unique_path(&mut dirs, path_dir);
    }

    if let Ok(default_dir) = default_openclaw_bin_dir() {
        for binary_name in openclaw_binary_names_for_os(env::consts::OS) {
            let candidate = default_dir.join(binary_name);
            if candidate.is_file() {
                push_unique_path(&mut dirs, default_dir.clone());
                break;
            }
        }
    }

    dirs
}

fn detect_openclaw_dir_from_path() -> Option<PathBuf> {
    let path = env::var_os("PATH")?;

    for dir in env::split_paths(&path) {
        for binary_name in openclaw_binary_names_for_os(env::consts::OS) {
            let candidate = dir.join(binary_name);
            if candidate.is_file() {
                return Some(dir);
            }
        }
    }

    None
}

fn push_unique_paths(target: &mut Vec<PathBuf>, values: Vec<PathBuf>) {
    for value in values {
        push_unique_path(target, value);
    }
}

fn push_unique_path(target: &mut Vec<PathBuf>, value: PathBuf) {
    if !target.contains(&value) {
        target.push(value);
    }
}

fn normalize_openclaw_scan_dir_input(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("请先输入 OpenClaw 所在目录。".into());
    }

    let expanded = expand_tilde_path(trimmed)?;
    let normalized = if looks_like_openclaw_program_path(&expanded) {
        expanded
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法解析 OpenClaw 可执行文件所在目录。".to_string())?
    } else {
        expanded
    };

    if !normalized.exists() {
        return Err("该目录不存在，请确认后再保存。".into());
    }

    if !normalized.is_dir() {
        return Err("请输入 OpenClaw 可执行文件所在目录，而不是普通文件。".into());
    }

    Ok(normalized)
}

fn expand_tilde_path(raw: &str) -> Result<PathBuf, String> {
    if raw == "~" || raw.starts_with("~/") {
        let home = env::var_os("HOME")
            .or_else(|| env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .ok_or_else(|| "无法定位当前用户目录。".to_string())?;

        if raw == "~" {
            return Ok(home);
        }

        return Ok(home.join(raw.trim_start_matches("~/")));
    }

    Ok(PathBuf::from(raw))
}

fn looks_like_openclaw_program_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            let normalized = name.to_ascii_lowercase();
            matches!(
                normalized.as_str(),
                "openclaw" | "openclaw.cmd" | "openclaw.exe" | "openclaw.ps1"
            )
        })
        .unwrap_or(false)
}

fn register_openclaw_scan_dir(dir: PathBuf) -> Result<PathBuf, String> {
    let mut settings = load_app_settings();
    let dir_str = dir.display().to_string();

    if !settings.openclaw_scan_dirs.iter().any(|item| item == &dir_str) {
        settings.openclaw_scan_dirs.push(dir_str);
        save_app_settings(settings)?;
    }

    Ok(dir)
}

fn update_npm_mirror(mode: MirrorMode) -> Result<(), String> {
    let path = npm_user_config_path()?;
    update_npm_user_config_at(&path, mode)
}

fn npm_user_config_path() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("NPM_CONFIG_USERCONFIG") {
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }

    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位 npm 用户配置目录。".to_string())?;

    Ok(home.join(".npmrc"))
}

fn update_npm_user_config_at(path: &Path, mode: MirrorMode) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let existing = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.to_string()),
    };

    let mut contents = strip_managed_npmrc_block(&existing);
    if mode == MirrorMode::China {
        if !contents.trim().is_empty() {
            contents.push_str("\n\n");
        }
        contents.push_str(OPENCLAW_NPMRC_BEGIN);
        contents.push('\n');
        contents.push_str(&format!("registry={NPM_MIRROR_REGISTRY}"));
        contents.push('\n');
        contents.push_str(OPENCLAW_NPMRC_END);
        contents.push('\n');
    } else if !contents.is_empty() {
        contents.push('\n');
    }

    if contents.trim().is_empty() {
        match fs::remove_file(path) {
            Ok(_) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    } else {
        fs::write(path, contents).map_err(|error| error.to_string())
    }
}

fn strip_managed_npmrc_block(contents: &str) -> String {
    let mut lines = Vec::new();
    let mut skipping = false;

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed == OPENCLAW_NPMRC_BEGIN {
            skipping = true;
            continue;
        }
        if trimmed == OPENCLAW_NPMRC_END {
            skipping = false;
            continue;
        }
        if !skipping {
            lines.push(line);
        }
    }

    lines.join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn installed(version: &str) -> ProbeResult {
        ProbeResult {
            status: CheckStatus::Installed,
            version: Some(version.into()),
            details: None,
        }
    }

    fn outdated(version: &str) -> ProbeResult {
        ProbeResult {
            status: CheckStatus::Outdated,
            version: Some(version.into()),
            details: None,
        }
    }

    #[test]
    fn parses_node_version_output() {
        assert_eq!(parse_version_like("v22.14.1"), Some("22.14.1".into()));
        assert_eq!(parse_version_like("node: 22.14.1"), Some("22.14.1".into()));
        assert_eq!(parse_version_like("OpenClaw 2026.3"), Some("2026.3".into()));
    }

    #[test]
    fn parses_git_and_homebrew_outputs() {
        assert_eq!(
            parse_git_version("git version 2.47.1 (Apple Git-154)"),
            Some("2.47.1".into())
        );
        assert_eq!(
            parse_brew_version("Homebrew 4.4.20"),
            Some("4.4.20".into())
        );
    }

    #[test]
    fn openclaw_candidates_include_default_install_dir_on_macos() {
        let candidates = openclaw_command_candidates_for_home(
            Some(Path::new("/Users/tester")),
            "macos",
        );

        assert_eq!(
            candidates.first().map(String::as_str),
            Some("/Users/tester/.openclaw/bin/openclaw")
        );
        assert!(candidates
            .iter()
            .any(|item| item == "/Users/tester/.openclaw/bin/openclaw"));
        assert_eq!(candidates.last().map(String::as_str), Some("openclaw"));
    }

    #[test]
    fn node_candidates_include_common_macos_bin_dirs() {
        let candidates = command_candidates_for_os("node", "macos");

        assert_eq!(candidates.first().map(String::as_str), Some("node"));
        assert!(candidates.iter().any(|item| item == "/usr/local/bin/node"));
        assert!(candidates.iter().any(|item| item == "/opt/homebrew/bin/node"));
    }

    #[test]
    fn brew_candidates_include_homebrew_bin_on_macos() {
        let candidates = command_candidates_for_os("brew", "macos");

        assert_eq!(candidates.first().map(String::as_str), Some("brew"));
        assert!(candidates.iter().any(|item| item == "/opt/homebrew/bin/brew"));
    }

    #[test]
    fn runtime_probe_recognizes_running_output() {
        assert!(openclaw_runtime_is_running(r#"{"rpc":{"ok":true},"service":{"loaded":true}}"#));
        assert!(openclaw_runtime_is_running(r#"Runtime: running"#));
    }

    #[test]
    fn runtime_probe_recognizes_stopped_output() {
        assert!(!openclaw_runtime_is_running(
            r#"{"service":{"loaded":false},"runtime":{"status":"unknown"},"rpc":{"ok":false}}"#
        ));
    }

    #[test]
    fn flags_old_node_as_outdated() {
        let probe = parse_node_status("v20.11.1", Some("20.11.1".into()));
        assert_eq!(probe.status, CheckStatus::Outdated);
        assert_eq!(probe.version, Some("20.11.1".into()));
    }

    #[test]
    fn successful_probe_without_parse_is_still_treated_as_installed() {
        let probe = normalize_probe(Ok("OpenClaw CLI ready".into()), |_| None, None);
        assert_eq!(probe.status, CheckStatus::Installed);
        assert_eq!(probe.version, None);
    }

    #[cfg(unix)]
    #[test]
    fn probe_candidates_keep_trying_after_a_command_error() {
        let candidates = vec!["/usr/bin/false".to_string(), "/bin/sh".to_string()];
        let output = probe_candidates_with_timeout(
            &candidates,
            &["-c", "printf 'OpenClaw 2026.3.8'"],
            PROBE_TIMEOUT,
        )
        .expect("should fall back to a later candidate");

        assert_eq!(output, "OpenClaw 2026.3.8");
    }

    #[test]
    fn hides_homebrew_on_windows() {
        let scan = build_scan(
            Platform::Windows,
            MirrorMode::Official,
            ProbeSnapshot {
                node: installed("22.12.0"),
                npm: installed("10.8.1"),
                git: installed("2.47.1"),
                homebrew: None,
            },
        );

        let homebrew = scan
            .checks
            .iter()
            .find(|item| item.id == DependencyId::Homebrew)
            .expect("homebrew placeholder should exist");

        assert!(!homebrew.visible);
        assert!(scan.overall_ready);
    }

    #[test]
    fn npm_missing_with_installed_node_suggests_reinstall() {
        let npm_check = build_npm_check(missing_probe(), installed("22.12.0"));
        assert_eq!(npm_check.status, CheckStatus::Missing);
        assert_eq!(npm_check.action_label, "重新安装 Node.js");
    }

    #[test]
    fn git_on_macos_requires_homebrew_when_missing() {
        let git_check = build_git_check(Platform::Macos, missing_probe(), Some(missing_probe()));
        assert_eq!(git_check.action_label, "先安装 Homebrew");
    }

    #[test]
    fn macos_keeps_homebrew_visible_but_non_blocking_when_git_is_ready() {
        let scan = build_scan(
            Platform::Macos,
            MirrorMode::Official,
            ProbeSnapshot {
                node: installed("22.12.0"),
                npm: installed("10.8.1"),
                git: installed("2.47.1"),
                homebrew: Some(outdated("4.0.0")),
            },
        );

        let homebrew = scan
            .checks
            .iter()
            .find(|item| item.id == DependencyId::Homebrew)
            .expect("homebrew placeholder should exist");

        assert!(homebrew.visible);
        assert!(scan.overall_ready);
    }

    #[test]
    fn windows_scan_uses_selected_mirror_mode() {
        let scan = build_scan(
            Platform::Windows,
            MirrorMode::China,
            ProbeSnapshot {
                node: installed("22.12.0"),
                npm: installed("10.8.1"),
                git: installed("2.47.1"),
                homebrew: None,
            },
        );

        assert_eq!(scan.mirror_mode, MirrorMode::China);
    }

    #[test]
    fn china_node_download_uses_npmmirror() {
        let url = resolve_node_download_url(Platform::Macos, MirrorMode::China)
            .expect("should build mirror URL");

        assert!(url.starts_with(NODE_MIRROR_BASE));
        assert!(url.ends_with(".pkg"));
    }

    #[test]
    fn china_homebrew_install_command_uses_tuna_mirrors() {
        let command = homebrew_install_command(MirrorMode::China);
        assert!(command.contains(HOMEBREW_TUNA_BREW_GIT_REMOTE));
        assert!(command.contains(HOMEBREW_TUNA_API_DOMAIN));
    }

    #[test]
    fn writes_managed_registry_to_npmrc() {
        let temp_dir = env::temp_dir().join(format!(
            "openclaw-npmrc-write-{}",
            current_timestamp()
        ));
        let npmrc_path = temp_dir.join(".npmrc");

        update_npm_user_config_at(&npmrc_path, MirrorMode::China).expect("should write npmrc");
        let contents = fs::read_to_string(&npmrc_path).expect("npmrc should exist");

        assert!(contents.contains(OPENCLAW_NPMRC_BEGIN));
        assert!(contents.contains("registry=https://registry.npmmirror.com"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn removing_mirror_keeps_unmanaged_npmrc_lines() {
        let temp_dir = env::temp_dir().join(format!(
            "openclaw-npmrc-clean-{}",
            current_timestamp()
        ));
        let npmrc_path = temp_dir.join(".npmrc");

        fs::create_dir_all(&temp_dir).expect("temp dir should be created");
        fs::write(
            &npmrc_path,
            format!(
                "save-exact=true\n\n{OPENCLAW_NPMRC_BEGIN}\nregistry={NPM_MIRROR_REGISTRY}\n{OPENCLAW_NPMRC_END}\n"
            ),
        )
        .expect("seed npmrc should be written");

        update_npm_user_config_at(&npmrc_path, MirrorMode::Official)
            .expect("should clean managed block");
        let contents = fs::read_to_string(&npmrc_path).expect("npmrc should remain");

        assert_eq!(contents.trim(), "save-exact=true");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn parses_openclaw_model_refs_from_json() {
        let raw = r#"{
          "providers": [
            {
              "provider": "openai",
              "models": [
                { "ref": "openai/gpt-5-mini" },
                { "ref": "openai/gpt-5.4" }
              ]
            },
            {
              "provider": "zai",
              "models": [
                { "provider": "zai", "model": "glm-4.7" }
              ]
            }
          ]
        }"#;

        let refs = parse_openclaw_model_refs(raw);
        assert!(refs.contains(&"openai/gpt-5-mini".to_string()));
        assert!(refs.contains(&"openai/gpt-5.4".to_string()));
        assert!(refs.contains(&"zai/glm-4.7".to_string()));
    }

    #[test]
    fn groups_openclaw_models_by_provider() {
        let raw = r#"openai/gpt-5-mini
openai/gpt-5.4
anthropic/claude-sonnet-4-5"#;

        let catalog = parse_openclaw_provider_catalog(raw);
        assert_eq!(catalog.len(), 2);
        assert_eq!(catalog[0].id, "anthropic");
        assert_eq!(catalog[1].id, "openai");
        assert_eq!(catalog[1].models.len(), 2);
    }

    #[test]
    fn openai_and_openai_codex_have_different_auth_modes() {
        assert_eq!(auth_modes_for_provider("openai"), vec![DeployAuthMode::Api]);
        assert_eq!(auth_modes_for_provider("openai-codex"), vec![DeployAuthMode::Login]);
        assert!(supports_provider_login("openai-codex"));
        assert!(!supports_provider_login("openai"));
    }

    #[test]
    fn normalized_dashboard_url_keeps_token_fragment() {
        let normalized = normalize_dashboard_url_for_browser("http://127.0.0.1:18789/#token=test-token");
        assert!(normalized.starts_with("http://127.0.0.1:18789/?openclawDeployerTs="));
        assert!(normalized.contains("&session=main"));
        assert!(normalized.contains("&token=test-token"));
        assert!(normalized.ends_with("#token=test-token"));
    }

    #[test]
    fn auth_store_detects_oauth_profile_for_provider() {
        let temp_dir = env::temp_dir().join(format!("openclaw-auth-store-{}", current_timestamp()));
        let auth_store_path = temp_dir.join("auth-profiles.json");
        fs::create_dir_all(&temp_dir).expect("temp dir should be created");
        fs::write(
            &auth_store_path,
            r#"{
              "version": 1,
              "profiles": {
                "openai-codex:default": {
                  "type": "oauth",
                  "provider": "openai-codex",
                  "access": "token",
                  "refresh": "refresh-token"
                }
              }
            }"#,
        )
        .expect("auth store should be written");

        let detected = auth_store_has_provider_profile(
            &auth_store_path,
            &["openai-codex".into()],
        )
        .expect("auth store should parse");

        assert!(detected);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn auth_store_ignores_other_provider_profiles() {
        let temp_dir = env::temp_dir().join(format!("openclaw-auth-store-miss-{}", current_timestamp()));
        let auth_store_path = temp_dir.join("auth-profiles.json");
        fs::create_dir_all(&temp_dir).expect("temp dir should be created");
        fs::write(
            &auth_store_path,
            r#"{
              "version": 1,
              "profiles": {
                "anthropic:default": {
                  "type": "token",
                  "provider": "anthropic",
                  "token": "setup-token"
                }
              }
            }"#,
        )
        .expect("auth store should be written");

        let detected = auth_store_has_provider_profile(
            &auth_store_path,
            &["openai-codex".into()],
        )
        .expect("auth store should parse");

        assert!(!detected);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[cfg(unix)]
    #[test]
    fn command_timeout_runner_handles_large_stdout() {
        let output = run_command_with_timeout(
            "sh",
            &[
                "-c",
                "i=0; while [ \"$i\" -lt 3000 ]; do printf '1234567890abcdef1234567890abcdef'; i=$((i+1)); done",
            ],
            Duration::from_secs(3),
        )
        .expect("large stdout command should complete");

        assert!(output.len() > 90_000);
    }
}
