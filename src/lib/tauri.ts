import { invoke, isTauri as detectTauriRuntime } from "@tauri-apps/api/core";

import {
  applyDemoInstall,
  applyDemoOpenClawInstall,
  applyDemoOpenClawScanDir,
  applyDemoMirrorMode,
  buildDemoEnvironmentScan,
  buildDemoOpenClawCatalog,
  resetDemoEnvironment,
} from "@/lib/demo-runtime";
import type {
  DependencyId,
  EnvironmentScan,
  InstallLaunchResult,
  MirrorMode,
  MirrorSwitchResult,
  OpenClawAuthLaunchResult,
  OpenClawAuthStatusResult,
  OpenClawCatalog,
  OpenClawDashboardLaunchResult,
  OpenClawDeployRequest,
  OpenClawDeployResult,
  OpenClawGatewayLaunchResult,
  OpenClawInstallLaunchResult,
  OpenClawRuntimeOverview,
  OpenClawScanPathResult,
  OpenClawSkillDetail,
  OpenClawSkillInstallLaunchResult,
  OpenClawSkillsCatalog,
  Platform,
} from "@/lib/types";

const SCAN_TIMEOUT_MS = 12_000;
const OPENCLAW_SCAN_TIMEOUT_MS = 24_000;
const OPENCLAW_SKILLS_TIMEOUT_MS = 20_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  timeoutMessage?: string,
) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(
        new Error(
          timeoutMessage ?? `${label}超时，请检查 Node.js / npm / Git / Homebrew 命令是否卡住。`,
        ),
      );
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

async function requestDevOpenClaw<T>(pathname: string, init?: RequestInit) {
  const response = await fetch(`/__openclaw/${pathname}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.message ?? "开发预览扫描失败，请稍后重试。");
  }

  return payload as T;
}

export function isTauriRuntime() {
  return detectTauriRuntime();
}

export async function scanEnvironment() {
  if (!isTauriRuntime()) {
    return buildDemoEnvironmentScan();
  }

  return withTimeout(invoke<EnvironmentScan>("scan_environment"), SCAN_TIMEOUT_MS, "环境检测");
}

export async function installDependency(id: DependencyId) {
  if (!isTauriRuntime()) {
    return applyDemoInstall(id) satisfies InstallLaunchResult;
  }

  return invoke<InstallLaunchResult>("install_dependency", { id });
}

export async function switchMirrorMode(mode: MirrorMode) {
  if (!isTauriRuntime()) {
    return applyDemoMirrorMode(mode) satisfies MirrorSwitchResult;
  }

  return invoke<MirrorSwitchResult>("switch_mirror_mode", { mode });
}

export async function resetDemoRuntime() {
  if (!isTauriRuntime()) {
    resetDemoEnvironment();
    return { message: "Demo 环境已重置，你可以重新逐个点击所有按钮。" };
  }

  return { message: "当前在 Tauri 运行时，未提供一键重置 Demo 状态。" };
}

export async function fetchOpenClawCatalog() {
  if (!isTauriRuntime()) {
    if (import.meta.env.DEV) {
      return withTimeout(requestDevOpenClaw<OpenClawCatalog>("catalog"), OPENCLAW_SCAN_TIMEOUT_MS, "OpenClaw 检测");
    }

    return buildDemoOpenClawCatalog();
  }

  return withTimeout(
    invoke<OpenClawCatalog>("fetch_openclaw_catalog"),
    OPENCLAW_SCAN_TIMEOUT_MS,
    "OpenClaw 检测",
    "OpenClaw 检测超时，请确认 OpenClaw 安装目录已加入检测路径后再重试。",
  );
}

export async function fetchOpenClawRuntimeOverview() {
  if (!isTauriRuntime()) {
    const catalog = import.meta.env.DEV
      ? await withTimeout(
          requestDevOpenClaw<OpenClawCatalog>("catalog"),
          OPENCLAW_SCAN_TIMEOUT_MS,
          "OpenClaw 检测",
        )
      : buildDemoOpenClawCatalog();

    return {
      installed: catalog.installed,
      version: catalog.version,
      message: catalog.message,
      runtimeStatus: catalog.runtimeStatus,
      scanPaths: catalog.scanPaths,
    } satisfies OpenClawRuntimeOverview;
  }

  return withTimeout(
    invoke<OpenClawRuntimeOverview>("fetch_openclaw_runtime_overview"),
    SCAN_TIMEOUT_MS,
    "OpenClaw 运行状态",
  );
}

export async function installOpenClaw() {
  if (!isTauriRuntime()) {
    return applyDemoOpenClawInstall() satisfies OpenClawInstallLaunchResult;
  }

  return invoke<OpenClawInstallLaunchResult>("install_openclaw");
}

export async function registerOpenClawScanDir(path: string) {
  if (!isTauriRuntime()) {
    if (import.meta.env.DEV) {
      return requestDevOpenClaw<OpenClawScanPathResult>("scan-dir", {
        method: "POST",
        body: JSON.stringify({ path }),
      });
    }

    return applyDemoOpenClawScanDir(path) satisfies OpenClawScanPathResult;
  }

  return invoke<OpenClawScanPathResult>("register_openclaw_scan_dir", { path });
}

export async function openExternalUrl(url: string) {
  if (!isTauriRuntime()) {
    const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (openedWindow) {
      openedWindow.opener = null;
    }
    return;
  }

  await invoke("open_external_url", { url });
}

export async function launchOpenClawAuth(providerId: string) {
  if (!isTauriRuntime()) {
    throw new Error("真实 OAuth 登录只支持桌面版 Tauri 运行时。");
  }

  return invoke<OpenClawAuthLaunchResult>("launch_openclaw_auth", {
    providerId,
    provider_id: providerId,
  });
}

export async function checkOpenClawAuth(providerId: string) {
  if (!isTauriRuntime()) {
    throw new Error("真实 OAuth 校验只支持桌面版 Tauri 运行时。");
  }

  return invoke<OpenClawAuthStatusResult>("check_openclaw_auth", {
    providerId,
    provider_id: providerId,
  });
}

export async function launchOpenClawGateway() {
  if (!isTauriRuntime()) {
    throw new Error("启动 Gateway 只支持桌面版 Tauri 运行时。");
  }

  return invoke<OpenClawGatewayLaunchResult>("launch_openclaw_gateway");
}

export async function openOpenClawDashboard() {
  if (!isTauriRuntime()) {
    throw new Error("打开 Dashboard 只支持桌面版 Tauri 运行时。");
  }

  return invoke<OpenClawDashboardLaunchResult>("open_openclaw_dashboard");
}

export async function applyOpenClawDeploy(request: OpenClawDeployRequest) {
  if (!isTauriRuntime()) {
    throw new Error("真实一键部署只支持桌面版 Tauri 运行时。");
  }

  return invoke<OpenClawDeployResult>("apply_openclaw_deploy", { request });
}

export async function fetchOpenClawSkills() {
  if (!isTauriRuntime()) {
    if (import.meta.env.DEV) {
      return withTimeout(
        requestDevOpenClaw<OpenClawSkillsCatalog>("skills"),
        OPENCLAW_SKILLS_TIMEOUT_MS,
        "Skills 列表",
      );
    }

    return {
      workspaceDir: "",
      managedSkillsDir: "",
      readyCount: 0,
      totalCount: 0,
      skills: [],
    } satisfies OpenClawSkillsCatalog;
  }

  try {
    return await withTimeout(
      invoke<OpenClawSkillsCatalog>("fetch_openclaw_skills"),
      OPENCLAW_SKILLS_TIMEOUT_MS,
      "Skills 列表",
    );
  } catch (error) {
    if (import.meta.env.DEV) {
      return withTimeout(
        requestDevOpenClaw<OpenClawSkillsCatalog>("skills"),
        OPENCLAW_SKILLS_TIMEOUT_MS,
        "Skills 列表",
      );
    }

    throw error;
  }
}

export async function fetchOpenClawSkillDetail(name: string) {
  if (!isTauriRuntime()) {
    if (import.meta.env.DEV) {
      return withTimeout(
        requestDevOpenClaw<OpenClawSkillDetail>(`skill-info?name=${encodeURIComponent(name)}`),
        OPENCLAW_SKILLS_TIMEOUT_MS,
        "Skill 详情",
      );
    }

    throw new Error("Skill 详情只支持桌面版 Tauri 运行时。");
  }

  try {
    return await withTimeout(
      invoke<OpenClawSkillDetail>("fetch_openclaw_skill_detail", { name }),
      OPENCLAW_SKILLS_TIMEOUT_MS,
      "Skill 详情",
    );
  } catch (error) {
    if (import.meta.env.DEV) {
      return withTimeout(
        requestDevOpenClaw<OpenClawSkillDetail>(`skill-info?name=${encodeURIComponent(name)}`),
        OPENCLAW_SKILLS_TIMEOUT_MS,
        "Skill 详情",
      );
    }

    throw error;
  }
}

export async function launchOpenClawSkillInstall(skillName: string, actionId: string) {
  if (!isTauriRuntime()) {
    throw new Error("Skill 安装只支持桌面版 Tauri 运行时。");
  }

  return invoke<OpenClawSkillInstallLaunchResult>("launch_openclaw_skill_install", {
    skillName,
    skill_name: skillName,
    actionId,
    action_id: actionId,
  });
}
