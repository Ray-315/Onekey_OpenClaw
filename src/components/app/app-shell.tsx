import {
  Activity,
  BookTemplate,
  Box,
  ChevronRight,
  LoaderCircle,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { ModeToggle } from "@/components/app/mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { fetchOpenClawCatalog, isTauriRuntime, scanEnvironment } from "@/lib/tauri";
import type { EnvironmentScan, OpenClawCatalog } from "@/lib/types";
import { cn } from "@/lib/utils";

const items = [
  { to: "/diagnostics", label: "环境检测", hint: "Node · npm · Git", icon: Activity },
  { to: "/deploy", label: "一键部署", hint: "安装 · 模型 · 配置", icon: Box },
  { to: "/recipes", label: "按配方部署", hint: "社区模板 · 敬请期待", icon: BookTemplate },
  { to: "/settings", label: "设置", hint: "工作台偏好", icon: Settings2 },
];

type ShellStatusTone = "danger" | "warning" | "success" | "neutral";

function deriveOpenClawStatus(scan: EnvironmentScan | null, catalog: OpenClawCatalog | null) {
  if (!scan) {
    return {
      tone: "neutral" as ShellStatusTone,
      label: "检测中",
      detail: "正在读取环境与 OpenClaw 状态。",
    };
  }

  if (!scan.overallReady) {
    return {
      tone: "danger" as ShellStatusTone,
      label: "环境未适配",
      detail: "先补齐 Node.js、npm、Git 等基础依赖。",
    };
  }

  if (!catalog?.installed) {
    return {
      tone: "warning" as ShellStatusTone,
      label: "待部署",
      detail: "环境已通过，安装 OpenClaw 后继续部署。",
    };
  }

  if (catalog.runtimeStatus === "running") {
    return {
      tone: "success" as ShellStatusTone,
      label: "运行中",
      detail: catalog.version ? `OpenClaw ${catalog.version}` : "OpenClaw 正在运行。",
    };
  }

  return {
    tone: "neutral" as ShellStatusTone,
    label: "未启动",
    detail: catalog.version ? `已安装 ${catalog.version}，等待启动。` : "已安装 OpenClaw，等待启动。",
  };
}

const dotClasses: Record<ShellStatusTone, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  success: "bg-success",
  neutral: "bg-muted-foreground/60",
};

export function AppShell() {
  const location = useLocation();
  const current = items.find((item) => item.to === location.pathname) ?? items[0];
  const [scan, setScan] = useState<EnvironmentScan | null>(null);
  const [catalog, setCatalog] = useState<OpenClawCatalog | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function refreshStatus() {
      setStatusLoading(true);
      const [scanResult, catalogResult] = await Promise.allSettled([
        scanEnvironment(),
        fetchOpenClawCatalog(),
      ]);
      if (cancelled) {
        return;
      }

      setScan(scanResult.status === "fulfilled" ? scanResult.value : null);
      setCatalog(catalogResult.status === "fulfilled" ? catalogResult.value : null);
      setStatusLoading(false);
    }

    void refreshStatus();
    window.addEventListener("focus", refreshStatus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshStatus);
    };
  }, [location.pathname]);

  const openClawStatus = deriveOpenClawStatus(scan, catalog);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-0 top-[-12rem] h-80 w-80 rounded-full bg-primary/14 blur-3xl" />
        <div className="absolute bottom-[-10rem] right-[-5rem] h-80 w-80 rounded-full bg-cyan-400/12 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-[1800px] flex-col gap-6 px-4 py-4 md:flex-row md:px-6">
        <aside className="md:w-[300px] md:shrink-0">
          <Card className="glass-panel sticky top-4 hidden h-[calc(100vh-2rem)] flex-col overflow-hidden border-border/70 md:flex">
            <div className="border-b border-border/70 px-6 py-6">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                    OpenClaw Console
                  </p>
                  <h1 className="mt-1 text-xl font-semibold">工作台</h1>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                检测环境、安装 OpenClaw，并逐步完成部署。
              </p>
            </div>

            <nav className="flex-1 space-y-2 px-4 py-5">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    className={({ isActive }) =>
                      cn(
                        "group flex min-h-16 cursor-pointer items-center gap-4 rounded-[24px] border border-transparent px-4 py-3 transition-colors duration-200",
                        isActive
                          ? "border-primary/20 bg-primary/12 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                          : "text-muted-foreground hover:border-border/80 hover:bg-foreground/6 hover:text-foreground",
                      )
                    }
                    to={item.to}
                  >
                    <div className="flex size-11 items-center justify-center rounded-2xl bg-accent text-inherit">
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.hint}</p>
                    </div>
                    <ChevronRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </NavLink>
                );
              })}
            </nav>

            <div className="border-t border-border/70 px-5 py-5">
              <div className="rounded-[24px] border border-border/70 bg-foreground/4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">OpenClaw 状态</p>
                  {statusLoading ? (
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <span className={cn("size-2.5 rounded-full", dotClasses[openClawStatus.tone])} />
                  )}
                </div>
                <p className="mt-3 text-base font-semibold">{openClawStatus.label}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{openClawStatus.detail}</p>
              </div>
            </div>
          </Card>

          <div className="md:hidden">
            <Card className="glass-panel border-border/70 p-3">
              <div className="mb-3 flex items-center gap-3 px-2 py-2">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <Sparkles className="size-4" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                    OpenClaw Console
                  </p>
                  <h1 className="text-lg font-semibold">工作台</h1>
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

        <main className="min-w-0 flex-1">
          <div className="space-y-6">
            <header className="glass-panel sticky top-4 z-10 rounded-[28px] border border-border/80 px-5 py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-muted-foreground">
                    <span>OpenClaw</span>
                    <ChevronRight className="size-3" />
                    <span>{current.label}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-semibold tracking-tight">{current.label}</h2>
                    <Badge variant={isTauriRuntime() ? "success" : "info"}>
                      {isTauriRuntime() ? "系统命令可调用" : "浏览器预览"}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-2xl border border-border/70 px-4 py-3 text-sm text-muted-foreground">
                    当前模块：<span className="font-medium text-foreground">{current.hint}</span>
                  </div>
                  <ModeToggle />
                </div>
              </div>
            </header>

            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
