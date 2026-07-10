import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import InlineEngineWorker from "../app/lib/fanorona.worker.ts?worker&inline";
import { FanoronaAssistant } from "../app/components/FanoronaAssistant";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing portable app root");
}

const createWorker = () => new InlineEngineWorker();

createRoot(root).render(
  <StrictMode>
    <FanoronaAssistant createWorker={createWorker} />
  </StrictMode>,
);
