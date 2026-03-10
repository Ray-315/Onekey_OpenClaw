import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

type DeployAuthMode = "api" | "login";
type OpenClawRuntimeStatus = "running" | "stopped";

interface OpenClawProviderModel {
  id: string;
  title: string;
  ref: string;
  authModes: DeployAuthMode[];
  supportsLogin: boolean;
}

interface OpenClawProviderCatalog {
  id: string;
  title: string;
  summary: string;
  models: OpenClawProviderModel[];
}

interface OpenClawCatalog {
  installed: boolean;
  version?: string | null;
  message: string;
  runtimeStatus: OpenClawRuntimeStatus;
  scanPaths: string[];
  providers: OpenClawProviderCatalog[];
}

interface OpenClawScanPathResult {
  path: string;
  message: string;
  scanPaths: string[];
}

interface OpenClawSkillRequirements {
  bins: string[];
  anyBins: string[];
  env: string[];
  config: string[];
  os: string[];
}

interface OpenClawSkillInstallAction {
  id: string;
  kind: string;
  label: string;
  bins: string[];
}

interface OpenClawSkillSummary {
  name: string;
  description: string;
  emoji?: string | null;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  source: string;
  bundled: boolean;
  homepage?: string | null;
  primaryEnv?: string | null;
  missing: OpenClawSkillRequirements;
}

interface OpenClawSkillsCatalog {
  workspaceDir: string;
  managedSkillsDir: string;
  readyCount: number;
  totalCount: number;
  skills: OpenClawSkillSummary[];
}

interface OpenClawSkillDetail {
  name: string;
  description: string;
  emoji?: string | null;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  homepage?: string | null;
  primaryEnv?: string | null;
  requirements: OpenClawSkillRequirements;
  missing: OpenClawSkillRequirements;
  install: OpenClawSkillInstallAction[];
}

interface DevSettings {
  mirrorMode?: string;
  openclawScanDirs?: string[];
}

const OPENCLAW_PROBE_TIMEOUT_MS = 4_000;
const OPENCLAW_MODELS_TIMEOUT_MS = 15_000;
const DEV_API_PREFIX = "/__openclaw";

export function openclawDevApiPlugin(): Plugin {
  return {
    name: "openclaw-dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void handleDevApiRequest(request, response, next);
      });
    },
  };
}

async function handleDevApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) {
  const requestUrl = request.url;
  if (!requestUrl?.startsWith(DEV_API_PREFIX)) {
    next();
    return;
  }

  response.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const url = new URL(requestUrl, "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === `${DEV_API_PREFIX}/catalog`) {
      response.end(JSON.stringify(fetchOpenClawCatalogForDev()));
      return;
    }

    if (request.method === "POST" && url.pathname === `${DEV_API_PREFIX}/scan-dir`) {
      const payload = (await readJsonBody(request)) as { path?: unknown };
      const result = registerOpenClawScanDirForDev(payload.path);
      response.end(JSON.stringify(result));
      return;
    }

    if (request.method === "GET" && url.pathname === `${DEV_API_PREFIX}/skills`) {
      response.end(JSON.stringify(fetchOpenClawSkillsForDev()));
      return;
    }

    if (request.method === "GET" && url.pathname === `${DEV_API_PREFIX}/skill-info`) {
      const name = url.searchParams.get("name");
      if (!name) {
        throw new Error("缺少 skill 名称。");
      }

      response.end(JSON.stringify(fetchOpenClawSkillDetailForDev(name)));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ message: "Not found" }));
  } catch (error) {
    response.statusCode = 500;
    response.end(
      JSON.stringify({
        message: error instanceof Error ? error.message : "开发预览扫描失败，请稍后重试。",
      }),
    );
  }
}

function fetchOpenClawCatalogForDev(): OpenClawCatalog {
  const scanPaths = configuredOpenClawScanDirs();
  const version = probeOpenClawVersion();

  if (!version) {
    return {
      installed: false,
      version: null,
      message: "请先安装 OpenClaw，再通过 CLI 拉取可用 provider 和模型列表。",
      runtimeStatus: "stopped",
      scanPaths,
      providers: [],
    };
  }

  try {
    const providers = loadOpenClawProviderCatalog();
    return {
      installed: true,
      version,
      message:
        providers.length > 0
          ? "已检测到 OpenClaw，可继续选择 provider 和模型。"
          : "已检测到 OpenClaw，但当前未从 CLI 返回可用模型列表。",
      runtimeStatus: "stopped",
      scanPaths,
      providers,
    };
  } catch (error) {
    return {
      installed: true,
      version,
      message: `已检测到 OpenClaw，但暂时无法读取模型列表：${formatError(error)}`,
      runtimeStatus: "stopped",
      scanPaths,
      providers: [],
    };
  }
}

function registerOpenClawScanDirForDev(rawPath: unknown): OpenClawScanPathResult {
  if (typeof rawPath !== "string") {
    throw new Error("请先输入 OpenClaw 所在目录。");
  }

  const normalized = normalizeOpenClawScanDirInput(rawPath);
  const settings = loadDevSettings();
  const scanDirs = Array.isArray(settings.openclawScanDirs) ? [...settings.openclawScanDirs] : [];

  pushUnique(scanDirs, normalized);
  settings.openclawScanDirs = scanDirs;
  saveDevSettings(settings);

  return {
    path: normalized,
    message: "已加入 OpenClaw 扫描目录，重新检测时会优先检查这里。",
    scanPaths: configuredOpenClawScanDirs(),
  };
}

function fetchOpenClawSkillsForDev(): OpenClawSkillsCatalog {
  const raw = runOpenClawCommand(["skills", "list", "--json"], OPENCLAW_MODELS_TIMEOUT_MS);
  const parsed = JSON.parse(raw) as {
    workspaceDir: string;
    managedSkillsDir: string;
    skills: OpenClawSkillSummary[];
  };

  return {
    workspaceDir: parsed.workspaceDir,
    managedSkillsDir: parsed.managedSkillsDir,
    readyCount: parsed.skills.filter((skill) => skill.eligible).length,
    totalCount: parsed.skills.length,
    skills: parsed.skills,
  };
}

function fetchOpenClawSkillDetailForDev(name: string): OpenClawSkillDetail {
  const raw = runOpenClawCommand(["skills", "info", name, "--json"], OPENCLAW_MODELS_TIMEOUT_MS);
  return JSON.parse(raw) as OpenClawSkillDetail;
}

function loadOpenClawProviderCatalog(): OpenClawProviderCatalog[] {
  const raw =
    tryRunOpenClawCommand(["models", "list", "--all", "--json"], OPENCLAW_MODELS_TIMEOUT_MS) ??
    runOpenClawCommand(["models", "list", "--all"], OPENCLAW_MODELS_TIMEOUT_MS);

  return parseOpenClawProviderCatalog(raw);
}

function probeOpenClawVersion() {
  const raw = tryRunOpenClawCommand(["--version"], OPENCLAW_PROBE_TIMEOUT_MS);
  if (!raw) {
    return null;
  }

  return parseVersionLike(raw);
}

function parseOpenClawProviderCatalog(raw: string): OpenClawProviderCatalog[] {
  const grouped = new Map<string, Set<string>>();

  for (const modelRef of parseOpenClawModelRefs(raw)) {
    const [providerId] = modelRef.split("/");
    if (!providerId) {
      continue;
    }

    if (!grouped.has(providerId)) {
      grouped.set(providerId, new Set());
    }

    grouped.get(providerId)?.add(modelRef);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([providerId, refs]) => {
      const models = [...refs].sort().map((modelRef) => ({
        id: modelRef,
        title: formatModelTitle(modelRef),
        ref: modelRef,
        authModes: authModesForProvider(providerId),
        supportsLogin: supportsProviderLogin(providerId),
      }));

      return {
        id: providerId,
        title: providerDisplayName(providerId),
        summary: `通过 openclaw models list 检测到 ${models.length} 个可用模型。`,
        models,
      } satisfies OpenClawProviderCatalog;
    });
}

function parseOpenClawModelRefs(raw: string) {
  const refs: string[] = [];

  try {
    collectModelRefsFromValue(JSON.parse(raw), refs);
  } catch {
    // ignore json parse errors and fall back to text mode
  }

  if (refs.length === 0) {
    for (const line of raw.split(/\r?\n/)) {
      const candidate = line.trim().split(/\s+/)[0];
      if (looksLikeModelRef(candidate)) {
        refs.push(candidate);
      }
    }
  }

  return [...new Set(refs.filter(looksLikeModelRef))];
}

function collectModelRefsFromValue(value: unknown, refs: string[]) {
  if (typeof value === "string") {
    if (looksLikeModelRef(value)) {
      refs.push(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectModelRefsFromValue(item, refs);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const item of Object.values(value)) {
    collectModelRefsFromValue(item, refs);
  }
}

function formatModelTitle(modelRef: string) {
  const [, modelName = modelRef] = modelRef.split("/");
  return modelName
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function providerDisplayName(providerId: string) {
  switch (providerId) {
    case "zai":
      return "Z.AI / GLM";
    case "minimax":
      return "MiniMax";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google Gemini";
    default:
      return providerId;
  }
}

function supportsProviderLogin(providerId: string) {
  return providerId === "openai" || providerId === "anthropic";
}

function authModesForProvider(providerId: string): DeployAuthMode[] {
  return supportsProviderLogin(providerId) ? ["api", "login"] : ["api"];
}

function configuredOpenClawScanDirs() {
  const dirs: string[] = [];

  for (const detectedDir of detectOpenClawBinDirs()) {
    pushUnique(dirs, detectedDir);
  }

  for (const configuredDir of loadDevSettings().openclawScanDirs ?? []) {
    pushUnique(dirs, configuredDir);
  }

  if (dirs.length === 0) {
    pushUnique(dirs, defaultOpenClawBinDir());
  }

  return dirs;
}

function detectOpenClawBinDirs() {
  const dirs: string[] = [];
  const pathDir = detectOpenClawDirFromPath();
  if (pathDir) {
    pushUnique(dirs, pathDir);
  }

  const defaultDir = defaultOpenClawBinDir();
  for (const binaryName of openClawBinaryNames()) {
    if (existsSync(path.join(defaultDir, binaryName))) {
      pushUnique(dirs, defaultDir);
      break;
    }
  }

  return dirs;
}

function detectOpenClawDirFromPath() {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return null;
  }

  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) {
      continue;
    }

    for (const binaryName of openClawBinaryNames()) {
      if (existsSync(path.join(dir, binaryName))) {
        return dir;
      }
    }
  }

  return null;
}

function openClawBinaryNames() {
  return process.platform === "win32"
    ? ["openclaw.cmd", "openclaw.exe", "openclaw.ps1", "openclaw"]
    : ["openclaw"];
}

function runOpenClawCommand(args: string[], timeoutMs: number) {
  const scanDirs = configuredOpenClawScanDirs();
  const envPath = [...scanDirs, ...(process.env.PATH?.split(path.delimiter) ?? [])]
    .filter(Boolean)
    .join(path.delimiter);
  let lastError = "missing";

  for (const program of ["openclaw", ...scanDirs.flatMap((dir) => openClawBinaryNames().map((name) => path.join(dir, name)))]) {
    const result = spawnSync(program, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      env: {
        ...process.env,
        PATH: envPath,
      },
    });

    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        continue;
      }

      lastError = code === "ETIMEDOUT" ? `${program} 执行超时` : result.error.message;
      break;
    }

    if (result.status === 0) {
      const merged = (result.stdout || "").trim() || (result.stderr || "").trim();
      if (!merged) {
        throw new Error(`${program} 返回了空输出`);
      }
      return merged;
    }

    lastError = (result.stderr || "").trim() || (result.stdout || "").trim() || `${program} 执行失败`;
    break;
  }

  throw new Error(lastError);
}

function tryRunOpenClawCommand(args: string[], timeoutMs: number) {
  try {
    return runOpenClawCommand(args, timeoutMs);
  } catch {
    return null;
  }
}

function parseVersionLike(raw: string) {
  return raw.match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

function normalizeOpenClawScanDirInput(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("请先输入 OpenClaw 所在目录。");
  }

  const expanded = expandTildePath(trimmed);
  const normalized = looksLikeOpenClawProgramPath(expanded) ? path.dirname(expanded) : expanded;

  if (!existsSync(normalized)) {
    throw new Error("该目录不存在，请确认后再保存。");
  }

  if (!isDirectory(normalized)) {
    throw new Error("请输入 OpenClaw 可执行文件所在目录，而不是普通文件。");
  }

  return normalized;
}

function expandTildePath(raw: string) {
  if (raw === "~") {
    return os.homedir();
  }

  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.join(os.homedir(), raw.slice(2));
  }

  return raw;
}

function looksLikeOpenClawProgramPath(rawPath: string) {
  return openClawBinaryNames().includes(path.basename(rawPath).toLowerCase());
}

function isDirectory(targetPath: string) {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function loadDevSettings(): DevSettings {
  try {
    return JSON.parse(readFileSync(devSettingsPath(), "utf8")) as DevSettings;
  } catch {
    return {};
  }
}

function saveDevSettings(settings: DevSettings) {
  const settingsPath = devSettingsPath();
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function devSettingsPath() {
  return path.join(os.homedir(), ".openclaw-deployer", "settings.json");
}

function defaultOpenClawBinDir() {
  return path.join(os.homedir(), ".openclaw", "bin");
}

function pushUnique(target: string[], value: string) {
  if (!target.includes(value)) {
    target.push(value);
  }
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function looksLikeModelRef(value: string) {
  const [provider, model] = value.split("/");
  return Boolean(provider && model);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
