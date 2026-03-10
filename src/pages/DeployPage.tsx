import {
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Expand,
  ExternalLink,
  FolderCog,
  KeyRound,
  LoaderCircle,
  LockOpen,
  PackagePlus,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Waypoints,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useWorkbenchSettings } from "@/components/app/app-settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchOpenClawCatalog,
  installOpenClaw,
  isTauriRuntime,
} from "@/lib/tauri";
import type {
  DeployAuthMode,
  OpenClawCatalog,
  OpenClawProviderCatalog,
  OpenClawProviderModel,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type PlanId = "quickstart" | "stable";
type CatalogState = "loading" | "ready" | "error";
type LoginStatus = "idle" | "running" | "connected";
type LogLevel = "info" | "debug" | "warn";

interface PlanDefinition {
  id: PlanId;
  title: string;
  badge: string;
  tone: "success" | "warning";
  summary: string;
  detail: string;
  preferredProviders: string[];
  preferredModels: string[];
}

interface ProviderInsight {
  title: string;
  summary: string;
  primaryLabel: string;
  primaryUrl: string;
  secondaryLabel: string;
  secondaryUrl: string;
  apiEnv?: string;
  oauthLabel?: string;
  oauthCommand?: string;
  oauthNote?: string;
}

interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface DeployConfig {
  planId: PlanId;
  primaryProviderId: string;
  primaryModelRef: string;
  authMode: DeployAuthMode;
  apiSecret: string;
  fallbackEnabled: boolean;
  fallbackProviderId: string;
  fallbackModelRef: string;
  installDir: string;
  workspaceDir: string;
  logLevel: LogLevel;
  autoStartGateway: boolean;
  createDesktopShortcut: boolean;
  writeExampleRecipe: boolean;
}

interface DeployStage {
  id: string;
  title: string;
  detail: string;
}

const plans: PlanDefinition[] = [
  {
    id: "quickstart",
    title: "快速体验",
    badge: "先装 OpenClaw",
    tone: "success",
    summary: "先安装 OpenClaw，再从 CLI 读取可用 provider 和模型，优先走免费额度或低门槛路线。",
    detail: "主推 Z.AI / GLM 与 MiniMax。安装完成前，不允许直接开始部署。",
    preferredProviders: ["zai", "minimax"],
    preferredModels: ["zai/glm-4.7", "zai/glm-5", "minimax/MiniMax-M2.5"],
  },
  {
    id: "stable",
    title: "稳定部署",
    badge: "需要付费",
    tone: "warning",
    summary: "安装 OpenClaw 后，优先选择更稳定、更便宜但能力够用的官方模型入口。",
    detail: "默认偏向 OpenAI 的低价档，也可改成 Anthropic 的网页登录流。",
    preferredProviders: ["openai", "anthropic"],
    preferredModels: [
      "openai/gpt-5-mini",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5.4",
    ],
  },
];

const providerInsights: Record<string, ProviderInsight> = {
  zai: {
    title: "Z.AI / GLM",
    summary: "免费 API 入口优先，适合把 OpenClaw 的第一条部署链路跑通。",
    primaryLabel: "申请智谱免费 API",
    primaryUrl: "https://open.bigmodel.cn/console/trialcenter",
    secondaryLabel: "查看 Z.AI 文档",
    secondaryUrl: "https://docs.openclaw.ai/providers/zai",
    apiEnv: "ZAI_API_KEY",
  },
  minimax: {
    title: "MiniMax",
    summary: "适合先领注册额度做快速体验。OpenClaw 可通过 provider 配置直接接入。",
    primaryLabel: "申请 MiniMax 免费额度",
    primaryUrl: "https://www.minimax.io/pricing",
    secondaryLabel: "查看 MiniMax 文档",
    secondaryUrl: "https://docs.openclaw.ai/providers/minimax",
    apiEnv: "MINIMAX_API_KEY",
  },
  openai: {
    title: "OpenAI",
    summary: "稳定部署默认推荐项。可走 API Key，也可走网页登录式接入。",
    primaryLabel: "查看 OpenAI 定价",
    primaryUrl: "https://openai.com/api/pricing/",
    secondaryLabel: "查看 OpenAI 文档",
    secondaryUrl: "https://docs.openclaw.ai/providers/openai",
    apiEnv: "OPENAI_API_KEY",
    oauthLabel: "OAuth 登录",
    oauthCommand: "openclaw models auth login --provider openai-codex",
  },
  anthropic: {
    title: "Anthropic",
    summary: "偏高质量路线。可以用 API Key，也可以走网页登录式授权。",
    primaryLabel: "查看 Claude 定价",
    primaryUrl: "https://platform.claude.com/docs/zh-CN/about-claude/pricing",
    secondaryLabel: "查看 Anthropic 文档",
    secondaryUrl: "https://docs.openclaw.ai/providers/anthropic",
    apiEnv: "ANTHROPIC_API_KEY",
    oauthLabel: "OAuth 登录",
    oauthCommand: "claude setup-token -> openclaw models auth setup-token --provider anthropic",
    oauthNote: "Anthropic 底层真实接入会走 setup-token，界面统一收口为 OAuth 登录。",
  },
  google: {
    title: "Google Gemini",
    summary: "适合已有 Gemini API 的团队，这一版只保留 API Key 路线。",
    primaryLabel: "查看 Model Providers",
    primaryUrl: "https://docs.openclaw.ai/concepts/model-providers",
    secondaryLabel: "查看 Gemini 示例",
    secondaryUrl: "https://docs.openclaw.ai/concepts/model-providers",
    apiEnv: "GEMINI_API_KEY",
  },
};

const logLevels: Array<{ id: LogLevel; title: string; hint: string }> = [
  { id: "info", title: "Info", hint: "适合大多数部署日志。" },
  { id: "debug", title: "Debug", hint: "记录更详细，适合排查接入问题。" },
  { id: "warn", title: "Warn", hint: "只保留关键告警，适合长期运行。" },
];

function buildPlanConfig(planId: PlanId): DeployConfig {
  if (planId === "stable") {
    return {
      planId,
      primaryProviderId: "",
      primaryModelRef: "",
      authMode: "api",
      apiSecret: "",
      fallbackEnabled: false,
      fallbackProviderId: "",
      fallbackModelRef: "",
      installDir: "~/Applications/OpenClaw",
      workspaceDir: "~/OpenClaw/workspaces/default",
      logLevel: "warn",
      autoStartGateway: true,
      createDesktopShortcut: true,
      writeExampleRecipe: true,
    };
  }

  return {
    planId: "quickstart",
    primaryProviderId: "",
    primaryModelRef: "",
    authMode: "api",
    apiSecret: "",
    fallbackEnabled: false,
    fallbackProviderId: "",
    fallbackModelRef: "",
    installDir: "~/OpenClaw",
    workspaceDir: "~/OpenClaw/workspace",
    logLevel: "info",
    autoStartGateway: true,
    createDesktopShortcut: false,
    writeExampleRecipe: false,
  };
}

function inputClassName() {
  return "mt-3 h-11 w-full rounded-2xl border border-border/70 bg-background/60 px-4 text-sm outline-none transition-colors focus:border-primary/50 focus:ring-4 focus:ring-primary/10";
}

function optionTriggerClassName(open: boolean) {
  return cn(
    "mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10",
    open ? "border-primary/40 bg-primary/6" : "hover:bg-foreground/5",
  );
}

interface SelectMenuProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
}

function SelectMenu({
  label,
  value,
  options,
  onChange,
  placeholder = "请选择",
  emptyLabel = "暂无可选项",
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const empty = options.length === 0;

  return (
    <div className="relative" ref={rootRef}>
      <span className="text-sm font-medium">{label}</span>
      <button
        className={optionTriggerClassName(open)}
        disabled={empty}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{selected?.label ?? placeholder}</p>
          <p className="mt-1 truncate text-xs leading-5 text-muted-foreground">
            {selected?.hint ?? (empty ? emptyLabel : "点击展开选择")}
          </p>
        </div>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", open ? "rotate-180" : "rotate-0")}
        />
      </button>

      {open ? (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-[24px] border border-border/70 bg-background/98 shadow-2xl backdrop-blur">
          <div className="max-h-80 overflow-auto p-2">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-2xl px-3 py-3 text-left transition-colors",
                    active ? "bg-primary/10 text-foreground" : "hover:bg-foreground/5",
                  )}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  type="button"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{option.label}</p>
                    {option.hint ? (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.hint}</p>
                    ) : null}
                  </div>
                  {active ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fallbackInsight(providerId: string): ProviderInsight {
  return {
    title: providerId,
    summary: "该 provider 由 OpenClaw CLI 返回，这里暂未补充更细的供应商说明。",
    primaryLabel: "查看 Model Providers",
    primaryUrl: "https://docs.openclaw.ai/concepts/model-providers",
    secondaryLabel: "查看 OpenClaw 文档",
    secondaryUrl: "https://docs.openclaw.ai/",
  };
}

function getProviderInsight(providerId: string) {
  return providerInsights[providerId] ?? fallbackInsight(providerId);
}

function getProvider(catalog: OpenClawCatalog | null, providerId: string) {
  return catalog?.providers.find((provider) => provider.id === providerId) ?? null;
}

function getModel(
  catalog: OpenClawCatalog | null,
  modelRef: string,
): { provider: OpenClawProviderCatalog; model: OpenClawProviderModel } | null {
  if (!catalog) {
    return null;
  }

  for (const provider of catalog.providers) {
    const model = provider.models.find((item) => item.ref === modelRef);
    if (model) {
      return { provider, model };
    }
  }

  return null;
}

function preferredProviderIds(planId: PlanId) {
  return plans.find((plan) => plan.id === planId)?.preferredProviders ?? [];
}

function preferredModelRefs(planId: PlanId) {
  return plans.find((plan) => plan.id === planId)?.preferredModels ?? [];
}

function pickInitialProvider(catalog: OpenClawCatalog, planId: PlanId) {
  for (const providerId of preferredProviderIds(planId)) {
    const provider = getProvider(catalog, providerId);
    if (provider && provider.models.length > 0) {
      return provider;
    }
  }

  return catalog.providers.find((provider) => provider.models.length > 0) ?? null;
}

function pickInitialModel(provider: OpenClawProviderCatalog | null, planId: PlanId) {
  if (!provider || provider.models.length === 0) {
    return null;
  }

  for (const modelRef of preferredModelRefs(planId)) {
    const matched = provider.models.find((model) => model.ref === modelRef);
    if (matched) {
      return matched;
    }
  }

  return provider.models[0];
}

function buildProviderOptions(catalog: OpenClawCatalog | null) {
  return (catalog?.providers ?? []).map((provider) => ({
    value: provider.id,
    label: provider.title,
    hint: provider.summary,
  }));
}

function buildModelOptions(provider: OpenClawProviderCatalog | null) {
  return (provider?.models ?? []).map((model) => ({
    value: model.ref,
    label: model.title,
    hint: model.ref,
  }));
}

function buildPreview(config: DeployConfig, catalog: OpenClawCatalog | null) {
  const primary = getModel(catalog, config.primaryModelRef);
  const fallback = config.fallbackEnabled ? getModel(catalog, config.fallbackModelRef) : null;
  const providerInsight = primary ? getProviderInsight(primary.provider.id) : null;

  const payload: Record<string, unknown> = {
    installDir: config.installDir,
    workspaceDir: config.workspaceDir,
    gateway: {
      autoStart: config.autoStartGateway,
      logLevel: config.logLevel,
    },
    agents: {
      defaults: {
        model: {
          primary:
            config.authMode === "login" && primary?.model.supportsLogin
              ? `${primary.provider.id}-oauth/${primary.model.title}`
              : config.primaryModelRef,
          fallbacks: fallback ? [fallback.model.ref] : [],
        },
      },
    },
    extras: {
      desktopShortcut: config.createDesktopShortcut,
      exampleRecipe: config.writeExampleRecipe,
    },
  };

  if (config.authMode === "api" && providerInsight?.apiEnv) {
    payload.env = {
      [providerInsight.apiEnv]: `\${${providerInsight.apiEnv}}`,
    };
  }

  if (config.authMode === "login" && providerInsight?.oauthCommand) {
    payload.auth = {
      mode: "oauth",
      command: providerInsight.oauthCommand,
    };
  }

  return JSON.stringify(payload, null, 2);
}

function previewExcerpt(payload: string, lines = 7) {
  const segments = payload.split("\n");
  if (segments.length <= lines) {
    return payload;
  }

  return `${segments.slice(0, lines).join("\n")}\n...`;
}

function buildStagePlan(config: DeployConfig, catalog: OpenClawCatalog | null): DeployStage[] {
  const primary = getModel(catalog, config.primaryModelRef);
  const primaryProvider = primary ? getProviderInsight(primary.provider.id) : null;
  const fallback = config.fallbackEnabled ? getModel(catalog, config.fallbackModelRef) : null;

  return [
    {
      id: "credential",
      title: "准备主模型凭据",
      detail:
        config.authMode === "login" && primaryProvider?.oauthCommand
          ? `准备执行 ${primaryProvider.oauthCommand}`
          : `准备写入 ${primaryProvider?.apiEnv ?? "API Key"} 并校验 ${config.primaryModelRef}`,
    },
    {
      id: "install",
      title: "初始化运行目录",
      detail: `在 ${config.installDir} 准备 OpenClaw 工作区 ${config.workspaceDir}`,
    },
    {
      id: "primary",
      title: "写入主模型配置",
      detail: `把主模型设置为 ${config.primaryModelRef}`,
    },
    {
      id: "fallback",
      title: "处理回退模型",
      detail: fallback ? `追加回退模型 ${fallback.model.ref}` : "当前不启用回退模型",
    },
    {
      id: "verify",
      title: "验证启动结果",
      detail: "检查 Gateway、provider 凭据与部署完成后的下一步设置入口",
    },
  ];
}

function openExternalLink(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function InstallOpenClawView({
  catalog,
  loading,
  installing,
  message,
  error,
  onInstall,
  onRefresh,
}: {
  catalog: OpenClawCatalog | null;
  loading: boolean;
  installing: boolean;
  message: string | null;
  error: string | null;
  onInstall: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="grid gap-0 p-0 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="border-b border-border/70 p-6 xl:border-b-0 xl:border-r">
            <Badge variant="info">OpenClaw · 一键部署</Badge>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight">先安装 OpenClaw，才能继续部署</h3>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              这页现在不会在安装前展示模型和 provider 选择器。OpenClaw 安装完成后，系统会直接通过
              CLI 读取可用的模型公司和模型，再进入真正的部署配置。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button disabled={installing || loading} onClick={onInstall}>
                {installing ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <PackagePlus className="size-4" />
                )}
                {installing ? "安装脚本已拉起" : "安装 OpenClaw"}
              </Button>
              <Button disabled={loading} onClick={onRefresh} variant="outline">
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                重新检测
              </Button>
            </div>
          </div>

          <div className="space-y-4 p-6">
            <div className="rounded-[28px] border border-border/70 bg-foreground/5 p-5">
              <p className="text-sm text-muted-foreground">当前状态</p>
              <p className="mt-2 text-2xl font-semibold">
                {catalog?.installed ? "已安装" : loading ? "检测中" : "未安装"}
              </p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {message ?? catalog?.message ?? "安装完成后，点击重新检测继续。"}
              </p>
            </div>

            <div className="rounded-[28px] border border-border/70 bg-background/80 p-5">
              <p className="text-sm font-medium">下一步</p>
              <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                <div className="rounded-2xl border border-border/70 px-4 py-3">
                  安装完成后点“重新检测”，页面会解锁模型、授权和部署配置。
                </div>
                <div className="rounded-2xl border border-border/70 px-4 py-3">
                  模型列表直接来自 OpenClaw CLI，不再使用前端硬编码。
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
    </section>
  );
}

export function DeployPage() {
  const { settings } = useWorkbenchSettings();
  const [catalogState, setCatalogState] = useState<CatalogState>("loading");
  const [catalog, setCatalog] = useState<OpenClawCatalog | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installingOpenClaw, setInstallingOpenClaw] = useState(false);
  const [config, setConfig] = useState<DeployConfig>(() => buildPlanConfig("quickstart"));
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [loginStatus, setLoginStatus] = useState<LoginStatus>("idle");
  const [running, setRunning] = useState(false);
  const [activeStageIndex, setActiveStageIndex] = useState(-1);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const loginTimerRef = useRef<number | null>(null);

  async function refreshCatalog(nextMessage?: string) {
    setError(null);
    setCatalogState("loading");

    try {
      const result = await fetchOpenClawCatalog();
      setCatalog(result);
      setCatalogState("ready");
      setStatusMessage(nextMessage ?? result.message);
    } catch (catalogError) {
      setCatalogState("error");
      setError(
        catalogError instanceof Error ? catalogError.message : "读取 OpenClaw 状态失败，请稍后重试。",
      );
    }
  }

  useEffect(() => {
    void refreshCatalog();
  }, []);

  useEffect(() => {
    return () => {
      if (loginTimerRef.current !== null) {
        window.clearTimeout(loginTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!catalog?.installed || catalog.providers.length === 0) {
      return;
    }

    const preferredProvider =
      getProvider(catalog, config.primaryProviderId) ?? pickInitialProvider(catalog, config.planId);
    if (!preferredProvider) {
      return;
    }

    const preferredModel =
      preferredProvider.models.find((item) => item.ref === config.primaryModelRef) ??
      pickInitialModel(preferredProvider, config.planId);
    if (!preferredModel) {
      return;
    }

    const nextAuthMode = preferredModel.authModes.includes(config.authMode)
      ? config.authMode
      : preferredModel.authModes[0];
    const nextFallbackProviderId = config.fallbackProviderId || preferredProvider.id;
    const nextFallbackModel = config.fallbackEnabled
      ? getProvider(catalog, nextFallbackProviderId)?.models.find(
          (item) => item.ref === config.fallbackModelRef && item.ref !== preferredModel.ref,
        ) ??
        getProvider(catalog, nextFallbackProviderId)?.models.find((item) => item.ref !== preferredModel.ref) ??
        null
      : null;

    if (
      config.primaryProviderId !== preferredProvider.id ||
      config.primaryModelRef !== preferredModel.ref ||
      config.authMode !== nextAuthMode ||
      (config.fallbackEnabled && config.fallbackModelRef !== (nextFallbackModel?.ref ?? ""))
    ) {
      setConfig((current) => ({
        ...current,
        primaryProviderId: preferredProvider.id,
        primaryModelRef: preferredModel.ref,
        authMode: nextAuthMode,
        fallbackProviderId: nextFallbackProviderId,
        fallbackModelRef: nextFallbackModel?.ref ?? "",
      }));
    }
  }, [
    catalog,
    config.authMode,
    config.fallbackEnabled,
    config.fallbackModelRef,
    config.fallbackProviderId,
    config.planId,
    config.primaryModelRef,
    config.primaryProviderId,
  ]);

  const activePlan = plans.find((plan) => plan.id === config.planId) ?? plans[0];
  const primaryProvider = getProvider(catalog, config.primaryProviderId);
  const primaryModel = getModel(catalog, config.primaryModelRef)?.model ?? null;
  const primaryInsight = getProviderInsight(config.primaryProviderId);
  const primaryProviderOptions = buildProviderOptions(catalog);
  const primaryModelOptions = buildModelOptions(primaryProvider);
  const fallbackProvider = getProvider(catalog, config.fallbackProviderId);
  const fallbackProviderOptions = buildProviderOptions(catalog);
  const fallbackModelOptions = buildModelOptions(fallbackProvider).filter(
    (item) => item.value !== config.primaryModelRef,
  );
  const preview = buildPreview(config, catalog);
  const stagePlan = buildStagePlan(config, catalog);
  const progressValue = running
    ? ((Math.max(activeStageIndex, 0) + 0.35) / stagePlan.length) * 100
    : activeStageIndex >= stagePlan.length
      ? 100
      : 0;
  const credentialReady =
    config.authMode === "api" ? config.apiSecret.trim().length > 0 : loginStatus === "connected";
  const canStart = catalog?.installed && credentialReady && !running && Boolean(config.primaryModelRef);

  useEffect(() => {
    if (!running) {
      return undefined;
    }

    if (activeStageIndex < 0 || activeStageIndex >= stagePlan.length) {
      return undefined;
    }

    const currentStage = stagePlan[activeStageIndex];
    const timeout = window.setTimeout(() => {
      if (activeStageIndex + 1 >= stagePlan.length) {
        setLastSummary(
          `部署演示完成。主模型将写入 ${config.primaryModelRef}，运行目录为 ${config.installDir}。`,
        );
        setActiveStageIndex(stagePlan.length);
        setRunning(false);
        return;
      }

      setLastSummary(`${currentStage.title} 已完成。`);
      setActiveStageIndex((current) => current + 1);
    }, activeStageIndex === 0 ? 650 : 900);

    return () => window.clearTimeout(timeout);
  }, [activeStageIndex, config.installDir, config.primaryModelRef, running, stagePlan]);

  async function handleInstallOpenClaw() {
    setInstallingOpenClaw(true);
    setError(null);
    setStatusMessage(null);

    try {
      const result = await installOpenClaw();
      setStatusMessage(settings.showInstallNotice ? result.message : null);

      if (!isTauriRuntime()) {
        await refreshCatalog(settings.showInstallNotice ? result.message : undefined);
      }
    } catch (installError) {
      setError(
        installError instanceof Error ? installError.message : "拉起 OpenClaw 安装失败，请稍后重试。",
      );
    } finally {
      setInstallingOpenClaw(false);
    }
  }

  function applyPlan(planId: PlanId) {
    setConfig((current) => ({ ...buildPlanConfig(planId), installDir: current.installDir, workspaceDir: current.workspaceDir }));
    setLoginStatus("idle");
    setRunning(false);
    setActiveStageIndex(-1);
    setLastSummary(`已切换到 ${plans.find((plan) => plan.id === planId)?.title ?? planId}。`);
  }

  function updateConfig(patch: Partial<DeployConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function changePrimaryProvider(providerId: string) {
    const nextProvider = getProvider(catalog, providerId);
    const nextModel = pickInitialModel(nextProvider, config.planId);
    if (!nextProvider || !nextModel) {
      return;
    }

    updateConfig({
      primaryProviderId: nextProvider.id,
      primaryModelRef: nextModel.ref,
      authMode: nextModel.authModes.includes(config.authMode) ? config.authMode : nextModel.authModes[0],
      apiSecret: "",
      fallbackModelRef: config.fallbackModelRef === nextModel.ref ? "" : config.fallbackModelRef,
    });
    setLoginStatus("idle");
    setLastSummary(`主模型公司已切到 ${nextProvider.title}。`);
  }

  function changePrimaryModel(modelRef: string) {
    const next = getModel(catalog, modelRef);
    if (!next) {
      return;
    }

    updateConfig({
      primaryProviderId: next.provider.id,
      primaryModelRef: next.model.ref,
      authMode: next.model.authModes.includes(config.authMode) ? config.authMode : next.model.authModes[0],
      apiSecret: "",
      fallbackModelRef: config.fallbackModelRef === next.model.ref ? "" : config.fallbackModelRef,
    });
    setLoginStatus("idle");
    setLastSummary(`主模型已切到 ${next.model.ref}。`);
  }

  function setAuthMode(mode: DeployAuthMode) {
    updateConfig({ authMode: mode, apiSecret: "" });
    setLoginStatus("idle");
    setLastSummary(mode === "login" ? "已切换到 OAuth 登录。" : "已切换到 API Key。");
  }

  function startLoginFlow() {
    if (!primaryModel?.supportsLogin || config.authMode !== "login" || running) {
      return;
    }

    if (loginTimerRef.current !== null) {
      window.clearTimeout(loginTimerRef.current);
    }

    setLoginStatus("running");
    setLastSummary("正在执行 OAuth 登录演示。真实接入时会先拉起命令行，再跳转网页登录页。");

    loginTimerRef.current = window.setTimeout(() => {
      setLoginStatus("connected");
      setLastSummary("OAuth 登录演示已完成，当前状态标记为已连接。");
      loginTimerRef.current = null;
    }, 1200);
  }

  function toggleFallback(enabled: boolean) {
    if (!enabled) {
      updateConfig({ fallbackEnabled: false, fallbackModelRef: "" });
      setLastSummary("已关闭回退模型。");
      return;
    }

    const nextProvider = getProvider(catalog, config.fallbackProviderId || config.primaryProviderId);
    const nextModel =
      nextProvider?.models.find((model) => model.ref !== config.primaryModelRef) ?? null;

    updateConfig({
      fallbackEnabled: true,
      fallbackProviderId: nextProvider?.id ?? config.primaryProviderId,
      fallbackModelRef: nextModel?.ref ?? "",
    });
    setLastSummary(nextModel ? `已启用回退模型：${nextModel.ref}。` : "已启用回退模型。");
  }

  function changeFallbackProvider(providerId: string) {
    const nextProvider = getProvider(catalog, providerId);
    const nextModel =
      nextProvider?.models.find((model) => model.ref !== config.primaryModelRef) ?? null;

    updateConfig({
      fallbackProviderId: providerId,
      fallbackModelRef: nextModel?.ref ?? "",
    });
  }

  function startDeployment() {
    if (!canStart) {
      return;
    }

    setRunning(true);
    setActiveStageIndex(0);
    setLastSummary(`准备开始 ${activePlan.title} 部署。`);
  }

  function resetDemo() {
    setRunning(false);
    setActiveStageIndex(-1);
    setLoginStatus("idle");
    setConfigModalOpen(false);
    setLastSummary(null);
  }

  if (catalogState === "loading" && !catalog) {
    return (
      <section className="space-y-6">
        <Card className="border-border/70">
          <CardContent className="space-y-4 p-6">
            <div className="h-5 w-24 animate-pulse rounded-full bg-foreground/10" />
            <div className="h-10 w-72 animate-pulse rounded-full bg-foreground/8" />
            <div className="h-24 animate-pulse rounded-[28px] bg-foreground/8" />
          </CardContent>
        </Card>
      </section>
    );
  }

  if (!catalog?.installed) {
    return (
      <InstallOpenClawView
        catalog={catalog}
        error={error}
        installing={installingOpenClaw}
        loading={catalogState === "loading"}
        message={statusMessage}
        onInstall={() => {
          void handleInstallOpenClaw();
        }}
        onRefresh={() => {
          void refreshCatalog();
        }}
      />
    );
  }

  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="grid gap-0 p-0 xl:grid-cols-[1.2fr_0.85fr]">
          <div className="border-b border-border/70 p-6 xl:border-b-0 xl:border-r">
            <Badge variant="info">OpenClaw · 一键部署</Badge>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight">OpenClaw 已就绪，现在开始选部署策略</h3>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              当前 provider 和模型列表已经改成从 OpenClaw CLI 动态读取。下拉菜单不再使用原生控件，也不再在右侧塞标签。
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button disabled={!canStart} onClick={startDeployment}>
                {running ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
                {running ? "部署进行中" : "开始一键部署"}
              </Button>
              <Button
                onClick={() => {
                  void refreshCatalog("已重新读取 OpenClaw 可用模型列表。");
                }}
                variant="outline"
              >
                <RefreshCw className="size-4" />
                刷新模型列表
              </Button>
              <Button onClick={resetDemo} variant="ghost">
                <RefreshCw className="size-4" />
                重置演示
              </Button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  className={cn(
                    "rounded-[26px] border px-5 py-5 text-left transition-colors",
                    config.planId === plan.id
                      ? "border-primary/30 bg-primary/10"
                      : "border-border/70 bg-background/40 hover:bg-foreground/5",
                  )}
                  onClick={() => applyPlan(plan.id)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-lg font-semibold">{plan.title}</p>
                    <Badge variant={plan.tone}>{plan.badge}</Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.summary}</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.detail}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 p-6">
            <div className="rounded-[28px] border border-border/70 bg-foreground/5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">当前部署摘要</p>
                  <p className="mt-2 text-2xl font-semibold">{activePlan.title}</p>
                </div>
                <Badge variant={activePlan.tone}>{activePlan.badge}</Badge>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Bot className="size-4 text-primary" />
                    主模型
                  </div>
                  <p className="mt-3 text-lg font-semibold">{config.primaryModelRef || "未选择"}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <KeyRound className="size-4 text-primary" />
                    授权方式
                  </div>
                  <p className="mt-3 text-lg font-semibold">
                    {config.authMode === "login" ? "OAuth 登录" : "API Key"}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CircleDashed className="size-4 text-primary" />
                    回退模型
                  </div>
                  <p className="mt-3 text-sm font-semibold leading-6">
                    {config.fallbackEnabled && config.fallbackModelRef ? config.fallbackModelRef : "当前不启用"}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <PackagePlus className="size-4 text-primary" />
                    OpenClaw
                  </div>
                  <p className="mt-3 text-sm font-semibold leading-6">
                    已安装 {catalog.version ?? ""}
                  </p>
                </div>
              </div>

              <div className="mt-5 h-3 rounded-full bg-foreground/8">
                <div
                  className="h-3 rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(progressValue, 100)}%` }}
                />
              </div>

              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                {lastSummary ??
                  statusMessage ??
                  "完成主模型和授权配置后，开始按钮才会解锁。选 OAuth 登录时，需要先点一次登录按钮。"}
              </p>
            </div>

            <div className="rounded-[28px] border border-border/70 bg-background/80 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">配置预览</p>
                <Button onClick={() => setConfigModalOpen(true)} size="sm" variant="outline">
                  <Expand className="size-4" />
                  显示全部
                </Button>
              </div>
              <pre className="mt-3 overflow-x-auto rounded-2xl bg-foreground/6 p-4 font-mono text-xs leading-6 text-muted-foreground">
                {previewExcerpt(preview)}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-[24px] border border-danger/20 bg-danger/10 px-4 py-4 text-sm leading-6">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>主模型</CardTitle>
              <CardDescription>公司和模型都直接来自 `openclaw models list`，而不是前端硬编码枚举。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <SelectMenu
                  label="模型公司"
                  onChange={changePrimaryProvider}
                  options={primaryProviderOptions}
                  value={config.primaryProviderId}
                />
                <SelectMenu
                  label="主模型"
                  onChange={changePrimaryModel}
                  options={primaryModelOptions}
                  value={config.primaryModelRef}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-[24px] border border-border/70 bg-foreground/5 p-5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Building2 className="size-4 text-primary" />
                    {primaryProvider?.title ?? primaryInsight.title}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{primaryInsight.summary}</p>
                  <p className="mt-3 font-mono text-xs text-muted-foreground">{config.primaryModelRef}</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {primaryModel?.title ?? "当前 provider 尚未返回模型详情。"}
                  </p>
                </div>

                <div className="rounded-[24px] border border-border/70 bg-background/70 p-5">
                  <p className="text-sm font-medium">当前推荐入口</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button onClick={() => openExternalLink(primaryInsight.primaryUrl)} variant="outline">
                      <ExternalLink className="size-4" />
                      {primaryInsight.primaryLabel}
                    </Button>
                    <Button onClick={() => openExternalLink(primaryInsight.secondaryUrl)} variant="ghost">
                      <Waypoints className="size-4" />
                      文档
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>授权方式</CardTitle>
              <CardDescription>
                只有 OpenClaw 返回支持登录的模型时，才会出现 `OAuth 登录` 按钮。否则固定使用 API Key。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => setAuthMode("api")}
                  variant={config.authMode === "api" ? "default" : "outline"}
                >
                  <KeyRound className="size-4" />
                  API Key
                </Button>
                {primaryModel?.supportsLogin ? (
                  <Button
                    onClick={() => setAuthMode("login")}
                    variant={config.authMode === "login" ? "default" : "outline"}
                  >
                    <LockOpen className="size-4" />
                    OAuth 登录
                  </Button>
                ) : null}
              </div>

              {config.authMode === "api" ? (
                <div className="rounded-[24px] border border-border/70 bg-foreground/5 p-5">
                  <p className="text-sm font-medium">
                    填写 {primaryInsight.apiEnv ?? "API Key"} 后，部署按钮才会解锁
                  </p>
                  <input
                    className={inputClassName()}
                    onChange={(event) => updateConfig({ apiSecret: event.target.value })}
                    placeholder={primaryInsight.apiEnv ?? "API_KEY"}
                    type="password"
                    value={config.apiSecret}
                  />
                </div>
              ) : (
                <div className="rounded-[24px] border border-border/70 bg-foreground/5 p-5">
                  <p className="text-sm font-medium">OAuth 登录已替代 API Key 输入框</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    真实接入时，这里会先拉起命令行，再跳转网页授权，完成后回到应用里继续写入 OpenClaw 配置。
                  </p>
                  <div className="mt-4 rounded-2xl border border-border/70 bg-background/70 p-4 font-mono text-xs leading-6 text-muted-foreground">
                    {primaryInsight.oauthCommand}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button disabled={loginStatus === "running"} onClick={startLoginFlow}>
                      {loginStatus === "running" ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <TerminalSquare className="size-4" />
                      )}
                      {loginStatus === "connected" ? "已完成 OAuth 登录" : "开始 OAuth 登录"}
                    </Button>
                    <Badge
                      variant={
                        loginStatus === "connected"
                          ? "success"
                          : loginStatus === "running"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {loginStatus === "connected"
                        ? "已连接"
                        : loginStatus === "running"
                          ? "连接中"
                          : "未登录"}
                    </Badge>
                  </div>
                  {primaryInsight.oauthNote ? (
                    <p className="mt-4 text-sm leading-6 text-muted-foreground">
                      {primaryInsight.oauthNote}
                    </p>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>回退模型与部署选项</CardTitle>
              <CardDescription>回退模型默认关闭，启用后再展开选择器。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => toggleFallback(false)}
                  variant={!config.fallbackEnabled ? "default" : "outline"}
                >
                  <CircleDashed className="size-4" />
                  不启用回退模型
                </Button>
                <Button
                  onClick={() => toggleFallback(true)}
                  variant={config.fallbackEnabled ? "default" : "outline"}
                >
                  <CheckCircle2 className="size-4" />
                  启用回退模型
                </Button>
              </div>

              {config.fallbackEnabled ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <SelectMenu
                    label="回退模型公司"
                    onChange={changeFallbackProvider}
                    options={fallbackProviderOptions}
                    value={config.fallbackProviderId}
                  />
                  <SelectMenu
                    emptyLabel="当前公司没有可用回退模型"
                    label="回退模型"
                    onChange={(value) => updateConfig({ fallbackModelRef: value })}
                    options={fallbackModelOptions}
                    value={config.fallbackModelRef}
                  />
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium">安装目录</span>
                  <input
                    className={inputClassName()}
                    onChange={(event) => updateConfig({ installDir: event.target.value })}
                    value={config.installDir}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">工作区目录</span>
                  <input
                    className={inputClassName()}
                    onChange={(event) => updateConfig({ workspaceDir: event.target.value })}
                    value={config.workspaceDir}
                  />
                </label>
              </div>

              <div>
                <p className="text-sm font-medium">日志等级</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {logLevels.map((level) => (
                    <Button
                      key={level.id}
                      onClick={() => updateConfig({ logLevel: level.id })}
                      variant={config.logLevel === level.id ? "default" : "outline"}
                    >
                      {level.title}
                    </Button>
                  ))}
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {logLevels.find((level) => level.id === config.logLevel)?.hint}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {[
                  {
                    key: "autoStartGateway" as const,
                    title: "Gateway 自启动",
                    detail: "部署完成后直接进入可用状态。",
                  },
                  {
                    key: "createDesktopShortcut" as const,
                    title: "创建桌面入口",
                    detail: "给非技术用户更直接的打开方式。",
                  },
                  {
                    key: "writeExampleRecipe" as const,
                    title: "写入示例配方",
                    detail: "方便后续切到按配方部署继续演示。",
                  },
                ].map((item) => {
                  const enabled = config[item.key];
                  return (
                    <button
                      key={item.key}
                      className={cn(
                        "rounded-[24px] border px-4 py-4 text-left transition-colors",
                        enabled
                          ? "border-primary/30 bg-primary/10"
                          : "border-border/70 bg-background/40 hover:bg-foreground/5",
                      )}
                      onClick={() => updateConfig({ [item.key]: !enabled } as Partial<DeployConfig>)}
                      type="button"
                    >
                      <p className="font-semibold">{item.title}</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>阶段时间线</CardTitle>
              <CardDescription>日志模块已经移除，只保留部署阶段和当前状态。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {stagePlan.map((stage, index) => {
                const status =
                  activeStageIndex > index
                    ? "done"
                    : activeStageIndex === index && running
                      ? "active"
                      : activeStageIndex >= stagePlan.length
                        ? "done"
                        : "pending";

                return (
                  <div
                    key={stage.id}
                    className={cn(
                      "rounded-2xl border px-4 py-4 transition-colors",
                      status === "done"
                        ? "border-success/20 bg-success/8"
                        : status === "active"
                          ? "border-primary/20 bg-primary/8"
                          : "border-border/70 bg-background/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">
                        {String(index + 1).padStart(2, "0")} · {stage.title}
                      </p>
                      <Badge
                        variant={
                          status === "done" ? "success" : status === "active" ? "info" : "neutral"
                        }
                      >
                        {status === "done" ? "完成" : status === "active" ? "进行中" : "等待中"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{stage.detail}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>方案解读</CardTitle>
              <CardDescription>这一版把流程顺序彻底改成“先装 OpenClaw，再部署”。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="flex items-start gap-3 rounded-2xl border border-border/70 px-4 py-3">
                <PackagePlus className="mt-0.5 size-4 text-success" />
                <p>安装前只显示 OpenClaw 安装页，避免用户在缺少 CLI 的情况下误选模型。</p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-border/70 px-4 py-3">
                <Sparkles className="mt-0.5 size-4 text-primary" />
                <p>模型公司和模型列表都改成通过 `openclaw models list --all --json` 动态读取。</p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-border/70 px-4 py-3">
                <LockOpen className="mt-0.5 size-4 text-primary" />
                <p>只有 CLI 返回支持登录的模型时，页面才会显示 `OAuth 登录` 按钮。</p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-border/70 px-4 py-3">
                <ShieldCheck className="mt-0.5 size-4 text-primary" />
                <p>下拉菜单已经完全去掉右侧标签，视觉上只保留名称、说明和选中状态。</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {configModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="w-full max-w-4xl rounded-[32px] border border-border/70 bg-background shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-border/70 px-6 py-5">
              <div>
                <p className="text-sm text-muted-foreground">完整配置</p>
                <h4 className="text-xl font-semibold">当前部署预览</h4>
              </div>
              <Button onClick={() => setConfigModalOpen(false)} size="icon" variant="ghost">
                <X className="size-4" />
              </Button>
            </div>
            <div className="p-6">
              <pre className="max-h-[70vh] overflow-auto rounded-[24px] bg-foreground/6 p-5 font-mono text-xs leading-6 text-muted-foreground">
                {preview}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
