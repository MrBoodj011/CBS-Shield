import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { ToastProvider } from "./components/Toasts";
import "./styles.css";

async function bootstrap() {
  // Browser preview (`npm run dev` outside Tauri): install a fake backend so
  // every screen can be reviewed. Never included in production builds.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const { installMockBackend } = await import("./dev/mockBackend");
    installMockBackend();
  }

  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Élément racine introuvable dans index.html");
  }

  createRoot(container).render(
    <StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StrictMode>,
  );
}

void bootstrap();
