import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";

export type StartPage = "diagnostics" | "deploy";

export interface WorkbenchSettings {
  startPage: StartPage;
  focusRescan: boolean;
  showInstallNotice: boolean;
}

interface WorkbenchSettingsContextValue {
  settings: WorkbenchSettings;
  updateSettings: (patch: Partial<WorkbenchSettings>) => void;
  resetSettings: () => void;
}

export const WORKBENCH_SETTINGS_STORAGE_KEY = "openclaw-deployer-workbench-settings";

const defaultSettings: WorkbenchSettings = {
  startPage: "diagnostics",
  focusRescan: true,
  showInstallNotice: true,
};

const WorkbenchSettingsContext = createContext<WorkbenchSettingsContextValue | null>(null);

function loadWorkbenchSettings(): WorkbenchSettings {
  const raw = window.localStorage.getItem(WORKBENCH_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return defaultSettings;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkbenchSettings>;
    return {
      startPage: parsed.startPage === "deploy" ? "deploy" : "diagnostics",
      focusRescan: parsed.focusRescan ?? defaultSettings.focusRescan,
      showInstallNotice: parsed.showInstallNotice ?? defaultSettings.showInstallNotice,
    };
  } catch {
    return defaultSettings;
  }
}

export function WorkbenchSettingsProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<WorkbenchSettings>(() => loadWorkbenchSettings());

  useEffect(() => {
    window.localStorage.setItem(WORKBENCH_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  function updateSettings(patch: Partial<WorkbenchSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function resetSettings() {
    setSettings(defaultSettings);
  }

  return (
    <WorkbenchSettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
      {children}
    </WorkbenchSettingsContext.Provider>
  );
}

export function useWorkbenchSettings() {
  const context = useContext(WorkbenchSettingsContext);
  if (!context) {
    throw new Error("useWorkbenchSettings must be used within WorkbenchSettingsProvider");
  }
  return context;
}
