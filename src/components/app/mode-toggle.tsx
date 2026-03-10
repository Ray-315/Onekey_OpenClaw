import { LaptopMinimal, MoonStar, SunMedium } from "lucide-react";

import { useTheme } from "@/components/app/theme-provider";
import { cn } from "@/lib/utils";

const options = [
  { id: "system", label: "跟随系统", icon: LaptopMinimal },
  { id: "light", label: "浅色", icon: SunMedium },
  { id: "dark", label: "深色", icon: MoonStar },
] as const;

export function ModeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div className="glass-panel flex items-center gap-1 rounded-2xl border border-border/80 p-1">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.id === mode;
        return (
          <button
            key={option.id}
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-foreground/6 hover:text-foreground",
            )}
            onClick={() => setMode(option.id)}
            type="button"
          >
            <Icon className="size-4" />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
