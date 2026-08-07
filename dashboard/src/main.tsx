import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./index.css";
import App from "./App";
import { AuthGate } from "./components/AuthGate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexClientProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </ConvexClientProvider>
  </StrictMode>
);
