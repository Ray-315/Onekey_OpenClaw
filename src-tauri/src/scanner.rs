use regex::Regex;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fs::{self, File},
    io,
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
const OPENCLAW_MODELS_TIMEOUT: Duration = Duration::from_secs(8);
const OPENCLAW_INSTALL_MACOS_COMMAND: &str =
    "curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash -s -- --no-onboard";
const OPENCLAW_NPMRC_BEGIN: &str = "# >>> openclaw-deployer mirror >>>";
const OPENCLAW_NPMRC_END: &str = "# <<< openclaw-deployer mirror <<<";

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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
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
    pub providers: Vec<OpenClawProviderCatalog>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawInstallLaunchResult {
    pub started: bool,
    pub strategy: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    mirror_mode: MirrorMode,
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
                providers,
            })
        }
        _ => Ok(OpenClawCatalog {
            installed: false,
            version: None,
            message: "请先安装 OpenClaw，再通过 CLI 拉取可用 provider 和模型列表。".into(),
            runtime_status: OpenClawRuntimeStatus::Stopped,
            providers: Vec::new(),
        }),
    }
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

    match platform {
        Platform::Macos => {
            run_in_terminal(OPENCLAW_INSTALL_MACOS_COMMAND)?;
            Ok(OpenClawInstallLaunchResult {
                started: true,
                strategy: "open-terminal".into(),
                message: "已拉起 Terminal 执行 OpenClaw 官方安装脚本。安装完成后请返回本页重新检测。".into(),
            })
        }
        Platform::Windows => {
            launch_openclaw_windows_installer()?;
            Ok(OpenClawInstallLaunchResult {
                started: true,
                strategy: "open-powershell".into(),
                message: "已拉起 PowerShell 执行 OpenClaw 官方安装脚本。安装完成后请返回本页重新检测。".into(),
            })
        }
    }
}

pub fn switch_mirror_mode_inner(mode: MirrorMode) -> Result<MirrorSwitchResult, String> {
    save_app_settings(AppSettings { mirror_mode: mode })?;
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
    ProbeSnapshot {
        node: probe_node(),
        npm: probe_npm(),
        git: probe_git(),
        homebrew: match platform {
            Platform::Macos => Some(probe_homebrew()),
            Platform::Windows => None,
        },
    }
}

fn build_scan(platform: Platform, mirror_mode: MirrorMode, snapshot: ProbeSnapshot) -> EnvironmentScan {
    let checks = build_checks(platform, snapshot);
    let overall_ready = checks
        .iter()
        .filter(|check| check.visible)
        .all(|check| check.status == CheckStatus::Installed);

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

fn build_homebrew_check(probe: ProbeResult) -> DependencyCheck {
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
    let output = run_command_with_timeout("openclaw", &["--version"], PROBE_TIMEOUT);
    normalize_probe(output, parse_version_like, None)
}

fn probe_openclaw_runtime_status() -> OpenClawRuntimeStatus {
    let candidates: [&[&str]; 4] = [
        &["gateway", "status", "--json"],
        &["gateway", "status"],
        &["status", "--deep", "--json"],
        &["status"],
    ];

    for args in candidates {
        if let Ok(raw) = run_command_with_timeout("openclaw", args, PROBE_TIMEOUT) {
            let normalized = raw.to_ascii_lowercase();
            if normalized.contains("running")
                || normalized.contains("\"status\":\"ok\"")
                || normalized.contains("\"ok\":true")
                || normalized.contains("healthy")
            {
                return OpenClawRuntimeStatus::Running;
            }
        }
    }

    OpenClawRuntimeStatus::Stopped
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
    run_command_with_timeout(program, &args, PROBE_TIMEOUT)
}

fn run_command_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut child = match Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Err("missing".into()),
        Err(error) => return Err(error.to_string()),
    };

    let start = Instant::now();
    loop {
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{program} 执行超时"));
        }

        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child.wait_with_output().map_err(|error| error.to_string())?;
                return parse_probe_output(program, output);
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => return Err(error.to_string()),
        }
    }
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
    Regex::new(r"v?(\d+\.\d+\.\d+)")
        .ok()
        .and_then(|regex| regex.captures(raw))
        .and_then(|captures| captures.get(1).map(|value| value.as_str().to_string()))
}

fn parse_git_version(raw: &str) -> Option<String> {
    Regex::new(r"git version (\d+\.\d+\.\d+)")
        .ok()
        .and_then(|regex| regex.captures(raw))
        .and_then(|captures| captures.get(1).map(|value| value.as_str().to_string()))
}

fn parse_brew_version(raw: &str) -> Option<String> {
    Regex::new(r"Homebrew (\d+\.\d+\.\d+)")
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

fn launch_openclaw_windows_installer() -> Result<(), String> {
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Start-Process powershell -ArgumentList '-NoExit','-Command','& ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard'",
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
    let raw = run_command_with_timeout(
        "openclaw",
        &["models", "list", "--all", "--json"],
        OPENCLAW_MODELS_TIMEOUT,
    )
    .or_else(|_| {
        run_command_with_timeout(
            "openclaw",
            &["models", "list", "--all"],
            OPENCLAW_MODELS_TIMEOUT,
        )
    })?;

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
        "minimax" => "MiniMax".into(),
        "openai" => "OpenAI".into(),
        "anthropic" => "Anthropic".into(),
        "google" => "Google Gemini".into(),
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
    matches!(provider_id, "openai" | "anthropic")
}

fn auth_modes_for_provider(provider_id: &str) -> Vec<DeployAuthMode> {
    if supports_provider_login(provider_id) {
        vec![DeployAuthMode::Api, DeployAuthMode::Login]
    } else {
        vec![DeployAuthMode::Api]
    }
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())
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
        return AppSettings {
            mirror_mode: MirrorMode::Official,
        };
    };

    let Ok(contents) = fs::read_to_string(path) else {
        return AppSettings {
            mirror_mode: MirrorMode::Official,
        };
    };

    serde_json::from_str(&contents).unwrap_or(AppSettings {
        mirror_mode: MirrorMode::Official,
    })
}

fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    let path = app_settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, payload).map_err(|error| error.to_string())
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
    fn flags_old_node_as_outdated() {
        let probe = parse_node_status("v20.11.1", Some("20.11.1".into()));
        assert_eq!(probe.status, CheckStatus::Outdated);
        assert_eq!(probe.version, Some("20.11.1".into()));
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
    fn macos_overall_ready_requires_homebrew() {
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

        assert!(!scan.overall_ready);
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
}
