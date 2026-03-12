import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";

import { ChannelWizardPage } from "@/pages/ChannelWizardPage";
import * as tauri from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));

describe("ChannelWizardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
        get length() {
          return store.size;
        },
      },
    });
  });

  it("opens the Feishu deployment document", () => {
    render(<ChannelWizardPage />);

    fireEvent.click(screen.getByRole("button", { name: "打开文档" }));

    expect(vi.mocked(tauri.openExternalUrl)).toHaveBeenCalledWith(
      "https://docs.openclaw.ai/zh-CN/channels/feishu",
    );
  });

  it("requires checkbox confirmation before marking as deployed", () => {
    render(<ChannelWizardPage />);

    fireEvent.click(screen.getByRole("button", { name: "已部署" }));

    const confirmButton = screen.getByRole("button", { name: "确认通过" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "我确认已按文档要求完成全部飞书部署操作" }));
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);

    expect(screen.getAllByText("已通过").length).toBeGreaterThan(0);
    expect(window.localStorage.getItem("feishu-channel-deployed")).toBe("true");
  });
});
