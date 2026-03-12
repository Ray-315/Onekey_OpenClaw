import { Check, CheckCircle2, ExternalLink, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { openExternalUrl } from "@/lib/tauri";

const FEISHU_DOC_URL = "https://docs.openclaw.ai/zh-CN/channels/feishu";
const DEPLOYED_STORAGE_KEY = "feishu-channel-deployed";

function ConfirmFeishuDeployModal({
  confirmedChecklist,
  onCancel,
  onChecklistChange,
  onConfirm,
}: {
  confirmedChecklist: boolean;
  onCancel: () => void;
  onChecklistChange: (checked: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
      <div className="w-full max-w-xl rounded-[32px] border border-border/70 bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-border/70 px-6 py-5">
          <div>
            <p className="text-sm text-muted-foreground">飞书部署确认</p>
            <h4 className="text-xl font-semibold">确认完成文档要求后才能继续</h4>
          </div>
          <Button onClick={onCancel} size="icon" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-5 p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            这不会联网校验，只会把当前飞书 Channel 页面标记为已通过。请先确认你已严格按文档要求完成全部部署操作。
          </p>

          <label
            className={`flex cursor-pointer items-start gap-4 rounded-[22px] border p-4 transition-all duration-200 ${
              confirmedChecklist
                ? "border-primary/35 bg-primary/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "border-border/70 bg-foreground/4 hover:border-primary/20 hover:bg-foreground/6"
            }`}
          >
            <input
              checked={confirmedChecklist}
              className="sr-only"
              onChange={(event) => onChecklistChange(event.target.checked)}
              type="checkbox"
            />
            <span
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border transition-all duration-200 ${
                confirmedChecklist
                  ? "scale-100 border-primary bg-primary text-primary-foreground shadow-[0_0_0_6px_rgba(37,99,235,0.12)]"
                  : "scale-95 border-border/80 bg-background/80 text-transparent"
              }`}
            >
              <Check
                className={`size-3.5 transition-all duration-200 ${
                  confirmedChecklist ? "scale-100 opacity-100" : "scale-50 opacity-0"
                }`}
              />
            </span>
            <span
              className={`text-sm leading-7 transition-colors ${
                confirmedChecklist ? "text-foreground" : "text-foreground/92"
              }`}
            >
              我确认已按文档要求完成全部飞书部署操作
            </span>
          </label>

          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={onCancel} variant="outline">
              放弃
            </Button>
            <Button disabled={!confirmedChecklist} onClick={onConfirm}>
              确认通过
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function readDeployedState() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(DEPLOYED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeDeployedState(value: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(DEPLOYED_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Ignore storage errors and keep the in-memory state.
  }
}

export function ChannelWizardPage() {
  const [deployed, setDeployed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmedChecklist, setConfirmedChecklist] = useState(false);

  useEffect(() => {
    setDeployed(readDeployedState());
  }, []);

  async function handleOpenDocs() {
    await openExternalUrl(FEISHU_DOC_URL);
  }

  function handleOpenConfirm() {
    setConfirmedChecklist(false);
    setConfirmOpen(true);
  }

  function handleCloseConfirm() {
    setConfirmOpen(false);
    setConfirmedChecklist(false);
  }

  function handleConfirmDeployment() {
    setDeployed(true);
    writeDeployedState(true);
    handleCloseConfirm();
  }

  return (
    <section className="space-y-6">
      <Card className="border-border/70">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="info">Feishu Channel</Badge>
            <Badge variant={deployed ? "success" : "neutral"}>{deployed ? "已通过" : "待确认"}</Badge>
          </div>
          <CardTitle className="text-3xl tracking-tight">飞书 Channel 部署</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
          <div className="rounded-[24px] border border-border/70 bg-foreground/4 p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                <ExternalLink className="size-5" />
              </div>
              <div className="min-w-0 space-y-3">
                <h3 className="text-xl font-semibold">查看部署文档</h3>
                <p className="text-sm leading-7 text-muted-foreground">
                  点击下方按钮打开飞书 Channel 官方文档，按文档要求完成应用创建、权限配置、事件回调等全部操作。
                </p>
                <Button
                  onClick={() => {
                    void handleOpenDocs();
                  }}
                >
                  <ExternalLink className="size-4" />
                  打开文档
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-border/70 bg-foreground/4 p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-success/12 text-success">
                <ShieldCheck className="size-5" />
              </div>
              <div className="min-w-0 space-y-3">
                <h3 className="text-xl font-semibold">部署状态确认</h3>
                <p className="text-sm leading-7 text-muted-foreground">
                  确认你已经严格按文档完成全部飞书部署操作后，再点击“已部署”进行人工确认。
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={handleOpenConfirm} variant={deployed ? "outline" : "default"}>
                    <CheckCircle2 className="size-4" />
                    {deployed ? "重新确认" : "已部署"}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    当前状态：
                    <span className={deployed ? "ml-1 font-medium text-success" : "ml-1 font-medium text-foreground"}>
                      {deployed ? "已通过" : "未确认"}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {confirmOpen ? (
        <ConfirmFeishuDeployModal
          confirmedChecklist={confirmedChecklist}
          onCancel={handleCloseConfirm}
          onChecklistChange={setConfirmedChecklist}
          onConfirm={handleConfirmDeployment}
        />
      ) : null}
    </section>
  );
}
