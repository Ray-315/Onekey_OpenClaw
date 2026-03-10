import {
  AlertTriangle,
  AppWindowMac,
  ArrowRight,
  CheckCircle2,
  Download,
  GitBranch,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  Rocket,
  SquareTerminal,
  Waypoints,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEnvironmentScan } from "@/hooks/use-environment-scan";
import { isTauriRuntime } from "@/lib/tauri";
import type {
  CheckStatus,
  DependencyCheck,
  DependencyId,
  EnvironmentScan,
  MirrorMode,
} from "@/lib/types";
import { formatScanTime, labelPlatform } from "@/lib/utils";

const iconMap: Record<DependencyId, typeof SquareTerminal> = {
  node: SquareTerminal,
  npm: PackageSearch,
  git: GitBranch,
  homebrew: AppWindowMac,
};

const statusMeta: Record<
  CheckStatus,
  { label: string; variant: "success" | "warning" | "danger" | "info" }
> = {
  installed: { label: "已安装", variant: "success" },
  outdated: { label: "版本过低", variant: "warning" },
  missing: { label: "未安装", variant: "danger" },
  error: { label: "异常", variant: "danger" },
};

function buildSummary(scan: EnvironmentScan) {
  const visibleChecks = scan.checks.filter((check) => check.visible);
  const readyCount = visibleChecks.filter((check) => check.status === "installed").length;
  const blockedCount = visibleChecks.length - readyCount;

  if (scan.overallReady) {
    return {
      title: "环境已就绪",
      description: `${readyCount}/${visibleChecks.length} 项已通过`,
      tone: "success" as const,
    };
  }

  return {
    title: `还有 ${blockedCount} 项待补齐`,
    description: `已通过 ${readyCount}/${visibleChecks.length} 项`,
    tone: "warning" as const,
  };
}

function recommendedActions(scan: EnvironmentScan) {
  return scan.checks
    .filter((check) => check.visible && check.actionEnabled)
    .slice(0, 3)
    .map((check) => ({
      id: check.id,
      title: check.title,
      action: check.actionLabel,
      summary: check.summary,
    }));
}

function DiagnosticsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="animate-pulse border-border/70">
          <CardHeader>
            <div className="h-5 w-24 rounded-full bg-foreground/10" />
            <div className="h-8 w-36 rounded-full bg-foreground/8" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-4 rounded-full bg-foreground/8" />
            <div className="h-4 w-3/4 rounded-full bg-foreground/8" />
            <div className="h-11 rounded-2xl bg-foreground/10" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface DiagnosticsContentProps {
  scan: EnvironmentScan;
  message: string | null;
  error: string | null;
  isRefreshing: boolean;
  switchingMirror: boolean;
  resettingDemo: boolean;
  installingId: DependencyId | null;
  onRefresh: () => void;
  onInstall: (id: DependencyId) => void;
  onSwitchMirror: (mode: MirrorMode) => void;
  onResetDemo: () => void;
}

export function DiagnosticsContent({
  scan,
  message,
  error,
  isRefreshing,
  switchingMirror,
  resettingDemo,
  installingId,
  onRefresh,
  onInstall,
  onSwitchMirror,
  onResetDemo,
}: DiagnosticsContentProps) {
  const summary = buildSummary(scan);
  const actions = recommendedActions(scan);
  const visibleChecks = scan.checks.filter((check) => check.visible);
  const readyCount = visibleChecks.filter((check) => check.status === "installed").length;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="border-b border-border/70 p-5 lg:border-b-0 lg:border-r">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <Badge variant={summary.tone === "success" ? "success" : "warning"}>
                    Phase 1 · 环境检测
                  </Badge>
                  <h3 className="mt-3 text-2xl font-semibold tracking-tight">{summary.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{summary.description}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="inline-flex h-9 items-center gap-2 rounded-2xl border border-border/80 px-3 text-sm">
                    <CheckCircle2 className="size-4 text-success" />
                    {readyCount}/{visibleChecks.length}
                  </div>
                  <div className="inline-flex h-9 items-center rounded-2xl border border-border/80 px-3 text-sm">
                    {labelPlatform(scan.platform)}
                  </div>
                  <Badge
                    className="h-9 rounded-2xl px-3 text-sm"
                    variant={scan.mirrorMode === "china" ? "info" : "neutral"}
                  >
                    {scan.mirrorMode === "china" ? "国内镜像" : "官方源"}
                  </Badge>
                  <div className="inline-flex h-9 items-center rounded-2xl border border-border/80 px-3 text-sm text-muted-foreground">
                    {formatScanTime(scan.scannedAt)}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={onRefresh} size="sm" variant="default">
                  {isRefreshing ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  全部重检
                </Button>
                <Button
                  onClick={() =>
                    onSwitchMirror(scan.mirrorMode === "china" ? "official" : "china")
                  }
                  size="sm"
                  variant={scan.mirrorMode === "china" ? "secondary" : "outline"}
                >
                  {switchingMirror ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : scan.mirrorMode === "china" ? (
                    <Rocket className="size-4" />
                  ) : (
                    <Waypoints className="size-4" />
                  )}
                  {scan.mirrorMode === "china" ? "恢复官方源" : "切换国内镜像"}
                </Button>
                {!isTauriRuntime() ? (
                  <Button onClick={onResetDemo} size="sm" variant="outline">
                    {resettingDemo ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    重置 Demo
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="p-5">
              <div className="rounded-[24px] border border-border/70 bg-foreground/5 p-4">
                <p className="text-sm font-medium">待处理</p>
                <div className="mt-3 space-y-2">
                  {actions.length > 0 ? (
                    actions.map((action) => (
                      <div
                        key={action.id}
                        className="flex items-center gap-2 rounded-2xl border border-border/60 px-3 py-2.5"
                      >
                        <ArrowRight className="size-4 text-primary" />
                        <p className="truncate text-sm">
                          <span className="font-medium">{action.title}</span>
                          <span className="text-muted-foreground"> · {action.action}</span>
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-border/60 px-3 py-2.5 text-sm text-muted-foreground">
                      当前没有待处理项
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {message ? (
        <div className="flex items-start gap-3 rounded-[20px] border border-primary/20 bg-primary/10 px-4 py-3 text-sm leading-5 text-foreground">
          <CheckCircle2 className="mt-0.5 size-4 text-primary" />
          <p>{message}</p>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-3 rounded-[20px] border border-danger/20 bg-danger/10 px-4 py-3 text-sm leading-5 text-foreground">
          <AlertTriangle className="mt-0.5 size-4 text-danger" />
          <p>{error}</p>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-4">
        {visibleChecks.map((check) => (
          <DependencyCard
            key={check.id}
            check={check}
            busy={installingId === check.id}
            onInstall={onInstall}
          />
        ))}
      </div>
    </div>
  );
}

function DependencyCard({
  check,
  busy,
  onInstall,
}: {
  check: DependencyCheck;
  busy: boolean;
  onInstall: (id: DependencyId) => void;
}) {
  const Icon = iconMap[check.id];
  const status = statusMeta[check.status];

  return (
    <Card className="border-border/70">
      <CardHeader className="gap-3 p-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <div>
          <CardTitle className="text-base">{check.title}</CardTitle>
          <CardDescription className="mt-1 text-xs leading-5">
            {check.version ? `版本 ${check.version}` : "未检测到版本"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4">
        <p className="h-10 overflow-hidden text-sm leading-5 text-muted-foreground">
          {check.summary}
        </p>

        <Button
          className="w-full"
          disabled={!check.actionEnabled || busy}
          onClick={() => onInstall(check.id)}
          size="sm"
          variant={check.actionEnabled ? "default" : "secondary"}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
          {busy ? "处理中..." : check.actionLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

export function DiagnosticsPage() {
  const {
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
  } = useEnvironmentScan();

  return (
    <section className="space-y-4">
      {state === "loading" && !scan ? <DiagnosticsSkeleton /> : null}
      {scan ? (
        <DiagnosticsContent
          error={error}
          installingId={installingId}
          isRefreshing={isRefreshing}
          message={message}
          onInstall={(id) => {
            void install(id);
          }}
          onRefresh={() => {
            void refresh();
          }}
          onSwitchMirror={(mode) => {
            void setMirrorMode(mode);
          }}
          onResetDemo={() => {
            void resetDemo();
          }}
          resettingDemo={resettingDemo}
          scan={scan}
          switchingMirror={switchingMirror}
        />
      ) : null}
      {state === "error" && !scan ? (
        <Card className="border-danger/20">
          <CardHeader>
            <CardTitle>环境检测失败</CardTitle>
            <CardDescription>当前未能读取系统依赖状态，请稍后重试。</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void refresh()}>
              <RefreshCw className="size-4" />
              重试检测
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
