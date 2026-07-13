/// <reference lib="webworker" />

import {
  searchBestMoves,
  type DraughtsPosition,
  type SearchOptions,
  type SearchProgress,
  type SearchResult,
} from "./draughts";

export type SearchRequestId = string | number;

export interface DraughtsSearchRequest {
  type: "search";
  id: SearchRequestId;
  position: DraughtsPosition;
  options?: Omit<SearchOptions, "shouldStop">;
}

export interface DraughtsCancelRequest {
  type: "cancel";
  id?: SearchRequestId;
}

export type DraughtsWorkerRequest = DraughtsSearchRequest | DraughtsCancelRequest;

export interface DraughtsProgressMessage extends SearchProgress {
  type: "progress";
  id: SearchRequestId;
}

export interface DraughtsResultMessage extends SearchResult {
  type: "result";
  id: SearchRequestId;
}

export interface DraughtsErrorMessage {
  type: "error";
  id: SearchRequestId;
  message: string;
}

export interface DraughtsCancelledMessage {
  type: "cancelled";
  id: SearchRequestId;
}

export type DraughtsWorkerResponse =
  | DraughtsProgressMessage
  | DraughtsResultMessage
  | DraughtsErrorMessage
  | DraughtsCancelledMessage;

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
const cancelled = new Set<SearchRequestId>();
let activeId: SearchRequestId | null = null;

workerScope.onmessage = (event: MessageEvent<DraughtsWorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    if (request.id === undefined) {
      if (activeId !== null) cancelled.add(activeId);
    } else {
      cancelled.add(request.id);
    }
    return;
  }

  const { id, position } = request;
  cancelled.delete(id);
  activeId = id;
  const shouldStop = () => cancelled.has(id) || activeId !== id;

  try {
    const result = searchBestMoves(
      position,
      { ...request.options, shouldStop },
      (progress) => {
        const message: DraughtsProgressMessage = { type: "progress", id, ...progress };
        workerScope.postMessage(message);
      },
    );
    if (cancelled.has(id)) {
      const message: DraughtsCancelledMessage = { type: "cancelled", id };
      workerScope.postMessage(message);
    } else {
      const message: DraughtsResultMessage = { type: "result", id, ...result };
      workerScope.postMessage(message);
    }
  } catch (error) {
    const message: DraughtsErrorMessage = {
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    };
    workerScope.postMessage(message);
  } finally {
    cancelled.delete(id);
    if (activeId === id) activeId = null;
  }
};

export {};
