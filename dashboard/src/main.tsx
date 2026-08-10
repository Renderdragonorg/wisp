import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexClientProvider>
      <App />
    </ConvexClientProvider>
  </StrictMode>
);
