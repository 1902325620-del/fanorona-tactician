"use client";

import { TacticianApp } from "./TacticianApp";

const createFanoronaWorker = () =>
  new Worker(new URL("../lib/fanorona.worker.ts", import.meta.url), {
    type: "module",
  });

const createDraughtsWorker = () =>
  new Worker(new URL("../lib/draughts.worker.ts", import.meta.url), {
    type: "module",
  });

const createMorrisWorker = () =>
  new Worker(new URL("../lib/morris.worker.ts", import.meta.url), {
    type: "module",
  });

export function WebFanoronaAssistant() {
  return (
    <TacticianApp
      workers={{
        fanorona: createFanoronaWorker,
        draughts: createDraughtsWorker,
        morris: createMorrisWorker,
      }}
    />
  );
}
