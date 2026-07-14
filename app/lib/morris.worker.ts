/// <reference lib="webworker" />

import initializeMorrisWasm from "../wasm/generated/morris_engine.wasm?init";
import {
  type MorrisPosition,
  type SearchOptions,
  type SearchProgress,
  type SearchResult,
} from "./morris";
import { MorrisSearchRouter, MorrisWasmEngine } from "./morris-wasm";

export type MorrisSearchRequestId = string | number;

export interface MorrisSearchRequest {
  type: "search";
  id: MorrisSearchRequestId;
  position: MorrisPosition;
  options?: Omit<SearchOptions, "shouldStop">;
}

export interface MorrisCancelRequest {
  type: "cancel";
  id?: MorrisSearchRequestId;
}

export type MorrisWorkerRequest = MorrisSearchRequest | MorrisCancelRequest;

export interface MorrisProgressMessage extends SearchProgress {
  type: "progress";
  id: MorrisSearchRequestId;
}

export interface MorrisResultMessage extends SearchResult {
  type: "result";
  id: MorrisSearchRequestId;
}

export interface MorrisErrorMessage {
  type: "error";
  id: MorrisSearchRequestId;
  message: string;
}

export interface MorrisCancelledMessage {
  type: "cancelled";
  id: MorrisSearchRequestId;
}

export type MorrisWorkerResponse =
  | MorrisProgressMessage
  | MorrisResultMessage
  | MorrisErrorMessage
  | MorrisCancelledMessage;

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
const cancelled = new Set<MorrisSearchRequestId>();
let activeId: MorrisSearchRequestId | null = null;
const engineRouter = new MorrisSearchRouter(async () => {
  const instance = await initializeMorrisWasm({
    env: { now_ms: () => performance.now() },
  });
  return new MorrisWasmEngine(instance.exports);
});

workerScope.onmessage = (event: MessageEvent<MorrisWorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    if (request.id === undefined) {
      if (activeId !== null) cancelled.add(activeId);
    } else {
      cancelled.add(request.id);
    }
    return;
  }

  void handleSearch(request);
};

async function handleSearch(request: MorrisSearchRequest): Promise<void> {
  const { id, position } = request;
  if (activeId !== null && activeId !== id) cancelled.add(activeId);
  cancelled.delete(id);
  activeId = id;
  const shouldStop = () => cancelled.has(id) || activeId !== id;

  try {
    const result = await engineRouter.search(
      position,
      { ...request.options, shouldStop },
      (progress) => {
        if (shouldStop()) return;
        const message: MorrisProgressMessage = {
          type: "progress",
          id,
          ...progress,
        };
        workerScope.postMessage(message);
      },
    );

    if (shouldStop()) {
      const message: MorrisCancelledMessage = { type: "cancelled", id };
      workerScope.postMessage(message);
    } else {
      const message: MorrisResultMessage = { type: "result", id, ...result };
      workerScope.postMessage(message);
    }
  } catch (error) {
    if (shouldStop()) {
      const message: MorrisCancelledMessage = { type: "cancelled", id };
      workerScope.postMessage(message);
    } else {
      const message: MorrisErrorMessage = {
        type: "error",
        id,
        message: error instanceof Error ? error.message : String(error),
      };
      workerScope.postMessage(message);
    }
  } finally {
    cancelled.delete(id);
    if (activeId === id) activeId = null;
  }
}

export {};
