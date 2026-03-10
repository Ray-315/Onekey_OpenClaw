import {
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Search,
  Store,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchOpenClawSkillDetail,
  fetchOpenClawSkills,
  launchOpenClawSkillInstall,
  openExternalUrl,
} from "@/lib/tauri";
import type {
  OpenClawSkillDetail,
  OpenClawSkillInstallAction,
  OpenClawSkillSummary,
  OpenClawSkillsCatalog,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type SkillFilter = "all" | "ready" | "missing";

function missingSummary(skill: OpenClawSkillSummary | OpenClawSkillDetail) {
  const items = [
    ...(skill.missing.bins.length > 0 ? [`命令 ${skill.missing.bins.join(", ")}`] : []),
    ...(skill.missing.anyBins.length > 0 ? [`任一命令 ${skill.missing.anyBins.join(" / ")}`] : []),
    ...(skill.missing.env.length > 0 ? [`环境变量 ${skill.missing.env.join(", ")}`] : []),
    ...(skill.missing.config.length > 0 ? [`配置 ${skill.missing.config.join(", ")}`] : []),
    ...(skill.missing.os.length > 0 ? [`系统 ${skill.missing.os.join(", ")}`] : []),
  ];

  return items.length > 0 ? items.join(" · ") : "缺失项已满足";
}

export function SkillsPage() {
  const [catalog, setCatalog] = useState<OpenClawSkillsCatalog | null>(null);
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [selectedName, setSelectedName] = useState<string>("");
  const [detail, setDetail] = useState<OpenClawSkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [installingActionId, setInstallingActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshSkills(message?: string) {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchOpenClawSkills();
      setCatalog(result);
      setNotice(message ?? `已读取 ${result.totalCount} 个 skills，其中 ${result.readyCount} 个已就绪。`);
    } catch (skillsError) {
      setError(skillsError instanceof Error ? skillsError.message : "读取 skills 列表失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshSkills();
  }, []);

  const filteredSkills = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return (catalog?.skills ?? []).filter((skill) => {
      if (filter === "ready" && !skill.eligible) {
        return false;
      }
      if (filter === "missing" && skill.eligible) {
        return false;
      }

      if (!normalizedKeyword) {
        return true;
      }

      return (
        skill.name.toLowerCase().includes(normalizedKeyword) ||
        skill.description.toLowerCase().includes(normalizedKeyword) ||
        skill.source.toLowerCase().includes(normalizedKeyword)
      );
    });
  }, [catalog?.skills, filter, keyword]);

  async function openSkillDetail(name: string) {
    setSelectedName(name);
    setDetail(null);
    setDetailModalOpen(true);
    setDetailLoading(true);
    setError(null);

    try {
      const result = await fetchOpenClawSkillDetail(name);
      setDetail(result);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "读取 skill 详情失败。");
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleInstall(action: OpenClawSkillInstallAction) {
    if (!detail) {
      return;
    }

    setInstallingActionId(action.id);
    setError(null);

    try {
      const result = await launchOpenClawSkillInstall(detail.name, action.id);
      setNotice(result.message);
      await refreshSkills(result.message);
      const latestDetail = await fetchOpenClawSkillDetail(detail.name);
      setDetail(latestDetail);
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : "拉起安装失败。");
    } finally {
      setInstallingActionId(null);
    }
  }

  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="grid gap-0 p-0 lg:grid-cols-[minmax(0,1.1fr)_360px]">
          <div className="border-b border-border/70 p-6 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="info">Skills 商店</Badge>
              <Badge variant="neutral">OpenClaw 支持列表</Badge>
            </div>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight">把 OpenClaw 支持的 skills 公开给你看</h3>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                disabled={loading}
                onClick={() => {
                  void refreshSkills("已刷新 skills 列表。");
                }}
                variant="outline"
              >
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                刷新 skills
              </Button>
              <Button
                onClick={() => {
                  void openExternalUrl("https://docs.openclaw.ai/cli/skills");
                }}
                variant="ghost"
              >
                <ExternalLink className="size-4" />
                Skills 文档
              </Button>
            </div>
          </div>

          <div className="p-6">
            <div className="rounded-[28px] border border-border/70 bg-foreground/5 p-5">
              <p className="text-sm font-medium">当前概览</p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">已就绪</p>
                  <p className="mt-2 text-lg font-semibold">{catalog?.readyCount ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">总数</p>
                  <p className="mt-2 text-lg font-semibold">{catalog?.totalCount ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">托管目录</p>
                  <p className="mt-2 break-all text-sm font-semibold">{catalog?.managedSkillsDir || "未读取"}</p>
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
          {notice}
        </div>
      ) : null}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>技能列表</CardTitle>
          <CardDescription>列表全宽展示；点某个 skill 再弹窗查看详情和安装入口。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[
              { id: "all" as const, label: "全部" },
              { id: "ready" as const, label: "已就绪" },
              { id: "missing" as const, label: "待补条件" },
            ].map((item) => (
              <Button
                key={item.id}
                onClick={() => setFilter(item.id)}
                size="sm"
                variant={filter === item.id ? "default" : "outline"}
              >
                {item.label}
              </Button>
            ))}
          </div>

          <label className="block">
            <span className="sr-only">搜索 skills</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-11 w-full rounded-2xl border border-border/70 bg-background/60 pl-11 pr-4 text-sm outline-none transition-colors focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索 skill 名称、描述或来源"
                value={keyword}
              />
            </div>
          </label>

          <div className="space-y-3">
            {filteredSkills.map((skill) => (
              <button
                key={skill.name}
                className={cn(
                  "w-full rounded-[24px] border px-4 py-4 text-left transition-colors hover:bg-foreground/5 hover:shadow-lg",
                  selectedName === skill.name && detailModalOpen
                    ? "border-primary/30 bg-primary/10"
                    : "border-border/70 bg-background/40",
                )}
                onClick={() => {
                  void openSkillDetail(skill.name);
                }}
                type="button"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
                      <p className="shrink-0 text-sm font-semibold">{skill.name}</p>
                      <p className="line-clamp-1 text-sm leading-6 text-muted-foreground">
                        {skill.description}
                      </p>
                    </div>
                    <p className="mt-2 line-clamp-1 text-xs leading-5 text-muted-foreground">
                      {missingSummary(skill)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge variant="neutral">{skill.source === "openclaw-bundled" ? "内置" : skill.source}</Badge>
                    <Badge variant={skill.eligible ? "success" : "warning"}>
                      {skill.eligible ? "已就绪" : "待补条件"}
                    </Badge>
                    <span className="text-xs font-medium text-muted-foreground">查看详情</span>
                  </div>
                </div>
              </button>
            ))}

            {!loading && filteredSkills.length === 0 ? (
              <div className="rounded-[24px] border border-border/70 bg-foreground/5 px-4 py-6 text-sm text-muted-foreground">
                当前筛选下没有可显示的 skills。
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {detailModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="w-full max-w-5xl rounded-[32px] border border-border/70 bg-background shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-border/70 px-6 py-5">
              <div>
                <p className="text-sm text-muted-foreground">Skill 详情</p>
                <h4 className="text-xl font-semibold">{selectedName || "读取中"}</h4>
              </div>
              <Button onClick={() => setDetailModalOpen(false)} size="icon" variant="ghost">
                <X className="size-4" />
              </Button>
            </div>

            <div className="p-6">
              {detailLoading ? (
                <div className="flex min-h-[360px] items-center justify-center rounded-[24px] border border-border/70 bg-foreground/5">
                  <LoaderCircle className="size-5 animate-spin text-primary" />
                </div>
              ) : detail ? (
                <div className="space-y-5">
                  <div className="rounded-[24px] border border-border/70 bg-foreground/5 p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <h4 className="text-2xl font-semibold">{detail.name}</h4>
                      <Badge variant={detail.eligible ? "success" : "warning"}>
                        {detail.eligible ? "已就绪" : "待补条件"}
                      </Badge>
                      <Badge variant={detail.bundled ? "neutral" : "info"}>
                        {detail.bundled ? "OpenClaw 内置" : detail.source}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{detail.description}</p>
                    <p className="mt-4 break-all font-mono text-xs leading-6 text-muted-foreground">
                      {detail.filePath}
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-[24px] border border-border/70 bg-background/70 p-5">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {detail.eligible ? (
                          <CheckCircle2 className="size-4 text-success" />
                        ) : (
                          <CircleDashed className="size-4 text-warning" />
                        )}
                        缺失要求
                      </div>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">{missingSummary(detail)}</p>
                    </div>
                    <div className="rounded-[24px] border border-border/70 bg-background/70 p-5">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Store className="size-4 text-primary" />
                        来源与路径
                      </div>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {detail.source} · {detail.bundled ? "内置 skill，不直接卸载 skill 本体。" : "托管 skill。"}
                      </p>
                      <p className="mt-3 break-all font-mono text-xs leading-6 text-muted-foreground">
                        {detail.baseDir}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-border/70 bg-background/70 p-5">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Wrench className="size-4 text-primary" />
                        补齐入口
                      </div>
                    {detail.install.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-3">
                        {detail.install.map((action) => (
                          <Button
                            key={action.id}
                            disabled={installingActionId !== null}
                            onClick={() => {
                              void handleInstall(action);
                            }}
                            variant={detail.eligible ? "outline" : "default"}
                          >
                            {installingActionId === action.id ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                              <TerminalSquare className="size-4" />
                            )}
                            {action.label}
                          </Button>
                        ))}
                        {detail.homepage ? (
                          <Button
                            onClick={() => {
                              void openExternalUrl(detail.homepage!);
                            }}
                            variant="ghost"
                          >
                            <ExternalLink className="size-4" />
                            打开主页
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        这个 skill 没有暴露可自动安装的依赖动作。通常需要你手动补齐环境变量或 OpenClaw 配置项。
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[360px] items-center justify-center rounded-[24px] border border-border/70 bg-foreground/5 text-sm text-muted-foreground">
                  当前详情暂时不可用，请稍后重试。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
