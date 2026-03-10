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
  TerminalSquare,
  Waypoints,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useWorkbenchSettings } from "@/components/app/app-settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyOpenClawDeploy,
  checkOpenClawAuth,
  fetchOpenClawCatalog,
  installOpenClaw,
  isTauriRuntime,
  launchOpenClawAuth,
  openExternalUrl,
  registerOpenClawScanDir,
} from "@/lib/tauri";
import type {
  DeployAuthMode,
  OpenClawCatalog,
  OpenClawProviderCatalog,
  OpenClawProviderModel,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type PlanId = "quickstart" | "custom";
type CatalogState = "loading" | "ready" | "error";
type LoginStatus = "idle" | "running" | "connected";
type LogLevel = "info" | "debug" | "warn";

interface PlanDefinition {
  id: PlanId;
  title: string;
  badge: string;
  tone: "success" | "warning" | "neutral";
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

const providerLoginTransitions: Partial<Record<string, { login?: string[]; api?: string[] }>> = {
  openai: { login: ["openai-codex"] },
  "openai-codex": { api: ["openai"] },
  google: { login: ["google-antigravity", "google-gemini-cli"] },
  "google-antigravity": { api: ["google"] },
  "google-gemini-cli": { api: ["google"] },
  minimax: { login: ["minimax-portal"] },
  "minimax-cn": { login: ["minimax-portal"] },
  "minimax-portal": { api: ["minimax", "minimax-cn"] },
  qwen: { login: ["qwen-portal"] },
  "qwen-portal": { api: ["qwen"] },
};

interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface DeployConfig {
  planId: PlanId;
  primaryProviderId: string;
  primaryProviderRouteId: string;
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

const plans: PlanDefinition[] = [
  {
    id: "quickstart",
    title: "快速体验",
    badge: "免费 · 快速",
    tone: "success",
    summary: "先安装 OpenClaw，再从 CLI 读取可用 provider 和模型，优先走免费额度或低门槛路线。",
    detail: "主推 Z.AI / GLM 与 MiniMax。安装完成前，不允许直接开始部署。",
    preferredProviders: ["zai", "minimax"],
    preferredModels: ["zai/glm-4.7", "zai/glm-5", "minimax/MiniMax-M2.5"],
  },
  {
    id: "custom",
    title: "自定义",
    badge: "可能付费 · 稳定",
    tone: "warning",
    summary: "默认偏向更稳定的官方模型入口，也允许你继续手动改下面的配置。",
    detail: "主推 OpenAI Codex OAuth 与 Anthropic；改动模型、授权或部署选项后仍然归到自定义。",
    preferredProviders: ["openai-codex", "anthropic", "openai"],
    preferredModels: [
      "openai-codex/gpt-5.3-codex",
      "openai-codex/gpt-5.4",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5.4",
    ],
  },
];

const providerInsights: Record<string, ProviderInsight> = {
  zai: {
    title: "Z.AI / GLM",
    summary: "GLM 通过 Z.AI API Key 接入；这里单独暴露国内 / 国际线路。",
    primaryLabel: "申请智谱免费 API",
    primaryUrl: "https://open.bigmodel.cn/console/trialcenter",
    secondaryLabel: "查看 Z.AI 文档",
    secondaryUrl: "https://docs.openclaw.ai/providers/zai",
    apiEnv: "ZAI_API_KEY",
  },
  minimax: {
    title: "MiniMax Global",
    summary: "Global 站点。OpenClaw 里还有对应的 `minimax-cn` 线路，会单独显示出来。",
    primaryLabel: "申请 MiniMax 免费额度",
    primaryUrl: "https://www.minimax.io/pricing",
    secondaryLabel: "查看 MiniMax 文档",
    secondaryUrl: "https://docs.openclaw.ai/providers/minimax",
    apiEnv: "MINIMAX_API_KEY",
  },
  "minimax-cn": {
    title: "MiniMax CN",
    summary: "国内线路，对应 OpenClaw 的 `minimax-cn/...` 模型引用。",
    primaryLabel: "申请 MiniMax 国内额度",
    primaryUrl: "https://www.minimaxi.com/",
    secondaryLabel: "查看 MiniMax 文档",
    secondaryUrl: "https://docs.openclaw.ai/providers/minimax",
    apiEnv: "MINIMAX_API_KEY",
  },
  moonshot: {
    title: "Moonshot / Kimi",
    summary: "Moonshot 当前走 API Key；再按站点区分 Global / CN。",
    primaryLabel: "查看 Moonshot 定价",
    primaryUrl: "https://platform.moonshot.ai/docs/pricing/chat",
    secondaryLabel: "查看 Moonshot 文档",
    secondaryUrl: "https://docs.openclaw.ai/concepts/model-providers",
    apiEnv: "MOONSHOT_API_KEY",
  },
  openai: {
    title: "OpenAI",
    summary: "稳定部署默认推荐项。这里走标准 OpenAI API Key。",
    primaryLabel: "查看 OpenAI 定价",
    primaryUrl: "https://openai.com/api/pricing/",
    secondaryLabel: "查看 OpenAI 文档",
    secondaryUrl: "https://docs.openclaw.ai/providers/openai",
    apiEnv: "OPENAI_API_KEY",
  },
  "openai-codex": {
    title: "OpenAI Codex",
    summary: "走 OpenAI Codex OAuth。部署时会写入 `openai-codex/...` 模型，而不是普通 `openai/...`。",
    primaryLabel: "查看 Codex OAuth 文档",
    primaryUrl: "https://openai.com/chatgpt/download/",
    secondaryLabel: "查看 OpenAI 文档",
    secondaryUrl: "https://docs.openclaw.ai/providers/openai",
    oauthLabel: "Codex OAuth",
    oauthCommand: "openclaw models auth login --provider openai-codex",
  },
  anthropic: {
    title: "Anthropic",
    summary: "Anthropic 官方推荐 API Key；订阅用户则用 Claude setup-token。",
    primaryLabel: "查看 Claude 定价",
    primaryUrl: "https://platform.claude.com/docs/zh-CN/about-claude/pricing",
    secondaryLabel: "查看 Anthropic 文档",
    secondaryUrl: "https://docs.openclaw.ai/providers/anthropic",
    apiEnv: "ANTHROPIC_API_KEY",
    oauthLabel: "Setup-token",
    oauthCommand: "openclaw models auth setup-token --provider anthropic",
    oauthNote: "Anthropic 实际会走 setup-token：如果终端提示你先运行 `claude setup-token`，按提示复制 token 再粘贴回来。",
  },
  google: {
    title: "Google Gemini",
    summary: "标准 `google/...` 走 Gemini API Key；Google 账号登录要切到 `google-antigravity` 或 `google-gemini-cli`。",
    primaryLabel: "申请 Gemini API Key",
    primaryUrl: "https://ai.google.dev/gemini-api/docs/api-key",
    secondaryLabel: "查看 Google Provider 文档",
    secondaryUrl: "https://docs.openclaw.ai/concepts/model-providers",
    apiEnv: "GOOGLE_API_KEY",
  },
  "google-antigravity": {
    title: "Google Antigravity",
    summary: "这是 Google 账号登录路线，不用 API Key；先启用插件，再走浏览器账号授权。",
    primaryLabel: "查看 Antigravity 文档",
    primaryUrl: "https://docs.openclaw.ai/concepts/model-providers",
    secondaryLabel: "查看插件列表",
    secondaryUrl: "https://docs.openclaw.ai/plugins",
    oauthLabel: "Google 账号登录",
    oauthCommand:
      "openclaw plugins enable google-antigravity-auth && openclaw models auth login --provider google-antigravity --set-default",
    oauthNote: "Antigravity 是单独 provider，不是 `google/...` 的 API Key 模式。授权完成后会把 token 写进 OpenClaw 的 auth profiles。",
  },
  "google-gemini-cli": {
    title: "Google Gemini CLI",
    summary: "这条路线复用 Gemini CLI / Google 账号登录，不需要把 client id 或 secret 手工写进配置。",
    primaryLabel: "查看 Gemini CLI 文档",
    primaryUrl: "https://docs.openclaw.ai/concepts/model-providers",
    secondaryLabel: "查看 Gemini CLI 官方站",
    secondaryUrl: "https://geminicli.com/",
    oauthLabel: "Gemini CLI 登录",
    oauthCommand:
      "openclaw plugins enable google-gemini-cli-auth && openclaw models auth login --provider google-gemini-cli --set-default",
    oauthNote: "Gemini CLI 登录会把 token 存进 OpenClaw 的 auth profiles，不需要额外 API Key。",
  },
  "google-vertex": {
    title: "Google Vertex",
    summary: "Vertex 不是 API Key / OAuth 二选一，而是走 Google Cloud ADC（`gcloud auth application-default login`）。",
    primaryLabel: "查看 Vertex 文档",
    primaryUrl: "https://docs.openclaw.ai/concepts/model-providers",
    secondaryLabel: "查看 Google Cloud ADC",
    secondaryUrl: "https://cloud.google.com/docs/authentication/provide-credentials-adc",
  },
  "minimax-portal": {
    title: "MiniMax OAuth",
    summary: "MiniMax Coding Plan 支持 OAuth 订阅授权；按地域仍然区分 Global / CN 端点。",
    primaryLabel: "查看 MiniMax OpenClaw 指南",
    primaryUrl: "https://platform.minimax.io/docs/coding-plan/openclaw",
    secondaryLabel: "查看 MiniMax 文档",
    secondaryUrl: "https://docs.openclaw.ai/minimax/",
    oauthLabel: "MiniMax OAuth",
    oauthCommand:
      "openclaw plugins enable minimax-portal-auth && openclaw onboard --auth-choice minimax-portal",
    oauthNote: "如果 Gateway 已在运行，按官方文档需要重启后再使用 MiniMax OAuth。",
  },
  qwen: {
    title: "Qwen",
    summary: "Qwen 账号登录不是普通 API Key 路线，而是切到 `qwen-portal` provider 做设备码 OAuth。",
    primaryLabel: "查看 Qwen 文档",
    primaryUrl: "https://docs.openclaw.ai/providers/qwen",
    secondaryLabel: "查看模型提供商总览",
    secondaryUrl: "https://docs.openclaw.ai/concepts/model-providers",
    apiEnv: "DASHSCOPE_API_KEY",
  },
  "qwen-portal": {
    title: "Qwen OAuth",
    summary: "Qwen Portal 提供设备码 OAuth，可复用 Qwen Code CLI 已有登录。",
    primaryLabel: "查看 Qwen 文档",
    primaryUrl: "https://docs.openclaw.ai/providers/qwen",
    secondaryLabel: "查看插件列表",
    secondaryUrl: "https://docs.openclaw.ai/plugins",
    oauthLabel: "Qwen OAuth",
    oauthCommand:
      "openclaw plugins enable qwen-portal-auth && openclaw models auth login --provider qwen-portal --set-default",
    oauthNote: "如果你已经登录过 Qwen Code CLI，OpenClaw 会同步已有凭据；首次仍建议先跑一次登录命令创建 provider 条目。",
  },
};

const providerRouteOptionsByProvider: Record<string, SelectOption[]> = {
  zai: [
    {
      value: "cn",
      label: "BigModel CN",
      hint: "open.bigmodel.cn · 智谱国内站",
    },
    {
      value: "global",
      label: "Z.AI Global",
      hint: "api.z.ai · 国际站",
    },
  ],
  moonshot: [
    {
      value: "global",
      label: "Moonshot Global",
      hint: "api.moonshot.ai",
    },
    {
      value: "cn",
      label: "Moonshot CN",
      hint: "api.moonshot.cn",
    },
  ],
};

const logLevels: Array<{ id: LogLevel; title: string; hint: string }> = [
  { id: "info", title: "Info", hint: "适合大多数部署日志。" },
  { id: "debug", title: "Debug", hint: "记录更详细，适合排查接入问题。" },
  { id: "warn", title: "Warn", hint: "只保留关键告警，适合长期运行。" },
];

function buildPlanConfig(planId: PlanId): DeployConfig {
  if (planId === "custom") {
    return {
      planId,
      primaryProviderId: "",
      primaryProviderRouteId: "",
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
    primaryProviderRouteId: "",
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
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const empty = options.length === 0;

  useEffect(() => {
    if (empty) {
      setOpen(false);
    }
  }, [empty]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }

    function updateMenuPosition() {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const safeGap = 16;
      const rect = trigger.getBoundingClientRect();
      const boundaryRect =
        rootRef.current
          ?.closest<HTMLElement>("[data-select-boundary]")
          ?.getBoundingClientRect() ?? null;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const upperBoundary = Math.max(safeGap, boundaryRect?.top ?? safeGap);
      const lowerBoundary = Math.min(
        viewportHeight - safeGap,
        boundaryRect ? boundaryRect.bottom - safeGap : viewportHeight - safeGap,
      );
      const estimatedHeight = Math.min(Math.max(options.length, 1) * 60 + 12, 272);
      const spaceBelow = Math.max(0, lowerBoundary - rect.bottom);
      const spaceAbove = Math.max(0, rect.top - upperBoundary);
      const renderAbove = spaceBelow < Math.min(estimatedHeight, 176) && spaceAbove > spaceBelow;
      const width = Math.min(rect.width, viewportWidth - safeGap * 2);
      const left = Math.min(Math.max(rect.left, safeGap), viewportWidth - width - safeGap);
      const maxHeight = Math.min(272, Math.max(0, (renderAbove ? spaceAbove : spaceBelow) - 8));
      if (maxHeight <= 0) {
        setMenuStyle(null);
        return;
      }
      const top = renderAbove
        ? Math.max(upperBoundary, rect.top - maxHeight - 8)
        : Math.min(rect.bottom + 8, lowerBoundary - maxHeight);

      setMenuStyle({
        left,
        maxHeight,
        position: "fixed",
        top,
        width,
        zIndex: 70,
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
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

  return (
    <div className="relative" ref={rootRef}>
      <span className="text-sm font-medium">{label}</span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={optionTriggerClassName(open)}
        disabled={empty}
        ref={triggerRef}
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

      {open && menuStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              className="overflow-hidden rounded-[24px] border border-border/70 bg-background/98 shadow-[0_24px_80px_-24px_rgba(15,23,42,0.42)] backdrop-blur"
              ref={menuRef}
              role="listbox"
              style={menuStyle}
            >
              <div className="overflow-auto p-2" style={{ maxHeight: menuStyle.maxHeight }}>
                {options.map((option) => {
                  const active = option.value === value;
                  return (
                    <button
                      aria-selected={active}
                      className={cn(
                        "flex w-full cursor-pointer items-start justify-between gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                        active ? "bg-primary/10 text-foreground" : "hover:bg-foreground/5",
                      )}
                      key={option.value}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      role="option"
                      type="button"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{option.label}</p>
                        {option.hint ? (
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {option.hint}
                          </p>
                        ) : null}
                      </div>
                      {active ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function openExternalLink(url: string) {
  void openExternalUrl(url);
}

function DeployRefreshingView() {
  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="grid gap-0 p-0 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="border-b border-border/70 p-6 xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="info">OpenClaw · 一键部署</Badge>
              <Badge variant="neutral">后台刷新中</Badge>
            </div>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight">已进入部署页，正在读取本机配置</h3>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              正在刷新 OpenClaw 安装状态、provider 列表和模型列表。结果出来后会在当前页面直接更新。
            </p>
          </div>

          <div className="space-y-4 p-6">
            <div className="rounded-[28px] border border-border/70 bg-foreground/5 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">当前状态</p>
                <LoaderCircle className="size-4 animate-spin text-primary" />
              </div>
              <p className="mt-2 text-2xl font-semibold">刷新中</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                首次进入页面时不再等扫描完成，后台刷新完成后会自动切到可操作状态。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
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

function splitModelRef(modelRef: string) {
  const separatorIndex = modelRef.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex >= modelRef.length - 1) {
    return null;
  }

  return {
    providerId: modelRef.slice(0, separatorIndex),
    modelId: modelRef.slice(separatorIndex + 1),
  };
}

function findTransitionModelForProviders(
  catalog: OpenClawCatalog | null,
  modelRef: string,
  targetProviderIds: string[],
) {
  const parts = splitModelRef(modelRef);
  if (parts) {
    for (const targetProviderId of targetProviderIds) {
      const exactMatch = getModel(catalog, `${targetProviderId}/${parts.modelId}`);
      if (exactMatch) {
        return exactMatch;
      }
    }
  }

  for (const targetProviderId of targetProviderIds) {
    const provider = getProvider(catalog, targetProviderId);
    if (provider?.models[0]) {
      return { provider, model: provider.models[0] };
    }
  }

  return null;
}

function resolveSelectionForAuthMode(
  catalog: OpenClawCatalog | null,
  selection: { provider: OpenClawProviderCatalog; model: OpenClawProviderModel } | null,
  authMode: DeployAuthMode,
) {
  if (!selection) {
    return null;
  }

  const transitions = providerLoginTransitions[selection.provider.id];

  if (authMode === "login" && transitions?.login?.length) {
    return findTransitionModelForProviders(catalog, selection.model.ref, transitions.login) ?? selection;
  }

  if (authMode === "api" && transitions?.api?.length) {
    return findTransitionModelForProviders(catalog, selection.model.ref, transitions.api) ?? selection;
  }

  return selection;
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

function buildProviderRouteOptions(providerId: string) {
  return providerRouteOptionsByProvider[providerId] ?? [];
}

function defaultProviderRouteId(providerId: string) {
  return buildProviderRouteOptions(providerId)[0]?.value ?? "";
}

function resolveProviderRouteLabel(providerId: string, routeId: string) {
  return buildProviderRouteOptions(providerId).find((option) => option.value === routeId)?.label ?? "默认";
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
  const primary =
    resolveSelectionForAuthMode(catalog, getModel(catalog, config.primaryModelRef), config.authMode) ??
    getModel(catalog, config.primaryModelRef);
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
          primary: primary?.model.ref ?? config.primaryModelRef,
          fallbacks: fallback ? [fallback.model.ref] : [],
        },
      },
    },
    extras: {
      desktopShortcut: config.createDesktopShortcut,
      exampleRecipe: config.writeExampleRecipe,
      providerRoute: config.primaryProviderRouteId || undefined,
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

function InstallOpenClawView({
  catalog,
  refreshing,
  installing,
  savingScanPath,
  message,
  error,
  manualScanPath,
  scanPaths,
  onInstall,
  onManualScanPathChange,
  onSaveScanPath,
  onRefresh,
}: {
  catalog: OpenClawCatalog | null;
  refreshing: boolean;
  installing: boolean;
  savingScanPath: boolean;
  message: string | null;
  error: string | null;
  manualScanPath: string;
  scanPaths: string[];
  onInstall: () => void;
  onManualScanPathChange: (value: string) => void;
  onSaveScanPath: () => void;
  onRefresh: () => void;
}) {
  const primaryScanPath = scanPaths[0] ?? null;
  const scanPathPlaceholder = primaryScanPath
    ? `例如 ${primaryScanPath} 或 /Users/mac/custom/openclaw/bin`
    : "例如 /Users/mac/.openclaw/bin 或 /Users/mac/custom/openclaw/bin";

  return (
    <section className="space-y-6">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="grid gap-0 p-0 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="border-b border-border/70 p-6 xl:border-b-0 xl:border-r">
            <Badge variant="info">OpenClaw · 一键部署</Badge>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight">先安装 OpenClaw，才能继续部署</h3>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              安装完成后，这一页会直接从本机 OpenClaw 读取可用的 provider、模型和授权方式，再生成部署配置。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button disabled={installing} onClick={onInstall}>
                {installing ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <PackagePlus className="size-4" />
                )}
                {installing ? "安装脚本已拉起" : "安装 OpenClaw"}
              </Button>
              <Button disabled={refreshing} onClick={onRefresh} variant="outline">
                {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                重新检测
              </Button>
            </div>
          </div>

          <div className="space-y-4 p-6">
            <div className="rounded-[28px] border border-border/70 bg-foreground/5 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">当前状态</p>
                {refreshing ? <Badge variant="info">后台刷新中</Badge> : null}
              </div>
              <p className="mt-2 text-2xl font-semibold">
                {catalog?.installed ? "已安装" : catalog ? "未安装" : "检测中"}
              </p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {message ?? catalog?.message ?? "安装完成后，点击重新检测继续。"}
              </p>
            </div>

            <div className="rounded-[28px] border border-border/70 bg-background/80 p-5">
              <p className="text-sm font-medium">安装说明</p>
              <div className="mt-4 text-sm leading-6 text-muted-foreground">
                <div className="rounded-2xl border border-border/70 px-4 py-3">
                  安装完成后点击“重新检测”，即可进入部署配置。
                  {primaryScanPath ? (
                    <>
                      当前默认检测目录是 <span className="font-mono text-foreground">{primaryScanPath}</span>。
                    </>
                  ) : (
                    <> 默认会优先检测当前用户目录下的 `.openclaw/bin`。</>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-border/70 bg-background/80 p-5">
              <p className="text-sm font-medium">扫描目录</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {scanPaths.length > 0 ? (
                  scanPaths.map((path) => (
                    <span
                      key={path}
                      className="rounded-full border border-border/70 bg-foreground/4 px-3 py-1 text-xs text-muted-foreground"
                    >
                      {path}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border border-dashed border-border/70 px-3 py-1 text-xs text-muted-foreground">
                    自动检测中
                  </span>
                )}
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                安装 OpenClaw 时会自动登记默认目录；如果你用了自定义安装位置，也可以在这里手动指定目录。
              </p>
              <input
                className={inputClassName()}
                onChange={(event) => onManualScanPathChange(event.target.value)}
                placeholder={scanPathPlaceholder}
                type="text"
                value={manualScanPath}
              />
              <div className="mt-3">
                <Button
                  disabled={savingScanPath || manualScanPath.trim().length === 0}
                  onClick={onSaveScanPath}
                  variant="outline"
                >
                  {savingScanPath ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <FolderCog className="size-4" />
                  )}
                  {savingScanPath ? "保存中" : "保存目录并重新检测"}
                </Button>
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
  const [savingScanPath, setSavingScanPath] = useState(false);
  const [manualScanPath, setManualScanPath] = useState("");
  const [scanPaths, setScanPaths] = useState<string[]>([]);
  const [config, setConfig] = useState<DeployConfig>(() => buildPlanConfig("quickstart"));
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [loginStatus, setLoginStatus] = useState<LoginStatus>("idle");
  const [loginLaunching, setLoginLaunching] = useState(false);
  const [loginChecking, setLoginChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [deployApplied, setDeployApplied] = useState(false);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  async function refreshCatalog(nextMessage?: string) {
    setError(null);
    setCatalogState("loading");

    try {
      const result = await fetchOpenClawCatalog();
      setCatalog(result);
      setScanPaths(result.scanPaths);
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
    if (!catalog?.installed || catalog.providers.length === 0) {
      return;
    }

    const selectedProvider =
      getProvider(catalog, config.primaryProviderId) ?? pickInitialProvider(catalog, config.planId);
    if (!selectedProvider) {
      return;
    }

    const selectedModel =
      selectedProvider.models.find((item) => item.ref === config.primaryModelRef) ??
      pickInitialModel(selectedProvider, config.planId);
    if (!selectedModel) {
      return;
    }

    const resolvedPrimary =
      resolveSelectionForAuthMode(catalog, { provider: selectedProvider, model: selectedModel }, config.authMode) ??
      { provider: selectedProvider, model: selectedModel };
    const nextAuthMode = resolvedPrimary.model.authModes.includes(config.authMode)
      ? config.authMode
      : resolvedPrimary.model.authModes[0];
    const nextPrimaryRouteId = buildProviderRouteOptions(resolvedPrimary.provider.id).some(
      (option) => option.value === config.primaryProviderRouteId,
    )
      ? config.primaryProviderRouteId
      : defaultProviderRouteId(resolvedPrimary.provider.id);
    const nextFallbackProviderId = config.fallbackProviderId || resolvedPrimary.provider.id;
    const nextFallbackModel = config.fallbackEnabled
      ? getProvider(catalog, nextFallbackProviderId)?.models.find(
          (item) => item.ref === config.fallbackModelRef && item.ref !== resolvedPrimary.model.ref,
        ) ??
        getProvider(catalog, nextFallbackProviderId)?.models.find((item) => item.ref !== resolvedPrimary.model.ref) ??
        null
      : null;

    if (
      config.primaryProviderId !== resolvedPrimary.provider.id ||
      config.primaryProviderRouteId !== nextPrimaryRouteId ||
      config.primaryModelRef !== resolvedPrimary.model.ref ||
      config.authMode !== nextAuthMode ||
      (config.fallbackEnabled && config.fallbackModelRef !== (nextFallbackModel?.ref ?? ""))
    ) {
      setConfig((current) => ({
        ...current,
        primaryProviderId: resolvedPrimary.provider.id,
        primaryProviderRouteId: nextPrimaryRouteId,
        primaryModelRef: resolvedPrimary.model.ref,
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
    config.primaryProviderRouteId,
  ]);

  const activePlan = plans.find((plan) => plan.id === config.planId) ?? plans[0];
  const effectivePrimary =
    resolveSelectionForAuthMode(catalog, getModel(catalog, config.primaryModelRef), config.authMode) ??
    getModel(catalog, config.primaryModelRef);
  const loginPrimary =
    resolveSelectionForAuthMode(catalog, getModel(catalog, config.primaryModelRef), "login") ??
    null;
  const supportsProviderLogin = Boolean(loginPrimary?.model.authModes.includes("login"));
  const primaryProvider = effectivePrimary?.provider ?? getProvider(catalog, config.primaryProviderId);
  const primaryModel = effectivePrimary?.model ?? null;
  const primaryInsight = getProviderInsight(primaryProvider?.id ?? config.primaryProviderId);
  const loginInsight = getProviderInsight(loginPrimary?.provider.id ?? "");
  const loginActionLabel = loginInsight.oauthLabel ?? "登录";
  const primaryProviderOptions = buildProviderOptions(catalog);
  const primaryRouteOptions = buildProviderRouteOptions(primaryProvider?.id ?? config.primaryProviderId);
  const primaryRouteLabel = resolveProviderRouteLabel(
    primaryProvider?.id ?? config.primaryProviderId,
    config.primaryProviderRouteId,
  );
  const primaryModelOptions = buildModelOptions(primaryProvider);
  const fallbackProvider = getProvider(catalog, config.fallbackProviderId);
  const fallbackProviderOptions = buildProviderOptions(catalog);
  const fallbackModelOptions = buildModelOptions(fallbackProvider).filter(
    (item) => item.value !== config.primaryModelRef,
  );
  const preview = buildPreview(config, catalog);
  const progressValue = running ? 72 : deployApplied ? 100 : 0;
  const credentialReady =
    config.authMode === "api" ? config.apiSecret.trim().length > 0 : loginStatus === "connected";
  const canStart =
    catalog?.installed &&
    credentialReady &&
    !running &&
    !loginLaunching &&
    !loginChecking &&
    Boolean(config.primaryModelRef);

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

  async function handleSaveScanPath() {
    setSavingScanPath(true);
    setError(null);

    try {
      const result = await registerOpenClawScanDir(manualScanPath);
      setScanPaths(result.scanPaths);
      setStatusMessage(result.message);
      setManualScanPath("");
      await refreshCatalog(result.message);
    } catch (scanPathError) {
      setError(
        scanPathError instanceof Error
          ? scanPathError.message
          : "保存 OpenClaw 扫描目录失败，请稍后重试。",
      );
    } finally {
      setSavingScanPath(false);
    }
  }

  function applyPlan(planId: PlanId) {
    setConfig((current) => ({
      ...buildPlanConfig(planId),
      installDir: current.installDir,
      workspaceDir: current.workspaceDir,
    }));
    setLoginStatus("idle");
    setRunning(false);
    setDeployApplied(false);
    setLastSummary(`已切换到 ${plans.find((plan) => plan.id === planId)?.title ?? planId}。`);
  }

  function updateConfig(patch: Partial<DeployConfig>) {
    setDeployApplied(false);
    setConfig((current) => ({
      ...current,
      ...patch,
      planId: "planId" in patch ? (patch.planId ?? current.planId) : "custom",
    }));
  }

  function changePrimaryProvider(providerId: string) {
    const nextProvider = getProvider(catalog, providerId);
    const nextModel = pickInitialModel(nextProvider, config.planId);
    if (!nextProvider || !nextModel) {
      return;
    }

    const resolvedPrimary =
      resolveSelectionForAuthMode(catalog, { provider: nextProvider, model: nextModel }, config.authMode) ??
      { provider: nextProvider, model: nextModel };
    const nextAuthMode = resolvedPrimary.model.authModes.includes(config.authMode)
      ? config.authMode
      : resolvedPrimary.model.authModes[0];

    updateConfig({
      primaryProviderId: resolvedPrimary.provider.id,
      primaryProviderRouteId: defaultProviderRouteId(resolvedPrimary.provider.id),
      primaryModelRef: resolvedPrimary.model.ref,
      authMode: nextAuthMode,
      apiSecret: "",
      fallbackModelRef: config.fallbackModelRef === resolvedPrimary.model.ref ? "" : config.fallbackModelRef,
    });
    setLoginStatus(nextAuthMode === "login" ? loginStatus : "idle");
    setLastSummary(`主模型公司已切到 ${resolvedPrimary.provider.title}。`);
  }

  function changePrimaryModel(modelRef: string) {
    const next = getModel(catalog, modelRef);
    if (!next) {
      return;
    }

    const resolvedPrimary =
      resolveSelectionForAuthMode(catalog, next, config.authMode) ??
      next;
    const nextAuthMode = resolvedPrimary.model.authModes.includes(config.authMode)
      ? config.authMode
      : resolvedPrimary.model.authModes[0];

    updateConfig({
      primaryProviderId: resolvedPrimary.provider.id,
      primaryProviderRouteId: buildProviderRouteOptions(resolvedPrimary.provider.id).some(
        (option) => option.value === config.primaryProviderRouteId,
      )
        ? config.primaryProviderRouteId
        : defaultProviderRouteId(resolvedPrimary.provider.id),
      primaryModelRef: resolvedPrimary.model.ref,
      authMode: nextAuthMode,
      apiSecret: "",
      fallbackModelRef: config.fallbackModelRef === resolvedPrimary.model.ref ? "" : config.fallbackModelRef,
    });
    setLoginStatus(nextAuthMode === "login" ? loginStatus : "idle");
    setLastSummary(`主模型已切到 ${resolvedPrimary.model.ref}。`);
  }

  function setAuthMode(mode: DeployAuthMode) {
    const resolvedPrimary =
      resolveSelectionForAuthMode(catalog, getModel(catalog, config.primaryModelRef), mode) ??
      getModel(catalog, config.primaryModelRef);
    const nextAuthMode = resolvedPrimary?.model.authModes.includes(mode)
      ? mode
      : resolvedPrimary?.model.authModes[0] ?? "api";

    updateConfig({
      authMode: nextAuthMode,
      apiSecret: "",
      primaryProviderId: resolvedPrimary?.provider.id ?? config.primaryProviderId,
      primaryProviderRouteId: resolvedPrimary?.provider
        ? buildProviderRouteOptions(resolvedPrimary.provider.id).some(
            (option) => option.value === config.primaryProviderRouteId,
          )
          ? config.primaryProviderRouteId
          : defaultProviderRouteId(resolvedPrimary.provider.id)
        : config.primaryProviderRouteId,
      primaryModelRef: resolvedPrimary?.model.ref ?? config.primaryModelRef,
    });
    setLoginStatus("idle");
    setLastSummary(
      nextAuthMode === "login"
        ? `已切换到 ${loginActionLabel}${resolvedPrimary ? `，主模型改为 ${resolvedPrimary.model.ref}` : ""}。`
        : mode === "login"
          ? "当前模型不支持登录授权，已保留 API Key 模式。"
          : "已切换到 API Key。",
    );
  }

  function changePrimaryProviderRoute(routeId: string) {
    updateConfig({ primaryProviderRouteId: routeId });
    setLastSummary(`当前接入路线已切到 ${resolveProviderRouteLabel(config.primaryProviderId, routeId)}。`);
  }

  async function startLoginFlow() {
    if (!primaryModel?.supportsLogin || config.authMode !== "login" || running || loginLaunching) {
      return;
    }

    setLoginLaunching(true);
    setError(null);

    try {
      const result = await launchOpenClawAuth(primaryProvider?.id ?? config.primaryProviderId);
      setLoginStatus("running");
      setLastSummary(result.message);
    } catch (loginError) {
      setLoginStatus("idle");
      setError(
        loginError instanceof Error ? loginError.message : `拉起${loginActionLabel}失败，请稍后重试。`,
      );
    } finally {
      setLoginLaunching(false);
    }
  }

  async function verifyLoginFlow() {
    if (config.authMode !== "login" || loginChecking) {
      return;
    }

    setLoginChecking(true);
    setError(null);

    try {
      const result = await checkOpenClawAuth(primaryProvider?.id ?? config.primaryProviderId);
      setLoginStatus(result.connected ? "connected" : "running");
      setLastSummary(result.message);
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : `检查${loginActionLabel}状态失败，请稍后重试。`,
      );
    } finally {
      setLoginChecking(false);
    }
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

  async function startDeployment() {
    if (!canStart || running) {
      return;
    }

    setRunning(true);
    setDeployApplied(false);
    setError(null);
    setLastSummary(`正在应用 ${activePlan.title} 配置…`);

    try {
      const deployPrimary = effectivePrimary ?? getModel(catalog, config.primaryModelRef);
      const result = await applyOpenClawDeploy({
        primaryProviderId: deployPrimary?.provider.id ?? config.primaryProviderId,
        primaryProviderRouteId: config.primaryProviderRouteId,
        primaryModelRef: deployPrimary?.model.ref ?? config.primaryModelRef,
        authMode: config.authMode,
        apiSecret: config.apiSecret,
        fallbackModelRef: config.fallbackEnabled ? config.fallbackModelRef : "",
        autoStartGateway: config.autoStartGateway,
      });
      setDeployApplied(result.applied);
      setLastSummary(result.message);
      await refreshCatalog(result.message);
    } catch (deployError) {
      setError(
        deployError instanceof Error ? deployError.message : "应用部署配置失败，请稍后重试。",
      );
    } finally {
      setRunning(false);
    }
  }

  if (catalogState === "loading" && !catalog) {
    return <DeployRefreshingView />;
  }

  if (!catalog?.installed) {
    return (
      <InstallOpenClawView
        catalog={catalog}
        error={error}
        installing={installingOpenClaw}
        refreshing={catalogState === "loading"}
        manualScanPath={manualScanPath}
        message={statusMessage}
        savingScanPath={savingScanPath}
        scanPaths={scanPaths}
        onInstall={() => {
          void handleInstallOpenClaw();
        }}
        onManualScanPathChange={setManualScanPath}
        onSaveScanPath={() => {
          void handleSaveScanPath();
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
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="info">OpenClaw · 一键部署</Badge>
              {catalogState === "loading" ? <Badge variant="neutral">后台刷新中</Badge> : null}
            </div>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight">OpenClaw 已就绪，现在开始选部署策略</h3>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                disabled={!canStart}
                onClick={() => {
                  void startDeployment();
                }}
              >
                {running ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
                {running ? "部署应用中" : "开始一键部署"}
              </Button>
              <Button
                disabled={catalogState === "loading"}
                onClick={() => {
                  void refreshCatalog("已重新读取 OpenClaw 可用模型列表。");
                }}
                variant="outline"
              >
                {catalogState === "loading" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {catalogState === "loading" ? "刷新中" : "刷新模型列表"}
              </Button>
            </div>

            <p className="mt-6 text-sm text-muted-foreground">
              默认从“快速体验”开始；只要你手动改下面的配置，策略会自动切到右侧“自定义”。
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                    {config.authMode === "login" ? loginActionLabel : "API Key"}
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
                  `完成主模型和授权配置后，开始按钮才会解锁。选 ${loginActionLabel} 时，需要先点一次登录按钮。`}
              </p>
            </div>

          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-[24px] border border-danger/20 bg-danger/10 px-4 py-4 text-sm leading-6">
          {error}
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="min-w-0 space-y-6">
          <Card className="border-border/70">
            <CardHeader className="gap-0 pb-3">
              <CardTitle>主模型</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-0" data-select-boundary>
              <div
                className={cn(
                  "grid gap-4",
                  primaryRouteOptions.length > 0 ? "md:grid-cols-3" : "md:grid-cols-2",
                )}
              >
                <SelectMenu
                  label="模型公司"
                  onChange={changePrimaryProvider}
                  options={primaryProviderOptions}
                  value={config.primaryProviderId}
                />
                {primaryRouteOptions.length > 0 ? (
                  <SelectMenu
                    label="接入路线"
                    onChange={changePrimaryProviderRoute}
                    options={primaryRouteOptions}
                    value={config.primaryProviderRouteId}
                  />
                ) : null}
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
                  {primaryRouteOptions.length > 0 ? (
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      当前接入路线：<span className="font-medium text-foreground">{primaryRouteLabel}</span>
                    </p>
                  ) : null}
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
                当前模型如果存在可用的登录入口，会在这里显示对应的真实登录方式；同一供应商的 API / OAuth / setup-token 会自动切到正确 provider。
              </CardDescription>
            </CardHeader>
            <CardContent className="min-w-0 space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  className="w-full justify-center whitespace-nowrap"
                  onClick={() => setAuthMode("api")}
                  variant={config.authMode === "api" ? "default" : "outline"}
                >
                  <KeyRound className="size-4" />
                  API Key
                </Button>
                {supportsProviderLogin ? (
                  <Button
                    className="w-full justify-center whitespace-nowrap"
                    onClick={() => setAuthMode("login")}
                    variant={config.authMode === "login" ? "default" : "outline"}
                  >
                    <LockOpen className="size-4" />
                    {loginActionLabel}
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
                <div className="min-w-0 rounded-[24px] border border-border/70 bg-foreground/5 p-5">
                  <p className="text-sm font-medium">{loginActionLabel} 已替代 API Key 输入框</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    现在会真实拉起 OpenClaw 的授权命令。浏览器或终端流程完成后，回到这里点一次“检查授权状态”。
                  </p>
                  <div className="mt-4 overflow-x-auto rounded-2xl border border-border/70 bg-background/70 p-4 font-mono text-xs leading-6 text-muted-foreground break-all whitespace-pre-wrap">
                    {primaryInsight.oauthCommand}
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
                    <Button
                      className="w-full justify-center whitespace-nowrap lg:min-w-[176px]"
                      disabled={loginLaunching}
                      onClick={() => {
                        void startLoginFlow();
                      }}
                    >
                      {loginLaunching ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <TerminalSquare className="size-4" />
                      )}
                      {loginStatus === "connected" ? `重新拉起${loginActionLabel}` : `开始${loginActionLabel}`}
                    </Button>
                    <Button
                      className="w-full justify-center whitespace-nowrap lg:min-w-[176px]"
                      disabled={loginLaunching || loginChecking}
                      onClick={() => {
                        void verifyLoginFlow();
                      }}
                      variant="outline"
                    >
                      {loginChecking ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      检查授权状态
                    </Button>
                    <Badge
                      className="justify-self-start"
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
            <CardContent className="space-y-6" data-select-boundary>
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

        <Card className="border-border/70">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>配置预览</CardTitle>
                <CardDescription>固定高度显示，完整配置通过右上角按钮展开。</CardDescription>
              </div>
              <Button onClick={() => setConfigModalOpen(true)} size="sm" variant="outline">
                <Expand className="size-4" />
                显示全部
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="h-[320px] overflow-auto rounded-[24px] bg-foreground/6 p-4 font-mono text-xs leading-6 text-muted-foreground">
              {preview}
            </pre>
          </CardContent>
        </Card>
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
