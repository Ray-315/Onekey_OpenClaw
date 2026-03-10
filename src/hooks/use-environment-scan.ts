import { useWorkbenchSettings } from "@/components/app/app-settings-provider";
import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  installDependency,
  isTauriRuntime,
  resetDemoRuntime,
  scanEnvironment,
  switchMirrorMode,
} from "@/lib/tauri";
import type { DependencyId, EnvironmentScan, MirrorMode } from "@/lib/types";

type LoadState = "idle" | "loading" | "ready" | "error";
const FOCUS_SCAN_THROTTLE_MS = 15_000;
const SCAN_DEADLINE_MS = 10_000;

export function useEnvironmentScan() {
  const { settings } = useWorkbenchSettings();
  const [scan, setScan] = useState<EnvironmentScan | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [installingId, setInstallingId] = useState<DependencyId | null>(null);
  const [switchingMirror, setSwitchingMirror] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);
  const scanInFlightRef = useRef(false);
  const lastScanAtRef = useRef(0);
  const activeScanIdRef = useRef(0);
  const scanDeadlineTimerRef = useRef<number | null>(null);

  const runScan = useEffectEvent(async (nextMessage?: string) => {
    if (scanInFlightRef.current) {
      return;
    }

    const previousScan = scan;
    const requestId = activeScanIdRef.current + 1;
    activeScanIdRef.current = requestId;
    scanInFlightRef.current = true;
    setError(null);
    if (previousScan) {
      setIsRefreshing(true);
    } else {
      setState("loading");
    }
    if (nextMessage) {
      setMessage(nextMessage);
    }

    if (scanDeadlineTimerRef.current !== null) {
      window.clearTimeout(scanDeadlineTimerRef.current);
    }

    scanDeadlineTimerRef.current = window.setTimeout(() => {
      if (activeScanIdRef.current !== requestId) {
        return;
      }

      activeScanIdRef.current = requestId + 1;
      scanDeadlineTimerRef.current = null;
      scanInFlightRef.current = false;
      setIsRefreshing(false);
      setState(previousScan ? "ready" : "error");
      setError("环境检测响应超时，请稍后重试。");
    }, SCAN_DEADLINE_MS);

    try {
      const result = await scanEnvironment();
      if (activeScanIdRef.current !== requestId) {
        return;
      }

      startTransition(() => {
        setScan(result);
        setState("ready");
      });
      lastScanAtRef.current = Date.now();
    } catch (scanError) {
      if (activeScanIdRef.current !== requestId) {
        return;
      }

      setState(previousScan ? "ready" : "error");
      setError(
        scanError instanceof Error ? scanError.message : "环境检测失败，请稍后重试。",
      );
    } finally {
      if (activeScanIdRef.current === requestId) {
        if (scanDeadlineTimerRef.current !== null) {
          window.clearTimeout(scanDeadlineTimerRef.current);
          scanDeadlineTimerRef.current = null;
        }

        scanInFlightRef.current = false;
        setIsRefreshing(false);
      }
    }
  });

  const handleWindowFocus = useEffectEvent(() => {
    if (!isTauriRuntime()) {
      return;
    }

    if (!settings.focusRescan) {
      return;
    }

    if (document.visibilityState !== "visible") {
      return;
    }

    if (Date.now() - lastScanAtRef.current < FOCUS_SCAN_THROTTLE_MS) {
      return;
    }

    void runScan("窗口重新聚焦后已自动刷新当前环境状态。");
  });

  useEffect(() => {
    void runScan();
  }, []);

  useEffect(() => {
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, []);

  useEffect(() => {
    return () => {
      if (scanDeadlineTimerRef.current !== null) {
        window.clearTimeout(scanDeadlineTimerRef.current);
      }
    };
  }, []);

  async function refresh() {
    await runScan("已重新执行环境检测。");
  }

  async function install(id: DependencyId) {
    setInstallingId(id);
    setError(null);
    setMessage(null);
    try {
      const result = await installDependency(id);
      setMessage(settings.showInstallNotice ? result.message : null);
    } catch (installError) {
      setError(
        installError instanceof Error ? installError.message : "安装命令拉起失败，请稍后再试。",
      );
    } finally {
      setInstallingId(null);
    }
  }

  async function setMirrorMode(mode: MirrorMode) {
    setSwitchingMirror(true);
    setError(null);

    try {
      const result = await switchMirrorMode(mode);
      await runScan(result.message);
    } catch (mirrorError) {
      setError(
        mirrorError instanceof Error ? mirrorError.message : "镜像源切换失败，请稍后再试。",
      );
    } finally {
      setSwitchingMirror(false);
    }
  }

  async function resetDemo() {
    setResettingDemo(true);
    try {
      const result = await resetDemoRuntime();
      await runScan(result.message);
    } finally {
      setResettingDemo(false);
    }
  }

  return {
    scan,
    state,
    isRefreshing,
    error,
    message,
    installingId,
    switchingMirror,
    resettingDemo,
    refresh,
    install,
    setMirrorMode,
    resetDemo,
  };
}
