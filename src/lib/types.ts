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
  providers: OpenClawProviderCatalog[];
}

export interface OpenClawInstallLaunchResult {
  started: boolean;
  strategy: string;
  message: string;
}
