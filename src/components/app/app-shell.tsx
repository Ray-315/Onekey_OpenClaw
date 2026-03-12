import {
  Activity,
  BookOpenText,
  Bot,
  ChevronRight,
  Copy,
  LoaderCircle,
  Minus,
  Play,
  Power,
  Settings2,
  Sparkles,
  Square,
  Store,
  X,
  Box,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { ModeToggle } from "@/components/app/mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  closeAppWindow,
  fetchOpenClawCatalog,
  fetchOpenClawLatestVersion,
  fetchOpenClawRuntimeOverview,
  fetchOpenClawSkills,
  isAppWindowMaximized,
  isTauriRuntime,
  launchOpenClawGateway,
  minimizeAppWindow,
  openExternalUrl,
  scanEnvironment,
  startAppWindowDragging,
  toggleAppWindowMaximize,
  updateOpenClaw,
} from "@/lib/tauri";
import type { OpenClawRuntimeOverview } from "@/lib/types";
import { cn } from "@/lib/utils";

const items = [
  { to: "/diagnostics", label: "环境检测", hint: "System checks", icon: Activity },
  { to: "/deploy", label: "一键部署", hint: "Install / Models / Config", icon: Box },
  { to: "/channels/feishu", label: "飞书 Channel", hint: "Docs / Manual Confirm", icon: Bot },
  { to: "/runtime", label: "启动控制", hint: "Gateway / Dashboard", icon: Power },
  { to: "/skills", label: "Skills 商店", hint: "Browse / Install", icon: Store },
  { to: "/recipes", label: "配方页", hint: "Community / Import", icon: BookOpenText },
  { to: "/settings", label: "设置", hint: "Workbench / Preferences", icon: Settings2 },
] as const;

const OPENCLAW_UPDATE_FALLBACK_URL = "https://www.npmjs.com/package/openclaw";
const IGNORED_OPENCLAW_UPDATE_VERSION_KEY = "openclaw-deployer-ignored-openclaw-update-version";

type ShellStatusTone = "danger" | "warning" | "success" | "neutral";

type UpdateNotice = {
  currentVersion: string;
  version: string;
  url: string;
};

function deriveOpenClawStatus(
  runtime: OpenClawRuntimeOverview | null,
  loading: boolean,
) {
  if (loading && !runtime) {
    return {
      tone: "neutral" as ShellStatusTone,
      label: "检测中",
      detail: "正在读取环境与 OpenClaw 状态。",
    };
  }

  if (!runtime) {
    return {
      tone: "danger" as ShellStatusTone,
      label: "未就绪",
      detail: "请先安装 Node.js、npm、Git 等基础依赖。",
    };
  }

  if (!runtime?.installed) {
    return {
      tone: "warning" as ShellStatusTone,
      label: "待部署",
      detail: "环境检测已通过，安装 OpenClaw 后继续部署。",
    };
  }

  if (runtime.runtimeStatus === "running") {
    return {
      tone: "success" as ShellStatusTone,
      label: "运行中",
      detail: runtime.version ? `OpenClaw ${runtime.version}` : "OpenClaw 正在运行。",
    };
  }

  return {
    tone: "neutral" as ShellStatusTone,
    label: "未启动",
    detail: runtime.version ? `已安装 ${runtime.version}，等待启动。` : "已安装，等待启动。",
  };
}

const dotClasses: Record<ShellStatusTone, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  success: "bg-success",
  neutral: "bg-muted-foreground/60",
};

function parseVersionSegments(version: string) {
  return version
    .trim()
    .replace(/^[^\d]*/, "")
    .split(/[.-]/)
    .map((segment) => Number.parseInt(segment, 10) || 0);
}

function compareVersions(left: string, right: string) {
  const leftSegments = parseVersionSegments(left);
  const rightSegments = parseVersionSegments(right);
  const maxLength = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftSegments[index] ?? 0;
    const rightValue = rightSegments[index] ?? 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function UpdateNoticeModal({
  notice,
  busy,
  error,
  progress,
  onClose,
  onIgnore,
  onUpdateNow,
}: {
  notice: UpdateNotice;
  busy: boolean;
  error: string | null;
  progress: { value: number; label: string } | null;
  onClose: () => void;
  onIgnore: () => void;
  onUpdateNow: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
      <div className="w-full max-w-xl rounded-[32px] border border-border/70 bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-border/70 px-6 py-5">
          <div>
            <p className="text-sm text-muted-foreground">OpenClaw 更新</p>
            <h4 className="text-xl font-semibold">检测到 OpenClaw 新版本</h4>
          </div>
          <Button disabled={busy} onClick={onClose} size="icon" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-5 p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            当前 OpenClaw 版本 {notice.currentVersion}，检测到最新版本 {notice.version}。
          </p>
          {progress ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{progress.label}</span>
                <span>{progress.value}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${progress.value}%` }}
                />
              </div>
            </div>
          ) : null}
          {error ? (
            <div className="rounded-2xl border border-danger/35 bg-danger/8 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}
          <div className="flex items-end justify-between gap-4">
            <button
              className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={onIgnore}
              type="button"
            >
              忽略本次更新
            </button>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Button disabled={busy} onClick={onClose} variant="outline">
              暂不更新
            </Button>
            <Button disabled={busy} onClick={onUpdateNow}>
              {busy ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  更新中...
                </>
              ) : (
                "立即更新"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  const current = items.find((item) => item.to === location.pathname) ?? items[0];
  const [runtime, setRuntime] = useState<OpenClawRuntimeOverview | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [quickStartLoading, setQuickStartLoading] = useState(false);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [animateStatusDot, setAnimateStatusDot] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice | null>(null);
  const [updateInProgress, setUpdateInProgress] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<{ value: number; label: string } | null>(
    null,
  );
  const [displayedStatus, setDisplayedStatus] = useState(() => deriveOpenClawStatus(null, true));
  const statusAnimationTimerRef = useRef<number | null>(null);
  const pendingTitlebarPointRef = useRef<{ x: number; y: number } | null>(null);
  const titlebarDragStartedRef = useRef(false);

  async function refreshStatus(force = false) {
    setStatusLoading(true);
    const runtimeResult = await fetchOpenClawRuntimeOverview({ force }).catch(() => null);

    if (runtimeResult) {
      setRuntime(runtimeResult);
    }
    setStatusLoading(false);
  }

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    document.documentElement.classList.add("tauri-window-frame");
    return () => {
      document.documentElement.classList.remove("tauri-window-frame");
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const warmup = () => {
      void scanEnvironment().catch(() => undefined);
      void fetchOpenClawCatalog().catch(() => undefined);
      void fetchOpenClawSkills().catch(() => undefined);
    };

    const timer = globalThis.setTimeout(warmup, 0);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshStatusSafely() {
      setStatusLoading(true);
      const runtimeResult = await fetchOpenClawRuntimeOverview().catch(() => null);
      if (cancelled) {
        return;
      }

      if (runtimeResult) {
        setRuntime(runtimeResult);
      }
      setStatusLoading(false);
    }

    void refreshStatusSafely();
    window.addEventListener("focus", refreshStatusSafely);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshStatusSafely);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    void isAppWindowMaximized().then((maximized) => {
      setWindowMaximized(maximized);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkForOpenClawUpdates() {
      if (!runtime?.installed || !runtime.version) {
        return;
      }

      try {
        const latestVersion = await fetchOpenClawLatestVersion();
        if (cancelled) {
          return;
        }

        if (compareVersions(latestVersion.version, runtime.version) <= 0) {
          return;
        }

        const ignoredVersion = window.localStorage.getItem(IGNORED_OPENCLAW_UPDATE_VERSION_KEY);
        if (ignoredVersion === latestVersion.version) {
          return;
        }

        setUpdateNotice({
          currentVersion: runtime.version,
          version: latestVersion.version,
          url: latestVersion.packageUrl || OPENCLAW_UPDATE_FALLBACK_URL,
        });
        setUpdateError(null);
      } catch {
        // Ignore network failures silently.
      }
    }

    void checkForOpenClawUpdates();
    return () => {
      cancelled = true;
    };
  }, [runtime?.installed, runtime?.version]);

  useEffect(() => {
    const nextStatus = deriveOpenClawStatus(runtime, statusLoading);
    const currentVisualKey = `${displayedStatus.tone}:${displayedStatus.label}`;
    const nextVisualKey = `${nextStatus.tone}:${nextStatus.label}`;
    const detailChanged = displayedStatus.detail !== nextStatus.detail;
    const visualChanged = currentVisualKey !== nextVisualKey;

    if (!detailChanged && !visualChanged) {
      return;
    }

    setDisplayedStatus(nextStatus);

    if (!visualChanged) {
      return;
    }

    setAnimateStatusDot(true);
    if (statusAnimationTimerRef.current !== null) {
      window.clearTimeout(statusAnimationTimerRef.current);
    }

    statusAnimationTimerRef.current = window.setTimeout(() => {
      setAnimateStatusDot(false);
      statusAnimationTimerRef.current = null;
    }, 650);
  }, [displayedStatus.detail, displayedStatus.label, displayedStatus.tone, runtime, statusLoading]);

  useEffect(() => {
    return () => {
      if (statusAnimationTimerRef.current !== null) {
        window.clearTimeout(statusAnimationTimerRef.current);
      }
    };
  }, []);

  const quickStartDisabledReason = !runtime?.installed
    ? "请先完成部署"
    : runtime.runtimeStatus === "running"
      ? "Gateway 已在运行"
      : null;

  async function handleQuickStart() {
    if (quickStartDisabledReason || quickStartLoading) {
      return;
    }

    setQuickStartLoading(true);
    try {
      await launchOpenClawGateway();
      await refreshStatus(true);
    } finally {
      setQuickStartLoading(false);
    }
  }

  async function handleWindowMinimize() {
    await minimizeAppWindow();
  }

  async function handleWindowToggleMaximize() {
    const maximized = await toggleAppWindowMaximize();
    setWindowMaximized(maximized);
  }

  async function handleWindowClose() {
    await closeAppWindow();
  }

  async function handleWindowDrag() {
    await startAppWindowDragging();
  }

  function resetTitlebarPointerState() {
    pendingTitlebarPointRef.current = null;
    titlebarDragStartedRef.current = false;
  }

  function handleIgnoreUpdate() {
    if (!updateNotice) {
      return;
    }

    window.localStorage.setItem(IGNORED_OPENCLAW_UPDATE_VERSION_KEY, updateNotice.version);
    setUpdateError(null);
    setUpdateProgress(null);
    setUpdateNotice(null);
  }

  async function handleUpdateNow() {
    if (!updateNotice || updateInProgress) {
      return;
    }

    setUpdateError(null);
    setUpdateProgress({ value: 12, label: "准备更新环境" });
    setUpdateInProgress(true);
    try {
      setUpdateProgress({ value: 68, label: "正在下载并安装 OpenClaw" });
      await updateOpenClaw();
      setUpdateProgress({ value: 92, label: "正在校验更新结果" });
      await refreshStatus(true);
      setUpdateProgress({ value: 100, label: "更新完成" });
      setUpdateNotice(null);
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "OpenClaw 更新失败，请稍后重试。",
      );
    } finally {
      setUpdateInProgress(false);
      window.setTimeout(() => {
        setUpdateProgress(null);
      }, 600);
    }
  }

  return (
    <div
      className={cn(
        "relative flex min-h-screen flex-col overflow-hidden md:h-screen",
        isTauriRuntime()
          ? windowMaximized
            ? "liquid-window rounded-none border-0 shadow-none"
            : "liquid-window rounded-[22px] border border-white/16 shadow-[0_24px_72px_-40px_rgba(15,23,42,0.34)]"
          : "",
      )}
    >
      {isTauriRuntime() ? <div className="liquid-sheen pointer-events-none absolute inset-0" /> : null}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-0 top-[-12rem] h-80 w-80 rounded-full bg-primary/14 blur-3xl" />
        <div className="absolute bottom-[-10rem] right-[-5rem] h-80 w-80 rounded-full bg-cyan-400/12 blur-3xl" />
      </div>

      {isTauriRuntime() ? (
        <div className="relative z-30 border-b border-border/50 bg-background/92">
          <div className="flex h-11 w-full items-center justify-between pl-3 md:pl-5">
            <div
              className="flex min-w-0 flex-1 items-center gap-3 pr-4"
              onDoubleClick={() => {
                resetTitlebarPointerState();
                void handleWindowToggleMaximize();
              }}
              onMouseDown={(event) => {
                if (event.button !== 0) {
                  return;
                }
                pendingTitlebarPointRef.current = { x: event.clientX, y: event.clientY };
                titlebarDragStartedRef.current = false;
              }}
              onMouseMove={(event) => {
                if ((event.buttons & 1) !== 1 || titlebarDragStartedRef.current) {
                  return;
                }

                const startPoint = pendingTitlebarPointRef.current;
                if (!startPoint) {
                  return;
                }

                const movedX = Math.abs(event.clientX - startPoint.x);
                const movedY = Math.abs(event.clientY - startPoint.y);
                if (movedX + movedY < 5) {
                  return;
                }

                titlebarDragStartedRef.current = true;
                pendingTitlebarPointRef.current = null;
                void handleWindowDrag();
              }}
              onMouseLeave={resetTitlebarPointerState}
              onMouseUp={resetTitlebarPointerState}
            >
              <div className="flex size-6 items-center justify-center rounded-md bg-primary/12 text-primary">
                <Sparkles className="size-3.5" />
              </div>
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="truncate font-medium text-foreground">OpenClaw</span>
                <span className="text-muted-foreground/60">/</span>
                <span className="truncate text-muted-foreground">{current.label}</span>
              </div>
            </div>

            <div className="flex h-full items-center">
              <button
                aria-label="Minimize window"
                className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground"
                onClick={() => {
                  void handleWindowMinimize();
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                type="button"
              >
                <Minus className="size-4" />
              </button>
              <button
                aria-label={windowMaximized ? "Restore window" : "Maximize window"}
                className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground"
                onClick={() => {
                  void handleWindowToggleMaximize();
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                type="button"
              >
                {windowMaximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
              </button>
              <button
                aria-label="Close window"
                className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-danger hover:text-danger-foreground"
                onClick={() => {
                  void handleWindowClose();
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="relative mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col gap-6 px-4 py-4 md:flex-row md:overflow-hidden md:px-6">
        <aside className="md:flex md:min-h-0 md:w-[336px] md:shrink-0">
          <Card className="glass-panel shell-enter hidden h-full min-h-0 flex-col overflow-hidden border-border/55 shadow-[0_22px_52px_-38px_rgba(15,23,42,0.22)] md:flex">
            <div className="border-b border-border/70 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                    <Sparkles className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm uppercase tracking-[0.24em] text-muted-foreground">
                      OpenClaw Console
                    </p>
                    <h1 className="mt-1 truncate text-2xl font-semibold">工作台</h1>
                  </div>
                </div>
                <Badge variant="info">Desktop</Badge>
              </div>
            </div>

            <nav className="flex-1 space-y-2 px-4 py-4">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    className={({ isActive }) =>
                      cn(
                        "group flex min-h-15 cursor-pointer items-center gap-3 rounded-[22px] border border-transparent px-4 py-3 transition-colors duration-200",
                        isActive
                          ? "border-primary/20 bg-primary/12 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                          : "text-muted-foreground hover:border-border/80 hover:bg-foreground/6 hover:text-foreground",
                      )
                    }
                    to={item.to}
                  >
                    <div className="flex size-10 items-center justify-center rounded-2xl bg-accent text-inherit">
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">{item.label}</p>
                      <p className="truncate text-sm text-muted-foreground">{item.hint}</p>
                    </div>
                    <ChevronRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </NavLink>
                );
              })}
            </nav>

            <div className="border-t border-border/70 px-4 py-3">
              <div className="rounded-[22px] border border-border/70 bg-foreground/4 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-medium">OpenClaw Status</p>
                  <span
                    className={cn(
                      "size-2.5 rounded-full",
                      dotClasses[displayedStatus.tone],
                      animateStatusDot ? "status-dot-flash" : "",
                    )}
                  />
                </div>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <p className="text-lg font-semibold">{displayedStatus.label}</p>
                  <p className="text-right text-sm text-muted-foreground">{runtime?.version ?? "OpenClaw"}</p>
                </div>
                <p className="mt-1 line-clamp-2 text-base leading-6 text-muted-foreground">{displayedStatus.detail}</p>
              </div>
            </div>
          </Card>

          <div className="md:hidden">
            <Card className="glass-panel shell-enter border-border/70 p-3">
              <div className="mb-3 flex items-center gap-3 px-2 py-2">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <Sparkles className="size-4" />
                </div>
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
                    OpenClaw Console
                  </p>
                  <h1 className="text-xl font-semibold">工作台</h1>
                </div>
              </div>
              <nav className="flex gap-2 overflow-x-auto pb-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      className={({ isActive }) =>
                        cn(
                          "flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-2xl border px-4 py-2 text-sm transition-colors duration-200",
                          isActive
                            ? "border-primary/20 bg-primary/12 text-foreground"
                            : "border-border/70 bg-transparent text-muted-foreground hover:bg-foreground/6",
                        )
                      }
                      to={item.to}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </nav>
            </Card>
          </div>
        </aside>

        <main className="min-w-0 flex-1 md:h-full md:overflow-y-auto md:pr-1">
          <div className="space-y-6">
            <header className="glass-panel shell-enter sticky top-4 z-10 rounded-[28px] border border-border/80 px-5 py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-muted-foreground">
                    <span>OpenClaw</span>
                    <ChevronRight className="size-3" />
                    <span>{current.label}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <h2 className="text-3xl font-semibold tracking-tight">{current.label}</h2>
                    <Badge variant={isTauriRuntime() ? "success" : "info"}>
                      {isTauriRuntime() ? "桌面运行时" : "浏览器预览"}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    disabled={quickStartLoading || quickStartDisabledReason !== null}
                    onClick={() => {
                      void handleQuickStart();
                    }}
                    title={quickStartDisabledReason ?? "一键启动 OpenClaw Gateway"}
                  >
                    {quickStartLoading ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    {runtime?.runtimeStatus === "running" ? "Gateway 已运行" : "一键启动"}
                  </Button>
                  <div className="rounded-2xl border border-border/70 px-4 py-3 text-sm text-muted-foreground">
                    当前模块: <span className="font-medium text-foreground">{current.hint}</span>
                  </div>
                  <Button
                    onClick={() => {
                      void openExternalUrl("https://github.com/Ray-315");
                    }}
                    title="作者 GitHub"
                    variant="outline"
                  >
                    <Sparkles className="size-4" />
                    作者信息
                  </Button>
                  <ModeToggle />
                </div>
              </div>
            </header>

            <div className="page-enter" key={location.pathname}>
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      {updateNotice ? (
        <UpdateNoticeModal
          busy={updateInProgress}
          error={updateError}
          notice={updateNotice}
          progress={updateProgress}
          onClose={() => {
            setUpdateError(null);
            setUpdateProgress(null);
            setUpdateNotice(null);
          }}
          onIgnore={handleIgnoreUpdate}
          onUpdateNow={handleUpdateNow}
        />
      ) : null}
    </div>
  );
}
