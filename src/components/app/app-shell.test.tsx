import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, vi } from "vitest";

import { AppShell } from "@/components/app/app-shell";
import { ThemeProvider } from "@/components/app/theme-provider";
import * as tauri from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({
  closeAppWindow: vi.fn().mockResolvedValue(undefined),
  fetchOpenClawLatestVersion: vi.fn().mockResolvedValue({
    version: "2026.3.1",
    packageUrl: "https://www.npmjs.com/package/openclaw",
  }),
  fetchOpenClawRuntimeOverview: vi.fn().mockResolvedValue({
    installed: false,
    version: null,
    message: "mocked",
    runtimeStatus: "stopped",
    scanPaths: [],
  }),
  isAppWindowMaximized: vi.fn().mockResolvedValue(false),
  isTauriRuntime: vi.fn().mockReturnValue(false),
  launchOpenClawGateway: vi.fn().mockResolvedValue({
    started: true,
    command: "openclaw gateway run --allow-unconfigured",
    message: "mocked",
  }),
  minimizeAppWindow: vi.fn().mockResolvedValue(undefined),
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
  scanEnvironment: vi.fn().mockResolvedValue({
    platform: "windows",
    scannedAt: "0",
    mirrorMode: "official",
    checks: [],
    overallReady: false,
  }),
  startAppWindowDragging: vi.fn().mockResolvedValue(undefined),
  toggleAppWindowMaximize: vi.fn().mockResolvedValue(false),
  updateOpenClaw: vi.fn().mockResolvedValue({
    updated: true,
    version: "2026.3.8",
    message: "updated",
  }),
}));

describe("AppShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(tauri.fetchOpenClawLatestVersion).mockResolvedValue({
      version: "2026.3.1",
      packageUrl: "https://www.npmjs.com/package/openclaw",
    });
    vi.mocked(tauri.fetchOpenClawRuntimeOverview).mockResolvedValue({
      installed: false,
      version: null,
      message: "mocked",
      runtimeStatus: "stopped",
      scanPaths: [],
    });
    vi.mocked(tauri.updateOpenClaw).mockResolvedValue({
      updated: true,
      version: "2026.3.8",
      message: "updated",
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  });

  it("renders primary navigation entries", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ThemeProvider>
          <MemoryRouter initialEntries={["/diagnostics"]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/diagnostics" element={<div>diagnostics</div>} />
                <Route path="/channels/feishu" element={<div>channel wizard</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>,
      ));
    });

    const links = container.querySelectorAll("a[href]");
    const hrefs = Array.from(links).map((link) => link.getAttribute("href"));

    expect(hrefs).toContain("/diagnostics");
    expect(hrefs).toContain("/deploy");
    expect(hrefs).toContain("/channels/feishu");
    expect(hrefs).toContain("/runtime");
    expect(hrefs).toContain("/skills");
    expect(hrefs).toContain("/recipes");
    expect(hrefs).toContain("/settings");
    expect(screen.getAllByRole("link", { name: /channel/i }).length).toBeGreaterThan(0);
  });

  it("shows OpenClaw update notice when installed version is older than latest", async () => {
    vi.mocked(tauri.fetchOpenClawLatestVersion).mockResolvedValue({
      version: "2026.3.8",
      packageUrl: "https://www.npmjs.com/package/openclaw",
    });
    vi.mocked(tauri.fetchOpenClawRuntimeOverview).mockResolvedValue({
      installed: true,
      version: "2026.3.1",
      message: "mocked",
      runtimeStatus: "stopped",
      scanPaths: [],
    });

    await act(async () => {
      render(
        <ThemeProvider>
          <MemoryRouter initialEntries={["/diagnostics"]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/diagnostics" element={<div>diagnostics</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>,
      );
    });

    expect(screen.getByRole("heading", { name: /OpenClaw/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即更新" })).toBeInTheDocument();
  });

  it("runs manual OpenClaw update when clicking update now", async () => {
    vi.mocked(tauri.fetchOpenClawLatestVersion).mockResolvedValue({
      version: "2026.3.8",
      packageUrl: "https://www.npmjs.com/package/openclaw",
    });
    vi.mocked(tauri.fetchOpenClawRuntimeOverview).mockResolvedValue({
      installed: true,
      version: "2026.3.1",
      message: "mocked",
      runtimeStatus: "stopped",
      scanPaths: [],
    });

    await act(async () => {
      render(
        <ThemeProvider>
          <MemoryRouter initialEntries={["/diagnostics"]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/diagnostics" element={<div>diagnostics</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));

    await waitFor(() => {
      expect(tauri.updateOpenClaw).toHaveBeenCalledTimes(1);
    });
  });

  it("does not re-check shell status on route changes", async () => {
    let container!: HTMLElement;

    await act(async () => {
      ({ container } = render(
        <ThemeProvider>
          <MemoryRouter initialEntries={["/diagnostics"]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/diagnostics" element={<div>diagnostics</div>} />
                <Route path="/deploy" element={<div>deploy</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>,
      ));
    });

    expect(tauri.scanEnvironment).not.toHaveBeenCalled();
    expect(tauri.fetchOpenClawRuntimeOverview).toHaveBeenCalledTimes(1);

    const deployLink = container.querySelector('a[href="/deploy"]');
    expect(deployLink).not.toBeNull();

    await act(async () => {
      fireEvent.click(deployLink as HTMLAnchorElement);
    });

    expect(screen.getByText("deploy")).toBeInTheDocument();
    expect(tauri.scanEnvironment).not.toHaveBeenCalled();
    expect(tauri.fetchOpenClawRuntimeOverview).toHaveBeenCalledTimes(1);
  });
});
