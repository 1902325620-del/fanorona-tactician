"use client";

import { FanoronaAssistant } from "./FanoronaAssistant";

const createWorker = () =>
  new Worker(new URL("../lib/fanorona.worker.ts", import.meta.url), {
    type: "module",
  });

export function WebFanoronaAssistant() {
  return <FanoronaAssistant createWorker={createWorker} />;
}
