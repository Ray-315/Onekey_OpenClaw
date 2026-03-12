export type DependencyId = "node" | "npm" | "git" | "homebrew";
export type Platform = "macos" | "windows";
export type CheckStatus = "installed" | "missing" | "outdated" | "error";
export type MirrorMode = "official" | "china";
export type DeployAuthMode = "api" | "login";
export type OpenClawRuntimeStatus = "running" | "stopped";

export interface DependencyCheck {
  id: DependencyId;
  title: string;
  status: CheckStatus;
  version?: string | null;
  requiredVersion?: string | null;
  summary: string;
  actionLabel: string;
  actionEnabled: boolean;
  visible: boolean;
}

export interface EnvironmentScan {
  platform: Platform;
  scannedAt: string;
  mirrorMode: MirrorMode;
  checks: DependencyCheck[];
  overallReady: boolean;
}

export interface InstallLaunchResult {
  id: DependencyId;
  strategy: string;
  started: boolean;
  message: string;
}

export interface MirrorSwitchResult {
  mode: MirrorMode;
  message: string;
}

export interface OpenClawProviderModel {
  id: string;
  title: string;
  ref: string;
  authModes: DeployAuthMode[];
  supportsLogin: boolean;
}

export interface OpenClawProviderCatalog {
  id: string;
  title: string;
  summary: string;
  models: OpenClawProviderModel[];
}

export interface OpenClawCatalog {
  installed: boolean;
  version?: string | null;
  message: string;
  runtimeStatus: OpenClawRuntimeStatus;
  scanPaths: string[];
  providers: OpenClawProviderCatalog[];
}

export interface OpenClawRuntimeOverview {
  installed: boolean;
  version?: string | null;
  message: string;
  runtimeStatus: OpenClawRuntimeStatus;
  scanPaths: string[];
}

export interface OpenClawLatestVersion {
  version: string;
  packageUrl: string;
}

export interface OpenClawUpdateResult {
  updated: boolean;
  version?: string | null;
  message: string;
}

export interface OpenClawInstallLaunchResult {
  started: boolean;
  strategy: string;
  message: string;
}

export interface OpenClawUninstallResult {
  started: boolean;
  message: string;
}

export interface OpenClawScanPathResult {
  path: string;
  message: string;
  scanPaths: string[];
}

export interface OpenClawAuthLaunchResult {
  started: boolean;
  provider: string;
  command: string;
  message: string;
  authStorePath: string;
}

export interface OpenClawAuthStatusResult {
  provider: string;
  connected: boolean;
  message: string;
  authStorePath: string;
}

export interface OpenClawGatewayLaunchResult {
  started: boolean;
  command: string;
  message: string;
}

export interface OpenClawDashboardLaunchResult {
  opened: boolean;
  url: string;
  message: string;
}

export interface OpenClawDeployRequest {
  primaryProviderId: string;
  primaryProviderRouteId?: string;
  primaryModelRef: string;
  authMode: DeployAuthMode;
  apiSecret: string;
  fallbackModelRef: string;
  autoStartGateway: boolean;
}

export interface OpenClawDeployResult {
  applied: boolean;
  startedGateway: boolean;
  message: string;
}

export interface OpenClawSkillRequirements {
  bins: string[];
  anyBins: string[];
  env: string[];
  config: string[];
  os: string[];
}

export interface OpenClawSkillInstallAction {
  id: string;
  kind: string;
  label: string;
  bins: string[];
}

export interface OpenClawSkillSummary {
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

export interface OpenClawSkillsCatalog {
  workspaceDir: string;
  managedSkillsDir: string;
  readyCount: number;
  totalCount: number;
  skills: OpenClawSkillSummary[];
}

export interface OpenClawSkillDetail {
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

export interface OpenClawSkillInstallLaunchResult {
  started: boolean;
  skillName: string;
  actionId: string;
  command: string;
  message: string;
}
