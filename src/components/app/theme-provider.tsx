import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type PropsWithChildren,
} from "react";

type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
export const THEME_STORAGE_KEY = "openclaw-deployer-theme";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    return getSystemTheme();
  });

  const syncSystemTheme = useEffectEvent(() => {
    if (mode === "system") {
      const nextTheme = getSystemTheme();
      setResolvedTheme(nextTheme);
      applyTheme(nextTheme);
    }
  });

  useEffect(() => {
    const nextTheme = mode === "system" ? getSystemTheme() : mode;
    setResolvedTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, [syncSystemTheme]);

  return (
    <ThemeContext.Provider value={{ mode, resolvedTheme, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
