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
  OpenClawLatestVersion,
  OpenClawRuntimeOverview,
  OpenClawScanPathResult,
  OpenClawSkillDetail,
  OpenClawSkillInstallLaunchResult,
  OpenClawSkillsCatalog,
  OpenClawUpdateResult,
  OpenClawUninstallResult,
} from "@/lib/types";

const SCAN_TIMEOUT_MS = 12_000;
const OPENCLAW_SCAN_TIMEOUT_MS = 24_000;
const OPENCLAW_SKILLS_TIMEOUT_MS = 35_000;
const OPENCLAW_UPDATE_TIMEOUT_MS = 180_000;
const DETECTION_CACHE_TTL_MS = 5_000;
const DETECTION_SNAPSHOT_PREFIX = "openclaw-deployer-detection:";

type DetectionRequestOptions = {
  force?: boolean;
};

type DetectionCacheKey =
  | "environment"
  | "openclawCatalog"
  | "openclawRuntime"
  | "openclawLatestVersion"
  | "openclawSkills";

type DetectionCacheEntry<T> = {
  value?: T;
  expiresAt: number;
  inFlight?: Promise<T>;
};

const detectionCache = new Map<DetectionCacheKey, DetectionCacheEntry<unknown>>();

function detectionCacheTtlMs(key: DetectionCacheKey) {
  switch (key) {
    case "openclawCatalog":
    case "openclawSkills":
      return 30_000;
    default:
      return DETECTION_CACHE_TTL_MS;
  }
}

function supportsDetectionSnapshot(key: DetectionCacheKey) {
  return key === "environment" || key === "openclawCatalog" || key === "openclawSkills";
}

function getDetectionSnapshotStorageKey(key: DetectionCacheKey) {
  return `${DETECTION_SNAPSHOT_PREFIX}${key}`;
}

function readDetectionSnapshot<T>(key: DetectionCacheKey) {
  if (!supportsDetectionSnapshot(key) || typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getDetectionSnapshotStorageKey(key));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeDetectionSnapshot<T>(key: DetectionCacheKey, value: T) {
  if (!supportsDetectionSnapshot(key) || typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getDetectionSnapshotStorageKey(key), JSON.stringify(value));
  } catch {
    // Ignore storage failures and fall back to in-memory cache only.
  }
}

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
          timeoutMessage ??
            `${label} timed out. Please check whether Node.js / npm / Git / Homebrew commands are blocked.`,
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

function getDetectionCacheEntry<T>(key: DetectionCacheKey) {
  const existing = detectionCache.get(key) as DetectionCacheEntry<T> | undefined;
  if (existing) {
    return existing;
  }

  const created: DetectionCacheEntry<T> = { expiresAt: 0 };
  detectionCache.set(key, created as DetectionCacheEntry<unknown>);
  return created;
}

function peekDetectionValue<T>(key: DetectionCacheKey) {
  const entry = getDetectionCacheEntry<T>(key);
  if (entry.value !== undefined) {
    return entry.value;
  }

  const snapshot = readDetectionSnapshot<T>(key);
  if (snapshot !== null) {
    entry.value = snapshot;
    entry.expiresAt = 0;
    return snapshot;
  }

  return null;
}

function loadDetectionValue<T>(
  key: DetectionCacheKey,
  options: DetectionRequestOptions | undefined,
  loader: () => Promise<T>,
) {
  const entry = getDetectionCacheEntry<T>(key);
  const force = options?.force ?? false;

  if (!force) {
    if (entry.value !== undefined && entry.expiresAt > Date.now()) {
      return Promise.resolve(entry.value);
    }

    if (entry.inFlight) {
      return entry.inFlight;
    }
  }

  const request = loader()
    .then((value) => {
      entry.value = value;
      entry.expiresAt = Date.now() + detectionCacheTtlMs(key);
      writeDetectionSnapshot(key, value);
      return value;
    })
    .finally(() => {
      if (entry.inFlight === request) {
        entry.inFlight = undefined;
      }
    });

  entry.inFlight = request;
  return request;
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
    throw new Error(payload?.message ?? "Development preview request failed.");
  }

  return payload as T;
}

export function isTauriRuntime() {
  return detectTauriRuntime();
}

async function requestEnvironmentScan(force = false) {
  if (!isTauriRuntime()) {
    return buildDemoEnvironmentScan();
  }

  return withTimeout(
    invoke<EnvironmentScan>("scan_environment", { force }),
    SCAN_TIMEOUT_MS,
    "Environment scan",
  );
}

export async function scanEnvironment(options?: DetectionRequestOptions) {
  return loadDetectionValue("environment", options, () =>
    requestEnvironmentScan(options?.force ?? false),
  );
}

export function peekEnvironmentScanSnapshot() {
  return peekDetectionValue<EnvironmentScan>("environment");
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
    return { message: "Demo environment has been reset." };
  }

  return { message: "Demo reset is only available in browser preview." };
}

async function requestOpenClawCatalog(force = false) {
  if (!isTauriRuntime()) {
    if (import.meta.env.DEV) {
      return withTimeout(
        requestDevOpenClaw<OpenClawCatalog>("catalog"),
        OPENCLAW_SCAN_TIMEOUT_MS,
        "OpenClaw catalog",
      );
    }

    return buildDemoOpenClawCatalog();
  }

  return withTimeout(
    invoke<OpenClawCatalog>("fetch_openclaw_catalog", { force }),
    OPENCLAW_SCAN_TIMEOUT_MS,
    "OpenClaw catalog",
    "OpenClaw catalog timed out. Please verify the scan paths and try again.",
  );
}

export async function fetchOpenClawCatalog(options?: DetectionRequestOptions) {
  return loadDetectionValue("openclawCatalog", options, () =>
    requestOpenClawCatalog(options?.force ?? false),
  );
}

export function peekOpenClawCatalogSnapshot() {
  return peekDetectionValue<OpenClawCatalog>("openclawCatalog");
}

async function requestOpenClawRuntimeOverview(force = false) {
  if (!isTauriRuntime()) {
    const catalog = import.meta.env.DEV
      ? await withTimeout(
          requestDevOpenClaw<OpenClawCatalog>("catalog"),
          OPENCLAW_SCAN_TIMEOUT_MS,
          "OpenClaw catalog",
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
    invoke<OpenClawRuntimeOverview>("fetch_openclaw_runtime_overview", { force }),
    SCAN_TIMEOUT_MS,
    "OpenClaw runtime status",
  );
}

export async function fetchOpenClawRuntimeOverview(options?: DetectionRequestOptions) {
  return loadDetectionValue("openclawRuntime", options, () =>
    requestOpenClawRuntimeOverview(options?.force ?? false),
  );
}

async function requestOpenClawLatestVersion(force = false) {
  if (!isTauriRuntime()) {
    const response = await fetch("https://registry.npmjs.org/openclaw/latest", {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`OpenClaw latest version request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as { version?: string };
    const version = (payload.version || "").trim();
    if (!version) {
      throw new Error("OpenClaw latest version response is missing version.");
    }

    return {
      version,
      packageUrl: "https://www.npmjs.com/package/openclaw",
    } satisfies OpenClawLatestVersion;
  }

  return withTimeout(
    invoke<OpenClawLatestVersion>("fetch_openclaw_latest_version", { force }),
    SCAN_TIMEOUT_MS,
    "OpenClaw latest version",
  );
}

export async function fetchOpenClawLatestVersion(options?: DetectionRequestOptions) {
  return loadDetectionValue("openclawLatestVersion", options, () =>
    requestOpenClawLatestVersion(options?.force ?? false),
  );
}

export async function updateOpenClaw() {
  if (!isTauriRuntime()) {
    throw new Error("Manual updates are only supported in the desktop app.");
  }

  return withTimeout(
    invoke<OpenClawUpdateResult>("update_openclaw"),
    OPENCLAW_UPDATE_TIMEOUT_MS,
    "OpenClaw update",
  );
}

export async function installOpenClaw() {
  if (!isTauriRuntime()) {
    return applyDemoOpenClawInstall() satisfies OpenClawInstallLaunchResult;
  }

  return invoke<OpenClawInstallLaunchResult>("install_openclaw");
}

export async function uninstallOpenClaw() {
  if (!isTauriRuntime()) {
    throw new Error("Uninstall is only supported in the desktop app.");
  }

  return invoke<OpenClawUninstallResult>("uninstall_openclaw");
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

export async function minimizeAppWindow() {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke("minimize_main_window");
}

export async function toggleAppWindowMaximize() {
  if (!isTauriRuntime()) {
    return false;
  }

  return invoke<boolean>("toggle_main_window_maximize");
}

export async function closeAppWindow() {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke("close_main_window");
}

export async function isAppWindowMaximized() {
  if (!isTauriRuntime()) {
    return false;
  }

  return invoke<boolean>("is_main_window_maximized");
}

export async function startAppWindowDragging() {
  if (!isTauriRuntime()) {
    return;
  }

  await invoke("start_drag_main_window");
}

export async function launchOpenClawAuth(providerId: string) {
  if (!isTauriRuntime()) {
    throw new Error("OAuth login is only supported in the desktop app.");
  }

  return invoke<OpenClawAuthLaunchResult>("launch_openclaw_auth", {
    providerId,
    provider_id: providerId,
  });
}

export async function checkOpenClawAuth(providerId: string) {
  if (!isTauriRuntime()) {
    throw new Error("Auth verification is only supported in the desktop app.");
  }

  return invoke<OpenClawAuthStatusResult>("check_openclaw_auth", {
    providerId,
    provider_id: providerId,
  });
}

export async function launchOpenClawGateway() {
  if (!isTauriRuntime()) {
    throw new Error("Gateway launch is only supported in the desktop app.");
  }

  return invoke<OpenClawGatewayLaunchResult>("launch_openclaw_gateway");
}

export async function openOpenClawDashboard() {
  if (!isTauriRuntime()) {
    throw new Error("Dashboard is only supported in the desktop app.");
  }

  return invoke<OpenClawDashboardLaunchResult>("open_openclaw_dashboard");
}

export async function applyOpenClawDeploy(request: OpenClawDeployRequest) {
  if (!isTauriRuntime()) {
    throw new Error("One-click deploy is only supported in the desktop app.");
  }

  return invoke<OpenClawDeployResult>("apply_openclaw_deploy", { request });
}

export async function fetchOpenClawSkills(options?: DetectionRequestOptions) {
  return loadDetectionValue("openclawSkills", options, async () => {
    if (!isTauriRuntime()) {
      if (import.meta.env.DEV) {
        return withTimeout(
          requestDevOpenClaw<OpenClawSkillsCatalog>("skills"),
          OPENCLAW_SKILLS_TIMEOUT_MS,
          "Skills catalog",
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
        "Skills catalog",
      );
    } catch (error) {
      if (import.meta.env.DEV) {
        return withTimeout(
          requestDevOpenClaw<OpenClawSkillsCatalog>("skills"),
          OPENCLAW_SKILLS_TIMEOUT_MS,
          "Skills catalog",
        );
      }

      throw error;
    }
  });
}

export function peekOpenClawSkillsSnapshot() {
  return peekDetectionValue<OpenClawSkillsCatalog>("openclawSkills");
}

export async function fetchOpenClawSkillDetail(name: string) {
  if (!isTauriRuntime()) {
    if (import.meta.env.DEV) {
      return withTimeout(
        requestDevOpenClaw<OpenClawSkillDetail>(`skill-info?name=${encodeURIComponent(name)}`),
        OPENCLAW_SKILLS_TIMEOUT_MS,
        "Skill detail",
      );
    }

    throw new Error("Skill detail is only supported in the desktop app.");
  }

  try {
    return await withTimeout(
      invoke<OpenClawSkillDetail>("fetch_openclaw_skill_detail", { name }),
      OPENCLAW_SKILLS_TIMEOUT_MS,
      "Skill detail",
    );
  } catch (error) {
    if (import.meta.env.DEV) {
      return withTimeout(
        requestDevOpenClaw<OpenClawSkillDetail>(`skill-info?name=${encodeURIComponent(name)}`),
        OPENCLAW_SKILLS_TIMEOUT_MS,
        "Skill detail",
      );
    }

    throw error;
  }
}

export async function launchOpenClawSkillInstall(skillName: string, actionId: string) {
  if (!isTauriRuntime()) {
    throw new Error("Skill install is only supported in the desktop app.");
  }

  return invoke<OpenClawSkillInstallLaunchResult>("launch_openclaw_skill_install", {
    skillName,
    skill_name: skillName,
    actionId,
    action_id: actionId,
  });
}
