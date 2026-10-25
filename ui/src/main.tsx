import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { ToastProvider } from "./components/Toasts";
import "./styles.css";

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
