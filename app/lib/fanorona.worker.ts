/// <reference lib="webworker" />

import {
  searchBestMoves,
  type FanoronaPosition,
  type SearchOptions,
  type SearchProgress,
  type SearchResult,
} from "./fanorona";

export type SearchRequestId = string | number;

export interface FanoronaSearchRequest {
  type: "search";
  id: SearchRequestId;
  position: FanoronaPosition;
  options?: Omit<SearchOptions, "shouldStop">;
}

export interface FanoronaCancelRequest {
  type: "cancel";
  id?: SearchRequestId;
}

export type FanoronaWorkerRequest =
  | FanoronaSearchRequest
  | FanoronaCancelRequest;

export interface FanoronaProgressMessage extends SearchProgress {
  type: "progress";
  id: SearchRequestId;
}

/** SearchResult is spread at the top level so `message.topMoves` is direct. */
export interface FanoronaResultMessage extends SearchResult {
  type: "result";
  id: SearchRequestId;
}

export interface FanoronaErrorMessage {
  type: "error";
  id: SearchRequestId;
  message: string;
}

export interface FanoronaCancelledMessage {
  type: "cancelled";
  id: SearchRequestId;
}

export type FanoronaWorkerResponse =
  | FanoronaProgressMessage
  | FanoronaResultMessage
  | FanoronaErrorMessage
  | FanoronaCancelledMessage;

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
const cancelled = new Set<SearchRequestId>();
let activeId: SearchRequestId | null = null;

workerScope.onmessage = (event: MessageEvent<FanoronaWorkerRequest>) => {
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

  // The engine checks the flag cooperatively. For immediate cancellation of a
  // very deep in-flight iteration, callers may also terminate and recreate the
  // inexpensive worker.
  const shouldStop = () => cancelled.has(id) || activeId !== id;

  try {
    const result = searchBestMoves(
      position,
      { ...request.options, shouldStop },
      (progress) => {
        const message: FanoronaProgressMessage = {
          type: "progress",
          id,
          ...progress,
        };
        workerScope.postMessage(message);
      },
    );

    if (cancelled.has(id)) {
      const message: FanoronaCancelledMessage = { type: "cancelled", id };
      workerScope.postMessage(message);
    } else {
      const message: FanoronaResultMessage = { type: "result", id, ...result };
      workerScope.postMessage(message);
    }
  } catch (error) {
    const message: FanoronaErrorMessage = {
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
