import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import InlineFanoronaWorker from "../app/lib/fanorona.worker.ts?worker&inline";
import InlineDraughtsWorker from "../app/lib/draughts.worker.ts?worker&inline";
import InlineMorrisWorker from "../app/lib/morris.worker.ts?worker&inline";
import { TacticianApp } from "../app/components/TacticianApp";
import "../app/globals.css";

const root = document.getElementById("root");
const nativeAndroid = document.documentElement.classList.contains("native-shell");

if (!root) {
  throw new Error("Missing mobile app root");
}

createRoot(root).render(
  <StrictMode>
    <TacticianApp
      nativeAndroid={nativeAndroid}
      workers={{
        fanorona: () => new InlineFanoronaWorker(),
        draughts: () => new InlineDraughtsWorker(),
        morris: () => new InlineMorrisWorker(),
      }}
    />
  </StrictMode>,
);
