import type {
  CheckStatus,
  DependencyCheck,
  DependencyId,
  EnvironmentScan,
  InstallLaunchResult,
  OpenClawCatalog,
  OpenClawInstallLaunchResult,
  OpenClawScanPathResult,
  OpenClawRuntimeStatus,
  MirrorMode,
  MirrorSwitchResult,
  Platform,
} from "@/lib/types";

const MIRROR_STORAGE_KEY = "openclaw-deployer-mirror-mode";
const DEMO_RUNTIME_KEY = "openclaw-deployer-demo-runtime";

interface DemoRuntimeState {
  platform: Platform;
  mirrorMode: MirrorMode;
  nodeVersion: string | null;
  npmVersion: string | null;
  gitVersion: string | null;
  homebrewVersion: string | null;
  openclawVersion: string | null;
  openclawScanPaths: string[];
}

function detectPlatform(): Platform {
  return navigator.userAgent.toLowerCase().includes("mac") ? "macos" : "windows";
}

function defaultOpenClawScanPath(platform: Platform) {
  return platform === "macos" ? "~/.openclaw/bin" : "C:\\Users\\Ray\\AppData\\Roaming\\npm";
}

function defaultState(): DemoRuntimeState {
  const platform = detectPlatform();
  const mirrorMode = window.localStorage.getItem(MIRROR_STORAGE_KEY) === "china" ? "china" : "official";
  return {
    platform,
    mirrorMode,
    nodeVersion: null,
    npmVersion: null,
    gitVersion: null,
    homebrewVersion: null,
    openclawVersion: null,
    openclawScanPaths: [defaultOpenClawScanPath(platform)],
  };
}

function loadState(): DemoRuntimeState {
  const raw = window.localStorage.getItem(DEMO_RUNTIME_KEY);
  if (!raw) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DemoRuntimeState>;
    return {
      ...defaultState(),
      ...parsed,
      platform: detectPlatform(),
      mirrorMode:
        parsed.mirrorMode === "china" || parsed.mirrorMode === "official"
          ? parsed.mirrorMode
          : defaultState().mirrorMode,
      openclawScanPaths:
        Array.isArray(parsed.openclawScanPaths) && parsed.openclawScanPaths.length > 0
          ? parsed.openclawScanPaths.filter((item): item is string => typeof item === "string")
          : defaultState().openclawScanPaths,
    };
  } catch {
    return defaultState();
  }
}

function saveState(state: DemoRuntimeState) {
  window.localStorage.setItem(DEMO_RUNTIME_KEY, JSON.stringify(state));
  window.localStorage.setItem(MIRROR_STORAGE_KEY, state.mirrorMode);
}

function buildNodeCheck(state: DemoRuntimeState): DependencyCheck {
  if (!state.nodeVersion) {
    return {
      id: "node",
      title: "Node.js",
      status: "missing",
      version: null,
      requiredVersion: "22+",
      summary: "Demo 环境尚未补齐 Node.js，点击按钮后会模拟安装 22 LTS。",
      actionLabel: "安装 Node.js 22 LTS",
      actionEnabled: true,
      visible: true,
    };
  }

  return {
    id: "node",
    title: "Node.js",
    status: "installed",
    version: state.nodeVersion,
    requiredVersion: "22+",
    summary: "Demo 环境已模拟完成 Node.js 安装。",
    actionLabel: "Node.js 已满足",
    actionEnabled: false,
    visible: true,
  };
}

function buildNpmCheck(state: DemoRuntimeState): DependencyCheck {
  if (!state.npmVersion && !state.nodeVersion) {
    return {
      id: "npm",
      title: "npm",
      status: "missing",
      version: null,
      requiredVersion: null,
      summary: "npm 会随 Node.js 一起安装，点击后会同步补齐两者。",
      actionLabel: "随 Node.js 一起安装",
      actionEnabled: true,
      visible: true,
    };
  }

  if (!state.npmVersion) {
    return {
      id: "npm",
      title: "npm",
      status: "missing",
      version: null,
      requiredVersion: null,
      summary: "Node.js 已存在，但 npm 仍未补齐，点击后会模拟重装 Node.js。",
      actionLabel: "重新安装 Node.js",
      actionEnabled: true,
      visible: true,
    };
  }

  return {
    id: "npm",
    title: "npm",
    status: "installed",
    version: state.npmVersion,
    requiredVersion: null,
    summary: "Demo 环境已模拟完成 npm 安装。",
    actionLabel: "npm 已满足",
    actionEnabled: false,
    visible: true,
  };
}

function buildGitCheck(state: DemoRuntimeState): DependencyCheck {
  if (state.gitVersion) {
    return {
      id: "git",
      title: "Git",
      status: "installed",
      version: state.gitVersion,
      requiredVersion: null,
      summary: "Demo 环境已模拟完成 Git 安装。",
      actionLabel: "Git 已满足",
      actionEnabled: false,
      visible: true,
    };
  }

  if (state.platform === "macos" && !state.homebrewVersion) {
    return {
      id: "git",
      title: "Git",
      status: "missing",
      version: null,
      requiredVersion: null,
      summary: "macOS Demo 会先补齐 Homebrew，再执行 Git 安装。",
      actionLabel: "先安装 Homebrew",
      actionEnabled: true,
      visible: true,
    };
  }

  return {
    id: "git",
    title: "Git",
    status: "missing",
    version: null,
    requiredVersion: null,
    summary:
      state.platform === "macos"
        ? "Homebrew 已就绪，点击后会继续模拟 brew install git。"
        : "点击后会模拟拉起 Git for Windows 安装器。",
    actionLabel: "安装 Git",
    actionEnabled: true,
    visible: true,
  };
}

function buildHomebrewCheck(state: DemoRuntimeState): DependencyCheck {
  if (state.platform !== "macos") {
    return {
      id: "homebrew",
      title: "Homebrew",
      status: "missing",
      version: null,
      requiredVersion: null,
      summary: "Homebrew 仅在 macOS 显示。",
      actionLabel: "当前平台不适用",
      actionEnabled: false,
      visible: false,
    };
  }

  if (!state.homebrewVersion) {
    return {
      id: "homebrew",
      title: "Homebrew",
      status: "missing",
      version: null,
      requiredVersion: null,
      summary: "点击后会模拟执行 Homebrew 安装脚本。",
      actionLabel: "安装 Homebrew",
      actionEnabled: true,
      visible: true,
    };
  }

  return {
    id: "homebrew",
    title: "Homebrew",
    status: "installed",
    version: state.homebrewVersion,
    requiredVersion: null,
    summary: "Demo 环境已模拟完成 Homebrew 安装。",
    actionLabel: "Homebrew 已满足",
    actionEnabled: false,
    visible: true,
  };
}

function buildCheckList(state: DemoRuntimeState) {
  return [
    buildNodeCheck(state),
    buildNpmCheck(state),
    buildGitCheck(state),
    buildHomebrewCheck(state),
  ];
}

function recomputeOverallReady(checks: DependencyCheck[]) {
  return checks.filter((check) => check.visible).every((check) => check.status === "installed");
}

export function buildDemoEnvironmentScan(): EnvironmentScan {
  const state = loadState();
  const checks = buildCheckList(state);
  return {
    platform: state.platform,
    scannedAt: Date.now().toString(),
    mirrorMode: state.mirrorMode,
    checks,
    overallReady: recomputeOverallReady(checks),
  };
}

export function applyDemoInstall(id: DependencyId): InstallLaunchResult {
  const state = loadState();
  let message = "Demo 已记录一次安装动作。";

  if (id === "node") {
    state.nodeVersion = "22.22.1";
    state.npmVersion = "11.11.0";
    message = "Demo 已模拟安装 Node.js 22.22.1，并同步补齐 npm 11.11.0。";
  }

  if (id === "npm") {
    state.nodeVersion = state.nodeVersion ?? "22.22.1";
    state.npmVersion = "11.11.0";
    message = "Demo 已模拟通过重装 Node.js 修复 npm。";
  }

  if (id === "homebrew" && state.platform === "macos") {
    state.homebrewVersion = "4.6.2";
    message = "Demo 已模拟安装 Homebrew 4.6.2。";
  }

  if (id === "git") {
    if (state.platform === "macos" && !state.homebrewVersion) {
      state.homebrewVersion = "4.6.2";
      message = "Demo 先为你补齐了 Homebrew；再次点击 Git 按钮会继续安装 Git。";
    } else {
      state.gitVersion = "2.49.0";
      message =
        state.platform === "macos"
          ? "Demo 已模拟执行 brew install git。"
          : "Demo 已模拟拉起 Git for Windows 安装器并完成安装。";
    }
  }

  saveState(state);

  return {
    id,
    strategy: "preview",
    started: true,
    message,
  };
}

export function applyDemoMirrorMode(mode: MirrorMode): MirrorSwitchResult {
  const state = loadState();
  state.mirrorMode = mode;
  saveState(state);

  return {
    mode,
    message:
      mode === "china"
        ? "Demo 已切换到国内镜像模式。Node.js / npm / Homebrew 按钮会按镜像模式演示。"
        : "Demo 已恢复官方源模式。",
  };
}

export function resetDemoEnvironment() {
  const state = defaultState();
  saveState(state);
}

export function buildDemoOpenClawCatalog(): OpenClawCatalog {
  const state = loadState();

  if (!state.openclawVersion) {
    return {
      installed: false,
      version: null,
      message: "Demo 中尚未安装 OpenClaw。请先点击安装按钮，再继续选择模型公司和模型。",
      runtimeStatus: "stopped",
      scanPaths: state.openclawScanPaths,
      providers: [],
    };
  }

  return {
    installed: true,
    version: state.openclawVersion,
    message: "Demo 已模拟安装 OpenClaw，可用模型列表来自本地示例数据。",
    runtimeStatus: "stopped" satisfies OpenClawRuntimeStatus,
    scanPaths: state.openclawScanPaths,
    providers: [
      {
        id: "zai",
        title: "Z.AI / GLM",
        summary: "通过 openclaw models list 演示返回的 GLM 模型。",
        models: [
          {
            id: "zai/glm-4.7",
            title: "GLM 4.7",
            ref: "zai/glm-4.7",
            authModes: ["api"],
            supportsLogin: false,
          },
          {
            id: "zai/glm-5",
            title: "GLM 5",
            ref: "zai/glm-5",
            authModes: ["api"],
            supportsLogin: false,
          },
        ],
      },
      {
        id: "minimax",
        title: "MiniMax",
        summary: "通过 openclaw models list 演示返回的 MiniMax 模型。",
        models: [
          {
            id: "minimax/MiniMax-M2.5",
            title: "MiniMax M2.5",
            ref: "minimax/MiniMax-M2.5",
            authModes: ["api"],
            supportsLogin: false,
          },
        ],
      },
      {
        id: "openai",
        title: "OpenAI",
        summary: "支持 API Key 与 OAuth 登录演示。",
        models: [
          {
            id: "openai/gpt-5-mini",
            title: "GPT-5 mini",
            ref: "openai/gpt-5-mini",
            authModes: ["api"],
            supportsLogin: false,
          },
          {
            id: "openai/gpt-5.4",
            title: "GPT-5.4",
            ref: "openai/gpt-5.4",
            authModes: ["api", "login"],
            supportsLogin: true,
          },
        ],
      },
      {
        id: "anthropic",
        title: "Anthropic",
        summary: "支持 API Key 与 OAuth 登录演示。",
        models: [
          {
            id: "anthropic/claude-sonnet-4-5",
            title: "Claude Sonnet 4.5",
            ref: "anthropic/claude-sonnet-4-5",
            authModes: ["api", "login"],
            supportsLogin: true,
          },
        ],
      },
    ],
  };
}

export function applyDemoOpenClawInstall(): OpenClawInstallLaunchResult {
  const state = loadState();
  const defaultScanPath = defaultOpenClawScanPath(state.platform);
  state.openclawVersion = "0.91.0";
  if (!state.openclawScanPaths.includes(defaultScanPath)) {
    state.openclawScanPaths.unshift(defaultScanPath);
  }
  saveState(state);

  return {
    started: true,
    strategy: "preview",
    message: `Demo 已模拟安装 OpenClaw 0.91.0，并自动登记 ${defaultScanPath} 作为扫描目录。`,
  };
}

export function applyDemoOpenClawScanDir(path: string): OpenClawScanPathResult {
  const state = loadState();
  const normalized = path.trim();

  if (!normalized) {
    throw new Error("请先输入 OpenClaw 所在目录。");
  }

  if (!state.openclawScanPaths.includes(normalized)) {
    state.openclawScanPaths.push(normalized);
  }

  saveState(state);

  return {
    path: normalized,
    message: "Demo 已加入手动扫描目录，重新检测时会优先检查这里。",
    scanPaths: state.openclawScanPaths,
  };
}

export function getDemoMirrorMode() {
  return loadState().mirrorMode;
}

export function getDemoStatusTone(status: CheckStatus) {
  return status === "installed" ? "success" : status === "outdated" ? "warning" : "danger";
}
