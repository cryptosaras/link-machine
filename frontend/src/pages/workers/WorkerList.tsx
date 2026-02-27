import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, RefreshCw, Server } from "lucide-react";
import api from "@/api/client";
import { Button } from "@/components/ui/button";
import type { Worker } from "./types";
import WorkerTable from "./WorkerTable";
import WorkerTerminal from "./WorkerTerminal";
import {
  AddWorkerDialog,
  ApiKeyBanner,
  DeleteWorkerDialog,
  LogDialog,
  WorkerLogDialog,
} from "./WorkerDialogs";

export default function WorkerList() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState(false);

  // Dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Worker | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Install/reset log state
  const [logOpen, setLogOpen] = useState(false);
  const [logTitle, setLogTitle] = useState("Install Log");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logDone, setLogDone] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Worker logs state
  const [workerLogOpen, setWorkerLogOpen] = useState(false);
  const [workerLogWorkerName, setWorkerLogWorkerName] = useState("");
  const [workerLogLines, setWorkerLogLines] = useState<string[]>([]);
  const workerLogWsRef = useRef<WebSocket | null>(null);

  // Terminal state
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalWorkerId, setTerminalWorkerId] = useState<string | null>(null);
  const [terminalWorkerName, setTerminalWorkerName] = useState("");

  const fetchWorkers = async () => {
    const res = await api.get("/workers");
    setWorkers(res.data);
  };

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 5000);
    return () => clearInterval(interval);
  }, []);

  /* ─── Selection ─── */
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchUpdate = async () => {
    if (selectedIds.size === 0) return;
    setUpdating(true);
    try {
      await api.post("/workers/batch-update", { worker_ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
      fetchWorkers();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Batch update failed");
    } finally {
      setUpdating(false);
    }
  };

  /* ─── Install / Reset log ─── */
  const openLogWs = (workerId: string, title: string) => {
    setLogLines([]);
    setLogDone(false);
    setLogTitle(title);
    setLogOpen(true);

    const token = localStorage.getItem("access_token");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/install/${workerId}?token=${token}`
    );
    wsRef.current = ws;
    ws.onmessage = (event) => {
      setLogLines((prev) => [...prev, event.data]);
      if (event.data.startsWith("__DONE__") || event.data.startsWith("__ERROR__")) {
        setLogDone(true);
        fetchWorkers();
      }
    };
    ws.onerror = () => {
      setLogLines((prev) => [...prev, "__ERROR__ WebSocket connection failed"]);
      setLogDone(true);
    };
    ws.onclose = () => setLogDone(true);
  };

  const closeLog = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setLogOpen(false);
    setLogLines([]);
    setLogDone(false);
    fetchWorkers();
  };

  const handleInstall = async (workerId: string) => {
    try {
      await api.post(`/workers/${workerId}/install`);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Install failed to start");
      return;
    }
    openLogWs(workerId, "Install Log");
  };

  const handleReset = async (workerId: string) => {
    try {
      await api.post(`/workers/${workerId}/reset`);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Reset failed to start");
      return;
    }
    openLogWs(workerId, "Reset Log");
  };

  /* ─── Worker logs ─── */
  const openWorkerLogs = (workerId: string, workerName: string) => {
    setWorkerLogLines([]);
    setWorkerLogWorkerName(workerName);
    setWorkerLogOpen(true);

    const token = localStorage.getItem("access_token");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/worker-logs/${workerId}?token=${token}`
    );
    workerLogWsRef.current = ws;
    ws.onmessage = (event) => setWorkerLogLines((prev) => [...prev, event.data]);
    ws.onerror = () =>
      setWorkerLogLines((prev) => [...prev, "[error] WebSocket connection failed"]);
  };

  const closeWorkerLogs = () => {
    workerLogWsRef.current?.close();
    workerLogWsRef.current = null;
    setWorkerLogOpen(false);
    setWorkerLogWorkerName("");
    setWorkerLogLines([]);
  };

  /* ─── Delete ─── */
  const handleDeleteClick = (worker: Worker) => {
    setDeleteTarget(worker);
    setDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/workers/${deleteTarget.id}`);
      setDeleteOpen(false);
      setDeleteTarget(null);
      fetchWorkers();
    } finally {
      setDeleting(false);
    }
  };

  /* ─── Terminal ─── */
  const openTerminal = useCallback((workerId: string, workerName: string) => {
    setTerminalWorkerId(workerId);
    setTerminalWorkerName(workerName);
    setTerminalOpen(true);
  }, []);

  const closeTerminal = () => {
    setTerminalOpen(false);
    setTerminalWorkerId(null);
    setTerminalWorkerName("");
  };

  const outdatedCount = workers.filter((w) => w.needs_update).length;

  return (
    <div className="space-y-6">
      {createdApiKey && (
        <ApiKeyBanner apiKey={createdApiKey} onDismiss={() => setCreatedApiKey(null)} />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Workers</h1>
          {outdatedCount > 0 && (
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900 dark:text-orange-300">
              {outdatedCount} outdated
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button variant="outline" onClick={handleBatchUpdate} disabled={updating}>
              <RefreshCw className={`h-4 w-4 ${updating ? "animate-spin" : ""}`} />
              Update Selected ({selectedIds.size})
            </Button>
          )}
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Worker
          </Button>
        </div>
      </div>

      {workers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-surface-secondary py-16">
          <Server className="mb-4 h-12 w-12 text-foreground-muted" />
          <p className="text-foreground-secondary">
            No workers yet. Add your first worker to get started.
          </p>
        </div>
      ) : (
        <WorkerTable
          workers={workers}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onInstall={handleInstall}
          onReset={handleReset}
          onDelete={handleDeleteClick}
          onOpenTerminal={openTerminal}
          onOpenLogs={openWorkerLogs}
        />
      )}

      <AddWorkerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(key) => {
          setCreatedApiKey(key);
          fetchWorkers();
        }}
      />

      <DeleteWorkerDialog
        open={deleteOpen}
        worker={deleteTarget}
        onClose={() => {
          setDeleteOpen(false);
          setDeleteTarget(null);
        }}
        onConfirm={handleDeleteConfirm}
        deleting={deleting}
      />

      <LogDialog
        open={logOpen}
        title={logTitle}
        lines={logLines}
        done={logDone}
        onClose={closeLog}
      />

      <WorkerLogDialog
        open={workerLogOpen}
        workerName={workerLogWorkerName}
        lines={workerLogLines}
        onClose={closeWorkerLogs}
      />

      {terminalOpen && terminalWorkerId && (
        <WorkerTerminal
          workerId={terminalWorkerId}
          workerName={terminalWorkerName}
          onClose={closeTerminal}
        />
      )}
    </div>
  );
}
