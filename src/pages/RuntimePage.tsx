import {
  Activity,
  ExternalLink,
  FolderCog,
  LoaderCircle,
  PackagePlus,
  Play,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchOpenClawCatalog,
  fetchOpenClawRuntimeOverview,
  launchOpenClawGateway,
  openExternalUrl,
  openOpenClawDashboard,
} from "@/lib/tauri";
import type { OpenClawCatalog, OpenClawRuntimeOverview } from "@/lib/types";

export function RuntimePage() {
  const navigate = useNavigate();
  const [runtime, setRuntime] = useState<OpenClawRuntimeOverview | null>(null);
  const [catalog, setCatalog] = useState<OpenClawCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"start" | "dashboard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);

  async function refreshRuntime(message?: string, force = false) {
    setLoading(true);
    setError(null);
    const shouldForce = force || Boolean(message);

    try {
      const [runtimeResult, catalogResult] = await Promise.allSettled([
        fetchOpenClawRuntimeOverview({ force: shouldForce }),
        fetchOpenClawCatalog({ force: shouldForce }),
      ]);

      if (runtimeResult.status !== "fulfilled") {
        throw runtimeResult.reason;
      }

      setRuntime(runtimeResult.value);
      if (catalogResult.status === "fulfilled") {
        setCatalog(catalogResult.value);
      }
      setNotice(message ?? runtimeResult.value.message);
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : "读取启动状态失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshRuntime();
  }, []);

  const providerCount = catalog?.providers.reduce((count, provider) => count + provider.models.length, 0) ?? 0;
  const firstScanPath = runtime?.scanPaths[0] ?? "未登记";
  const running = runtime?.runtimeStatus === "running";

  const heroTone = useMemo(() => {
    if (!runtime?.installed) {
      return { badge: "warning" as const, title: "先安装 OpenClaw", detail: "没有 CLI，就没有真正的启动页。" };
    }

    if (running) {
      return { badge: "success" as const, title: "Gateway 已运行", detail: "一切准备就绪。" };
    }

    return { badge: "neutral" as const, title: "等待启动", detail: "一切准备就绪。" };
  }, [running, runtime?.installed]);

  const runtimeJudgement = useMemo(() => {
    if (loading) {
      return "正在读取 OpenClaw CLI 和 Gateway 状态。";
    }

    if (!runtime?.installed) {
      return "未检测到 OpenClaw CLI，需要先完成安装。";
    }

    if (running) {
      return "Gateway 正在响应，可以直接打开 Dashboard。";
    }

    return "已检测到 OpenClaw CLI，但 Gateway 当前没有响应。";
  }, [loading, running, runtime?.installed]);

  async function handleStartGateway() {
    setActionLoading("start");
    setError(null);

    try {
      const result = await launchOpenClawGateway();
      setNotice(result.message);
      await refreshRuntime(result.message, true);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "拉起 Gateway 失败。");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleOpenDashboard() {
    setActionLoading("dashboard");
    setError(null);

    try {
      const result = await openOpenClawDashboard();
      setNotice(result.message);
      setDashboardUrl(result.url);
    } catch (dashboardError) {
      setError(dashboardError instanceof Error ? dashboardError.message : "打开 Dashboard 失败。");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="grid gap-0 p-0 lg:grid-cols-[minmax(0,1.1fr)_360px]">
          <div className="border-b border-border/70 p-6 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="info">启动控制</Badge>
              <Badge variant={heroTone.badge}>{loading ? "读取中" : heroTone.title}</Badge>
            </div>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight">部署之后，还需要一个真正的启动入口</h3>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                disabled={!runtime?.installed || actionLoading !== null}
                onClick={() => {
                  void handleStartGateway();
                }}
              >
                {actionLoading === "start" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {running ? "重新在终端启动" : "在终端启动 Gateway"}
              </Button>
              <Button
                disabled={!runtime?.installed || actionLoading !== null}
                onClick={() => {
                  void handleOpenDashboard();
                }}
                variant="outline"
              >
                {actionLoading === "dashboard" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ExternalLink className="size-4" />
                )}
                打开 Dashboard
              </Button>
              <Button
                disabled={loading}
                onClick={() => {
                  void refreshRuntime("已刷新启动状态。");
                }}
                variant="ghost"
              >
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                刷新状态
              </Button>
            </div>

            <p className="mt-6 text-sm leading-6 text-muted-foreground">{heroTone.detail}</p>
          </div>

          <div className="p-6">
            <div className="rounded-[28px] border border-border/70 bg-foreground/5 p-5">
              <p className="text-sm font-medium">当前运行概览</p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">运行状态</p>
                  <p className="mt-2 text-lg font-semibold">{loading ? "读取中…" : running ? "运行中" : "未启动"}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">OpenClaw 版本</p>
                  <p className="mt-2 text-lg font-semibold">{runtime?.version ?? "未安装"}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">可用模型数</p>
                  <p className="mt-2 text-lg font-semibold">{providerCount}</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-[24px] border border-danger/20 bg-danger/10 px-4 py-4 text-sm leading-6">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-[24px] border border-primary/20 bg-primary/10 px-4 py-4 text-sm leading-6">
          <p>{notice}</p>
          {dashboardUrl ? (
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  void openExternalUrl(dashboardUrl);
                }}
                size="sm"
                variant="outline"
              >
                <ExternalLink className="size-4" />
                用系统浏览器打开
              </Button>
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(dashboardUrl);
                }}
                size="sm"
                variant="ghost"
              >
                复制精确链接
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-[28px] border border-border/70 bg-foreground/5 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4 text-primary" />
            状态判断
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{runtimeJudgement}</p>
        </div>
        <div className="rounded-[28px] border border-border/70 bg-foreground/5 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FolderCog className="size-4 text-primary" />
            默认扫描目录
          </div>
          <p className="mt-3 break-all text-sm leading-6 text-muted-foreground">{firstScanPath}</p>
        </div>
        <div className="rounded-[28px] border border-border/70 bg-foreground/5 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <PackagePlus className="size-4 text-primary" />
            下一步
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {!runtime?.installed
              ? "先去部署页完成安装。"
              : running
                ? "现在可以直接打开 Dashboard 或返回部署页。"
                : "点一次“在终端启动 Gateway”，保留终端窗口别关。"}
          </p>
          {!runtime?.installed ? (
            <Button className="mt-4" onClick={() => navigate("/deploy")} variant="outline">
              前往一键部署
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
