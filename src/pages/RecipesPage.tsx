import { BookOpenText, Clock3, DownloadCloud, Shapes } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function RecipesPage() {
  return (
    <section className="space-y-4">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="border-b border-border/70 p-6 lg:border-b-0 lg:border-r">
              <Badge variant="info">按配方部署</Badge>
              <h3 className="mt-4 text-3xl font-semibold tracking-tight">社区配方入口正在开发中</h3>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                这一页后续会接入社区配方列表、详情预览和一键导入。当前先不展开未完成的页面结构，避免把半成品内容直接摊开。
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {[
                  {
                    icon: DownloadCloud,
                    title: "社区下载",
                    detail: "浏览和拉取社区已上传的部署配方。",
                  },
                  {
                    icon: BookOpenText,
                    title: "详情预览",
                    detail: "查看依赖、变量、适用平台和维护状态。",
                  },
                  {
                    icon: Shapes,
                    title: "一键导入",
                    detail: "把配方直接带入部署流程，而不是手动重填。",
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.title}
                      className="rounded-[24px] border border-border/70 bg-foreground/5 p-4"
                    >
                      <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </div>
                      <p className="mt-4 text-sm font-semibold">{item.title}</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-center p-6">
              <div className="glass-panel flex min-h-[280px] w-full max-w-[280px] flex-col items-center justify-center rounded-[28px] border border-border/80 bg-background/55 px-6 py-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-[22px] bg-primary/12 text-primary">
                  <Clock3 className="size-6" />
                </div>
                <Badge className="mt-5" variant="warning">
                  开发中
                </Badge>
                <h4 className="mt-4 text-2xl font-semibold tracking-tight">敬请期待</h4>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  当前暂不开放交互，等社区配方链路接完后再展开完整页面。
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
