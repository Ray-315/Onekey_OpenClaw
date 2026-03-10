import { invoke } from "@tauri-apps/api/core";

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
  OpenClawCatalog,
  OpenClawInstallLaunchResult,
  OpenClawScanPathResult,
  Platform,
} from "@/lib/types";

const SCAN_TIMEOUT_MS = 8_000;
const OPENCLAW_SCAN_TIMEOUT_MS = 15_000;

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

export function isTauriRuntime() {
  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
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
    return buildDemoOpenClawCatalog();
  }

  return withTimeout(
    invoke<OpenClawCatalog>("fetch_openclaw_catalog"),
    OPENCLAW_SCAN_TIMEOUT_MS,
    "OpenClaw 检测",
    "OpenClaw 检测超时，请确认 OpenClaw 安装目录已加入检测路径后再重试。",
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
    return applyDemoOpenClawScanDir(path) satisfies OpenClawScanPathResult;
  }

  return invoke<OpenClawScanPathResult>("register_openclaw_scan_dir", { path });
}
