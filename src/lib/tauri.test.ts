import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();
let localStorageStore = new Map<string, string>();
let localStorageMock: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

vi.mock("@/lib/demo-runtime", () => ({
  applyDemoInstall: vi.fn(),
  applyDemoMirrorMode: vi.fn(),
  applyDemoOpenClawInstall: vi.fn(),
  applyDemoOpenClawScanDir: vi.fn(),
  buildDemoEnvironmentScan: vi.fn(() => ({
    platform: "windows",
    scannedAt: "0",
    mirrorMode: "official",
    checks: [],
    overallReady: false,
  })),
  buildDemoOpenClawCatalog: vi.fn(() => ({
    installed: false,
    version: null,
    message: "mocked",
    runtimeStatus: "stopped",
    scanPaths: [],
    providers: [],
  })),
  resetDemoEnvironment: vi.fn(),
}));

async function loadTauriModule() {
  vi.resetModules();
  return import("@/lib/tauri");
}

describe("tauri detection caching", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(true);
    localStorageStore = new Map<string, string>();
    localStorageMock = {
      getItem: vi.fn((key: string) => localStorageStore.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageStore.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        localStorageStore.delete(key);
      }),
      clear: vi.fn(() => {
        localStorageStore.clear();
      }),
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses cached environment scans within 5 seconds", async () => {
    invokeMock.mockResolvedValue({
      platform: "windows",
      scannedAt: "1",
      mirrorMode: "official",
      checks: [],
      overallReady: true,
    });

    const tauri = await loadTauriModule();

    await tauri.scanEnvironment();
    await tauri.scanEnvironment();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("scan_environment", { force: false });
  });

  it("bypasses the cache when force refresh is requested", async () => {
    invokeMock
      .mockResolvedValueOnce({
        platform: "windows",
        scannedAt: "1",
        mirrorMode: "official",
        checks: [],
        overallReady: true,
      })
      .mockResolvedValueOnce({
        platform: "windows",
        scannedAt: "2",
        mirrorMode: "official",
        checks: [],
        overallReady: true,
      });

    const tauri = await loadTauriModule();

    await tauri.scanEnvironment();
    await tauri.scanEnvironment({ force: true });

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("scan_environment", { force: true });
  });

  it("shares in-flight runtime requests instead of spawning duplicates", async () => {
    let resolveRuntime!: (value: unknown) => void;
    const runtimePromise = new Promise((resolve) => {
      resolveRuntime = resolve;
    });

    invokeMock.mockReturnValue(runtimePromise);
    const tauri = await loadTauriModule();

    const first = tauri.fetchOpenClawRuntimeOverview();
    const second = tauri.fetchOpenClawRuntimeOverview();

    expect(invokeMock).toHaveBeenCalledTimes(1);

    resolveRuntime({
      installed: true,
      version: "2026.3.8",
      message: "mocked",
      runtimeStatus: "running",
      scanPaths: [],
    });

    const [left, right] = await Promise.all([first, second]);
    expect(left).toEqual(right);
  });

  it("expires cached latest-version reads after 5 seconds", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    invokeMock
      .mockResolvedValueOnce({
        version: "2026.3.8",
        packageUrl: "https://www.npmjs.com/package/openclaw",
      })
      .mockResolvedValueOnce({
        version: "2026.3.9",
        packageUrl: "https://www.npmjs.com/package/openclaw",
      });

    const tauri = await loadTauriModule();

    await tauri.fetchOpenClawLatestVersion();
    now += 5_001;
    await tauri.fetchOpenClawLatestVersion();

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("fetch_openclaw_latest_version", {
      force: false,
    });
  });

  it("keeps skills catalog cached for 30 seconds", async () => {
    let now = 2_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    invokeMock
      .mockResolvedValueOnce({
        workspaceDir: "",
        managedSkillsDir: "",
        readyCount: 1,
        totalCount: 2,
        skills: [],
      })
      .mockResolvedValueOnce({
        workspaceDir: "",
        managedSkillsDir: "",
        readyCount: 2,
        totalCount: 2,
        skills: [],
      });

    const tauri = await loadTauriModule();

    await tauri.fetchOpenClawSkills();
    now += 29_000;
    await tauri.fetchOpenClawSkills();
    now += 1_500;
    await tauri.fetchOpenClawSkills();

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("fetch_openclaw_skills");
  });

  it("hydrates persisted environment snapshots before a fresh request", async () => {
    localStorageMock.setItem(
      "openclaw-deployer-detection:environment",
      JSON.stringify({
        platform: "windows",
        scannedAt: "cached",
        mirrorMode: "official",
        checks: [],
        overallReady: true,
      }),
    );

    const tauri = await loadTauriModule();

    expect(tauri.peekEnvironmentScanSnapshot()).toEqual({
      platform: "windows",
      scannedAt: "cached",
      mirrorMode: "official",
      checks: [],
      overallReady: true,
    });
  });

  it("stores successful catalog reads as persisted snapshots", async () => {
    invokeMock.mockResolvedValue({
      installed: true,
      version: "2026.3.8",
      message: "mocked",
      runtimeStatus: "stopped",
      scanPaths: ["C:/Users/Ray/AppData/Roaming/npm"],
      providers: [],
    });

    const tauri = await loadTauriModule();
    await tauri.fetchOpenClawCatalog();

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "openclaw-deployer-detection:openclawCatalog",
      expect.any(String),
    );
  });
});
