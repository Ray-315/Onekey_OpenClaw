import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { AppShell } from "@/components/app/app-shell";
import { ThemeProvider } from "@/components/app/theme-provider";

describe("AppShell", () => {
  it("renders four primary navigation entries", () => {
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

    expect(screen.getAllByRole("link", { name: /环境检测/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /一键部署/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /按配方部署/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /设置/i }).length).toBeGreaterThan(0);
  });
});
