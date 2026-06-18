/**
 * Offscreen page script — hosts the Code Wiki parser Web Worker POOL.
 *
 * This page is created at runtime by the service worker via
 * `chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'] })`.
 *
 * Architecture:
 *   - Spawns a POOL of N Web Workers (default 3) — true parallel CPU cores
 *   - Maintains a free/queue dispatcher: assigns each task to the next idle worker
 *   - If all workers busy, queues the task until one becomes available
 *   - Routes results back to the SW with taskId correlation
 *
 * Message protocol (SW ↔ page):
 *   SW → page: { type: 'SEND_TASK', task: <WorkerRequest> }
 *   page → SW: { type: 'TASK_MESSAGE', message: <WorkerResponse> }
 *   SW → page: { type: 'POOL_QUERY' }
 *   page → SW: { type: 'POOL_INFO', size: number, busy: number }
 *
 * The POOL_SIZE is chosen based on navigator.hardwareConcurrency at load.
 */

/// <reference lib="dom" />

// @ts-ignore - Vite's ?worker import adds a runtime suffix TypeScript doesn't know
import ParserWorker from "../../src/code-graph/parser.worker.ts?worker";
import type { WorkerRequest, WorkerResponse } from "../../src/code-graph/parser.worker";

declare const chrome: {
  runtime: {
    sendMessage: (message: unknown) => Promise<void> | void;
    onMessage: {
      addListener: (
        listener: (
          message: { type?: string; task?: WorkerRequest },
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => void | Promise<void>,
      ) => void;
    };
  };
  offscreen?: { Reason?: { WORKERS: "WORKERS" } };
};

const statusEl = document.getElementById("status");
function setStatus(msg: string) {
  console.log("[offscreen]", msg);
  if (statusEl) statusEl.textContent = `offscreen-host: ${msg}`;
}

const HARDWARE_FALLBACK = 4;
const POOL_MIN = 1;
const POOL_MAX = 8;

/** Heartbeat / health-check settings */
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const MAX_RESPAWN_ATTEMPTS = 3;

function choosePoolSize(): number {
  const hw =
    typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : HARDWARE_FALLBACK;
  return Math.max(POOL_MIN, Math.min(POOL_MAX, Math.max(1, Math.floor(hw / 2))));
}

/** A queued task waiting for an idle worker. */
interface PendingTask {
  task: WorkerRequest;
  resolve: (value: void) => void;
  reject: (err: Error) => void;
}

/** Per-worker state: the Worker instance + busy flag. */
interface WorkerSlot {
  worker: Worker;
  busy: boolean;
}

class WorkerPool {
  readonly size: number;
  private slots: WorkerSlot[] = [];
  private queue: PendingTask[] = [];
  /** Map of taskId → the slot currently processing that task (for routing responses) */
  private routing = new Map<string, WorkerSlot>();
  private nextRoundRobin = 0;
  private workerReadyCount = 0;

  constructor(size: number) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      const w = new ParserWorker();
      const slot: WorkerSlot = { worker: w, busy: false };
      this.slots.push(slot);

      w.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        // Heartbeat pong: clear any pending ping timeout
        if ((msg as { type?: string }).type === "PONG") {
          const idx = this.slots.indexOf(slot);
          if (idx >= 0) this.respawnAttempts.set(idx, 0);
          return;
        }
        const taskId = extractTaskId(msg);
        // Track ready signal (from each worker)
        if (msg.type === "ready") {
          this.workerReadyCount++;
          if (this.workerReadyCount === this.size) {
            setStatus(`pool ready (${this.size} workers)`);
            this.drainQueue();
          }
          return;
        }
        // Forward result/progress to SW
        void chrome.runtime.sendMessage({
          type: "TASK_MESSAGE",
          message: msg,
        });
        // Mark slot idle once task completes
        if (
          taskId &&
          (msg.type === "parse_result" ||
            msg.type === "parse_error" ||
            msg.type === "chunk_result" ||
            msg.type === "chunk_error")
        ) {
          const slot = this.routing.get(taskId);
          if (slot) {
            slot.busy = false;
            this.routing.delete(taskId);
            this.drainQueue();
          }
        }
      });

      w.addEventListener("error", (e) => {
        setStatus(`worker ${i} error: ${e.message}`);
        this.handleDeadWorker(i, slot);
      });
    }
    setStatus(`pool spawned (${size} workers, waiting ready...)`);
    this.startHeartbeat();
  }

  /** Periodic heartbeat: ping each idle worker, respawn if no response. */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPings = new Map<number, number>(); // slotIndex → timestamp
  private respawnAttempts = new Map<number, number>(); // slotIndex → count

  private startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i];
        if (!slot || slot.busy) continue; // skip busy workers
        const ts = Date.now();
        this.pendingPings.set(i, ts);
        try {
          slot.worker.postMessage({ type: "PING" });
        } catch {
          this.handleDeadWorker(i, slot);
          continue;
        }
        // Schedule timeout check
        setTimeout(() => {
          if (this.pendingPings.get(i) === ts) {
            // No PONG received within timeout → worker dead
            this.pendingPings.delete(i);
            this.handleDeadWorker(i, slot);
          }
        }, HEARTBEAT_TIMEOUT_MS);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Respawn a dead worker. Replaces slot. Re-queues any tasks it was processing. */
  private handleDeadWorker(slotIndex: number, oldSlot: WorkerSlot) {
    const attempts = this.respawnAttempts.get(slotIndex) ?? 0;
    if (attempts >= MAX_RESPAWN_ATTEMPTS) {
      setStatus(`worker ${slotIndex} dead after ${attempts} respawn attempts`);
      this.slots.splice(slotIndex, 1);
      this.slots.push({ worker: oldSlot.worker, busy: false });
      // Resize slot metadata
      this.routing.forEach((slot, taskId) => {
        if (slot === oldSlot) {
          this.routing.delete(taskId);
          const task = this.queue.find((t) => t.task.taskId === taskId);
          if (task) {
            task.reject(new Error("Worker died; task rejected"));
            this.queue = this.queue.filter((t) => t.task.taskId !== taskId);
          }
        }
      });
      return;
    }
    this.respawnAttempts.set(slotIndex, attempts + 1);
    setStatus(`worker ${slotIndex} dead, respawning (attempt ${attempts + 1})`);

    // Try to terminate old worker cleanly
    try {
      oldSlot.worker.terminate();
    } catch {
      /* ignore */
    }

    // Spawn replacement
    try {
      const newWorker = new ParserWorker();
      const newSlot: WorkerSlot = { worker: newWorker, busy: oldSlot.busy };
      newWorker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        // PONG response → mark healthy
        if ((msg as { type?: string }).type === "PONG") {
          this.respawnAttempts.set(slotIndex, 0);
          return;
        }
        const taskId = extractTaskId(msg);
        if (msg.type === "ready") return;
        void chrome.runtime.sendMessage({
          type: "TASK_MESSAGE",
          message: msg,
        });
        if (
          taskId &&
          (msg.type === "parse_result" ||
            msg.type === "parse_error" ||
            msg.type === "chunk_result" ||
            msg.type === "chunk_error")
        ) {
          newSlot.busy = false;
          this.routing.delete(taskId);
          this.drainQueue();
        }
      });
      newWorker.addEventListener("error", (e) => {
        setStatus(`worker ${slotIndex} respawn error: ${e.message}`);
        this.handleDeadWorker(slotIndex, newSlot);
      });
      this.slots[slotIndex] = newSlot;
      // Don't need ready — worker is alive again
      this.drainQueue();
    } catch (e) {
      setStatus(
        `worker ${slotIndex} respawn failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Enqueue a task; resolves once the task is dispatched to a worker. */
  enqueue(task: WorkerRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.drainQueue();
    });
  }

  /** Idle worker count + total busy count for diagnostics. */
  status(): { size: number; busy: number; queued: number } {
    return {
      size: this.size,
      busy: this.slots.filter((s) => s.busy).length,
      queued: this.queue.length,
    };
  }

  /** If any worker is idle and any task queued, dispatch the next task. */
  private drainQueue() {
    if (this.workerReadyCount < this.size) return;
    while (this.queue.length > 0) {
      const slot = this.nextIdleSlot();
      if (!slot) break;
      const next = this.queue.shift()!;
      slot.busy = true;
      this.routing.set(next.task.taskId, slot);
      try {
        slot.worker.postMessage(next.task);
        next.resolve();
      } catch (e) {
        slot.busy = false;
        this.routing.delete(next.task.taskId);
        next.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  private nextIdleSlot(): WorkerSlot | null {
    if (this.slots.every((s) => s.busy)) return null;
    // Round-robin starting from nextRoundRobin
    for (let i = 0; i < this.size; i++) {
      const idx = (this.nextRoundRobin + i) % this.size;
      const slot = this.slots[idx];
      if (slot && !slot.busy) {
        this.nextRoundRobin = (idx + 1) % this.size;
        return slot;
      }
    }
    return null;
  }
}

function extractTaskId(msg: WorkerResponse): string | undefined {
  switch (msg.type) {
    case "parse_progress":
    case "parse_result":
    case "parse_error":
    case "chunk_progress":
    case "chunk_result":
    case "chunk_error":
    case "search_result":
    case "search_error":
      return msg.taskId;
    default:
      return undefined;
  }
}

const pool = new WorkerPool(choosePoolSize());

// Listen for SW messages
chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "POOL_QUERY") {
    void chrome.runtime.sendMessage({
      type: "POOL_INFO",
      ...pool.status(),
    });
    return;
  }

  if (message.type === "SEND_TASK" && message.task) {
    void pool
      .enqueue(message.task as WorkerRequest)
      .catch((err) => {
        console.error("[offscreen] enqueue failed:", err);
      });
    return;
  }
});

setStatus(`hosting (pool=${pool.size})`);