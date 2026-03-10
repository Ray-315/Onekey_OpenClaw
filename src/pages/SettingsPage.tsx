import { BellRing, FolderCog, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";

import {
  useWorkbenchSettings,
  WORKBENCH_SETTINGS_STORAGE_KEY,
} from "@/components/app/app-settings-provider";
import { THEME_STORAGE_KEY } from "@/components/app/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resetDemoEnvironment } from "@/lib/demo-runtime";
import { isTauriRuntime } from "@/lib/tauri";

export function SettingsPage() {
  const { settings, updateSettings, resetSettings } = useWorkbenchSettings();
  const [notice, setNotice] = useState<string | null>(null);

  function handleResetWorkbench() {
    resetSettings();
    setNotice("已恢复默认工作台设置。");
  }

  function handleResetPreviewData() {
    resetDemoEnvironment();
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    window.localStorage.removeItem(WORKBENCH_SETTINGS_STORAGE_KEY);
    resetSettings();
    setNotice("已清空当前预览数据，并恢复默认偏好。");
  }

  return (
    <section className="space-y-6">
      <Card className="border-border/70">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <Badge variant="info">应用设置</Badge>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight">部署器设置</h3>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              这里只保留会立刻生效的工作台设置，不重复模型、渠道和部署参数。
            </p>
          </div>

          <div className="rounded-[28px] border border-border/70 bg-foreground/5 p-5">
            <p className="text-sm font-medium">当前可设置项</p>
            <div className="mt-4 grid gap-3 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-border/60 px-4 py-3">默认首页</div>
              <div className="rounded-2xl border border-border/60 px-4 py-3">窗口重新聚焦后自动重检</div>
              <div className="rounded-2xl border border-border/60 px-4 py-3">安装完成提醒</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {notice ? (
        <div className="rounded-[20px] border border-primary/20 bg-primary/10 px-4 py-3 text-sm leading-6">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>工作台行为</CardTitle>
            <CardDescription>这些项会直接影响默认打开页和环境检测行为。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-border/70 px-4 py-4">
              <p className="text-sm font-medium">默认首页</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() => updateSettings({ startPage: "diagnostics" })}
                  size="sm"
                  variant={settings.startPage === "diagnostics" ? "default" : "outline"}
                >
                  环境检测
                </Button>
                <Button
                  onClick={() => updateSettings({ startPage: "deploy" })}
                  size="sm"
                  variant={settings.startPage === "deploy" ? "default" : "outline"}
                >
                  一键部署
                </Button>
              </div>
            </div>

            <button
              className="flex w-full items-center justify-between rounded-2xl border border-border/70 px-4 py-4 text-left transition-colors duration-200 hover:bg-foreground/5"
              onClick={() => updateSettings({ focusRescan: !settings.focusRescan })}
              type="button"
            >
              <div>
                <p className="text-sm font-medium">窗口重新聚焦后自动重检</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  关闭后，环境检测页不会在你切回窗口时自动重新扫描。
                </p>
              </div>
              <Badge variant={settings.focusRescan ? "success" : "neutral"}>
                {settings.focusRescan ? "已开启" : "已关闭"}
              </Badge>
            </button>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <div className="flex items-center gap-3">
              <BellRing className="size-5 text-primary" />
              <CardTitle>安装提醒</CardTitle>
            </div>
            <CardDescription>这些项会直接影响安装按钮的实际行为。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <button
              className="flex w-full items-center justify-between rounded-2xl border border-border/70 px-4 py-4 text-left transition-colors duration-200 hover:bg-foreground/5"
              onClick={() => updateSettings({ showInstallNotice: !settings.showInstallNotice })}
              type="button"
            >
              <div>
                <p className="text-sm font-medium">安装完成后显示提示</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  关闭后，安装成功不会再弹出这类提示文案。
                </p>
              </div>
              <Badge variant={settings.showInstallNotice ? "success" : "neutral"}>
                {settings.showInstallNotice ? "已开启" : "已关闭"}
              </Badge>
            </button>

            <div className="rounded-2xl border border-border/70 bg-foreground/5 px-4 py-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="size-4 text-primary" />
                <p className="text-sm font-medium">这些设置已接入真实行为</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                默认首页、自动重检和安装提示都会立刻生效，不再只是页面状态。
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 xl:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <FolderCog className="size-5 text-primary" />
              <CardTitle>数据维护</CardTitle>
            </div>
            <CardDescription>只保留当前真正可执行的维护动作。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={handleResetWorkbench} variant="outline">
              <RotateCcw className="size-4" />
              重置工作台设置
            </Button>
            {!isTauriRuntime() ? (
              <Button onClick={handleResetPreviewData} variant="outline">
                <RotateCcw className="size-4" />
                重置预览数据
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
