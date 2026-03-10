import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";
import { lockDesktopShell } from "@/lib/context-menu";

lockDesktopShell();

createRoot(document.getElementById("root")!).render(<App />);
