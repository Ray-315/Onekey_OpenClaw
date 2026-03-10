import { render, screen } from "@testing-library/react";

import { DiagnosticsContent } from "@/pages/DiagnosticsPage";
import type { EnvironmentScan } from "@/lib/types";

const baseScan: EnvironmentScan = {
  platform: "macos",
  scannedAt: "1710000000000",
  mirrorMode: "official",
  overallReady: false,
  checks: [
    {
      id: "node",
      title: "Node.js",
      status: "installed",
      version: "22.12.0",
      requiredVersion: "22+",
      summary: "Node 已满足要求。",
      actionLabel: "Node.js 已满足",
      actionEnabled: false,
      visible: true,
    },
    {
      id: "npm",
      title: "npm",
      status: "installed",
      version: "10.8.1",
      requiredVersion: null,
      summary: "npm 已满足要求。",
      actionLabel: "npm 已满足",
      actionEnabled: false,
      visible: true,
    },
    {
      id: "git",
      title: "Git",
      status: "missing",
      version: null,
      requiredVersion: null,
      summary: "Git 缺失。",
      actionLabel: "先安装 Homebrew",
      actionEnabled: true,
      visible: true,
    },
    {
      id: "homebrew",
      title: "Homebrew",
      status: "missing",
      version: null,
      requiredVersion: null,
      summary: "Homebrew 缺失。",
      actionLabel: "安装 Homebrew",
      actionEnabled: true,
      visible: true,
    },
  ],
};

describe("DiagnosticsContent", () => {
  it("renders Homebrew card on macOS", () => {
    render(
      <DiagnosticsContent
        error={null}
        installingId={null}
        isRefreshing={false}
        message={null}
        onInstall={() => undefined}
        onRefresh={() => undefined}
        onResetDemo={() => undefined}
        onSwitchMirror={() => undefined}
        resettingDemo={false}
        scan={baseScan}
        switchingMirror={false}
      />,
    );

    expect(screen.getAllByText("Homebrew").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "安装 Homebrew" })).toBeInTheDocument();
  });

  it("hides Homebrew when the check is invisible", () => {
    render(
      <DiagnosticsContent
        error={null}
        installingId={null}
        isRefreshing={false}
        message={null}
        onInstall={() => undefined}
        onRefresh={() => undefined}
        onResetDemo={() => undefined}
        onSwitchMirror={() => undefined}
        scan={{
          ...baseScan,
          platform: "windows",
          checks: baseScan.checks.map((check) =>
            check.id === "homebrew" ? { ...check, visible: false } : check,
          ),
        }}
        resettingDemo={false}
        switchingMirror={false}
      />,
    );

    expect(screen.queryByText("Homebrew")).not.toBeInTheDocument();
    expect(screen.getByText("Windows")).toBeInTheDocument();
  });

  it("renders mirror switch button from current mode", () => {
    render(
      <DiagnosticsContent
        error={null}
        installingId={null}
        isRefreshing={false}
        message={null}
        onInstall={() => undefined}
        onRefresh={() => undefined}
        onResetDemo={() => undefined}
        onSwitchMirror={() => undefined}
        resettingDemo={false}
        scan={baseScan}
        switchingMirror={false}
      />,
    );

    expect(screen.getByRole("button", { name: "切换国内镜像" })).toBeInTheDocument();
    expect(screen.getByText("官方源")).toBeInTheDocument();
  });
});
