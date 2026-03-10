import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/app/app-shell";
import {
  WorkbenchSettingsProvider,
  useWorkbenchSettings,
} from "@/components/app/app-settings-provider";
import { ThemeProvider } from "@/components/app/theme-provider";
import { DeployPage } from "@/pages/DeployPage";
import { DiagnosticsPage } from "@/pages/DiagnosticsPage";
import { RuntimePage } from "@/pages/RuntimePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SkillsPage } from "@/pages/SkillsPage";

function AppRoutes() {
  const { settings } = useWorkbenchSettings();

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to={`/${settings.startPage}`} replace />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="/deploy" element={<DeployPage />} />
          <Route path="/runtime" element={<RuntimePage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/recipes" element={<Navigate to="/skills" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <WorkbenchSettingsProvider>
        <AppRoutes />
      </WorkbenchSettingsProvider>
    </ThemeProvider>
  );
}
