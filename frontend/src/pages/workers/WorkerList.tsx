import { useEffect, useRef, useState, useCallback } from "react";
import {
  Download,
  FileText,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import api from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";

interface WorkerCurrentTask {
  id: string;
  task_type: string;
  status: string;
  website_name: string | null;
  progress: Record<string, unknown>;
  started_at: string | null;
}

interface Worker {
  id: string;
  name: string;
  ssh_host: string;
  ssh_user: string;
  ssh_port: number;
  status: string;
  last_heartbeat: string | null;
  system_stats: Record<string, unknown>;
  code_hash: string | null;
  needs_update: boolean;
  current_task: WorkerCurrentTask | null;
  created_at: string;
  api_key?: string;
}

function StatusDot({ status }: { status: string }) {
  const styles: Record<string, string> = {
    online: "bg-green-500",
    offline: "bg-gray-500",
    provisioning: "bg-yellow-500 animate-pulse",
    error: "bg-red-500",
  };
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${styles[status] || styles.offline}`}
    />
  );
}

function VersionBadge({
  codeHash,
  needsUpdate,
}: {
  codeHash: string | null;
  needsUpdate: boolean;
}) {
  if (!codeHash) return <span className="text-foreground-muted text-xs">n/a</span>;
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono ${
        needsUpdate
          ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"
          : "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
      }`}
    >
      {codeHash}
    </span>
  );
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function WorkerList() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logWorkerId, setLogWorkerId] = useState<string | null>(null);
  const [logTitle, setLogTitle] = useState("Install Log");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logDone, setLogDone] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Worker | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Terminal drawer state
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalWorkerId, setTerminalWorkerId] = useState<string | null>(null);
  const [terminalWorkerName, setTerminalWorkerName] = useState("");
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalWsRef = useRef<WebSocket | null>(null);

  // Worker logs state
  const [workerLogOpen, setWorkerLogOpen] = useState(false);
  const [workerLogWorkerId, setWorkerLogWorkerId] = useState<string | null>(null);
  const [workerLogWorkerName, setWorkerLogWorkerName] = useState("");
  const [workerLogLines, setWorkerLogLines] = useState<string[]>([]);
  const workerLogWsRef = useRef<WebSocket | null>(null);
  const workerLogEndRef = useRef<HTMLDivElement>(null);

  // Add worker form state
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formUser, setFormUser] = useState("root");
  const [formPort, setFormPort] = useState("22");
  const [formAuthType, setFormAuthType] = useState<"password" | "key">(
    "password"
  );
  const [formPassword, setFormPassword] = useState("");
  const [formKey, setFormKey] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  const fetchWorkers = async () => {
    const res = await api.get("/workers");
    const data: Worker[] = res.data;
    setWorkers(data);
    // Prune selected IDs that are no longer outdated
    const updatableIds = new Set(data.filter((w) => w.needs_update).map((w) => w.id));
    setSelectedIds((prev) => {
      const pruned = new Set([...prev].filter((id) => updatableIds.has(id)));
      return pruned.size !== prev.size ? pruned : prev;
    });
  };

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  // Auto-scroll worker logs
  useEffect(() => {
    workerLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [workerLogLines]);

  // Terminal setup/teardown
  const openTerminal = useCallback((workerId: string, workerName: string) => {
    setTerminalWorkerId(workerId);
    setTerminalWorkerName(workerName);
    setTerminalOpen(true);
  }, []);

  useEffect(() => {
    if (!terminalOpen || !terminalRef.current || !terminalWorkerId) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#0d0d0d",
        foreground: "#d4d4d8",
        cursor: "#10b981",
        cursorAccent: "#0d0d0d",
        selectionBackground: "#10b98133",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);

    // Small delay to ensure DOM is ready before fitting
    setTimeout(() => fitAddon.fit(), 50);

    terminalInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    const token = localStorage.getItem("access_token");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal/${terminalWorkerId}?token=${token}`;
    const ws = new WebSocket(wsUrl);
    terminalWsRef.current = ws;

    ws.onopen = () => {
      // Send initial terminal size
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: dims.cols,
            rows: dims.rows,
          })
        );
      }
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31mWebSocket connection failed\x1b[0m\r\n");
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[33mConnection closed\x1b[0m\r\n");
    };

    // Send keystrokes to WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: dims.cols,
            rows: dims.rows,
          })
        );
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      ws.close();
      term.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
      terminalWsRef.current = null;
    };
  }, [terminalOpen, terminalWorkerId]);

  const closeTerminal = () => {
    setTerminalOpen(false);
    setTerminalWorkerId(null);
    setTerminalWorkerName("");
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    try {
      const payload: Record<string, unknown> = {
        name: formName,
        ssh_host: formHost,
        ssh_user: formUser,
        ssh_port: parseInt(formPort),
      };
      if (formAuthType === "password") {
        payload.ssh_password = formPassword;
      } else {
        payload.use_saved_key = true;
      }
      const res = await api.post("/workers", payload);
      setCreatedApiKey(res.data.api_key);
      resetForm();
      setAddOpen(false);
      fetchWorkers();
    } finally {
      setFormLoading(false);
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormHost("");
    setFormUser("root");
    setFormPort("22");
    setFormAuthType("password");
    setFormPassword("");
    setFormKey("");
  };

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

  const openLogDialog = (workerId: string, title: string) => {
    setLogLines([]);
    setLogDone(false);
    setLogWorkerId(workerId);
    setLogTitle(title);
    setLogOpen(true);

    const token = localStorage.getItem("access_token");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/install/${workerId}?token=${token}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const line = event.data;
      setLogLines((prev) => [...prev, line]);
      if (line.startsWith("__DONE__") || line.startsWith("__ERROR__")) {
        setLogDone(true);
        fetchWorkers();
      }
    };

    ws.onerror = () => {
      setLogLines((prev) => [
        ...prev,
        "__ERROR__ WebSocket connection failed",
      ]);
      setLogDone(true);
    };

    ws.onclose = () => {
      setLogDone(true);
    };
  };

  const handleInstall = async (workerId: string) => {
    try {
      await api.post(`/workers/${workerId}/install`);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Install failed to start";
      alert(msg);
      return;
    }
    openLogDialog(workerId, "Install Log");
  };

  const handleReset = async (workerId: string) => {
    try {
      await api.post(`/workers/${workerId}/reset`);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Reset failed to start";
      alert(msg);
      return;
    }
    openLogDialog(workerId, "Reset Log");
  };

  const closeLog = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setLogOpen(false);
    setLogWorkerId(null);
    setLogLines([]);
    setLogDone(false);
    fetchWorkers();
  };

  const openWorkerLogs = (workerId: string, workerName: string) => {
    setWorkerLogLines([]);
    setWorkerLogWorkerId(workerId);
    setWorkerLogWorkerName(workerName);
    setWorkerLogOpen(true);

    const token = localStorage.getItem("access_token");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/worker-logs/${workerId}?token=${token}`;
    const ws = new WebSocket(wsUrl);
    workerLogWsRef.current = ws;

    ws.onmessage = (event) => {
      setWorkerLogLines((prev) => [...prev, event.data]);
    };

    ws.onerror = () => {
      setWorkerLogLines((prev) => [...prev, "[error] WebSocket connection failed"]);
    };
  };

  const closeWorkerLogs = () => {
    if (workerLogWsRef.current) {
      workerLogWsRef.current.close();
      workerLogWsRef.current = null;
    }
    setWorkerLogOpen(false);
    setWorkerLogWorkerId(null);
    setWorkerLogWorkerName("");
    setWorkerLogLines([]);
  };

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
      await api.post("/workers/batch-update", {
        worker_ids: Array.from(selectedIds),
      });
      setSelectedIds(new Set());
      fetchWorkers();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Batch update failed";
      alert(msg);
    } finally {
      setUpdating(false);
    }
  };

  const outdatedCount = workers.filter((w) => w.needs_update).length;

  return (
    <div className="space-y-6">
      {/* API Key display after creation */}
      {createdApiKey && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-yellow-700 dark:bg-yellow-950">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-yellow-200">
                Worker API Key (shown once, save it if needed):
              </p>
              <code className="mt-1 block text-xs text-amber-700 dark:text-yellow-300">
                {createdApiKey}
              </code>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCreatedApiKey(null)}
            >
              <X className="h-4 w-4 text-amber-600 dark:text-yellow-400" />
            </Button>
          </div>
        </div>
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
            <Button
              variant="outline"
              onClick={handleBatchUpdate}
              disabled={updating}
            >
              <RefreshCw
                className={`h-4 w-4 ${updating ? "animate-spin" : ""}`}
              />
              Update Selected ({selectedIds.size})
            </Button>
          )}
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                Add Worker
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Worker</DialogTitle>
                <DialogDescription>
                  Enter the SSH details for the worker VPS.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAdd} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="w-name">Name</Label>
                  <Input
                    id="w-name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Worker US-1"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="w-host">SSH Host</Label>
                    <Input
                      id="w-host"
                      value={formHost}
                      onChange={(e) => setFormHost(e.target.value)}
                      placeholder="123.45.67.89"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="w-user">User</Label>
                      <Input
                        id="w-user"
                        value={formUser}
                        onChange={(e) => setFormUser(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="w-port">Port</Label>
                      <Input
                        id="w-port"
                        type="number"
                        value={formPort}
                        onChange={(e) => setFormPort(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Authentication</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormAuthType("password")}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        formAuthType === "password"
                          ? "bg-accent text-accent-foreground"
                          : "bg-surface-tertiary text-foreground-secondary hover:text-foreground"
                      }`}
                    >
                      Password
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormAuthType("key")}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        formAuthType === "key"
                          ? "bg-accent text-accent-foreground"
                          : "bg-surface-tertiary text-foreground-secondary hover:text-foreground"
                      }`}
                    >
                      SSH Key
                    </button>
                  </div>
                </div>

                {formAuthType === "password" ? (
                  <div className="space-y-2">
                    <Label htmlFor="w-password">Password</Label>
                    <Input
                      id="w-password"
                      type="password"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="SSH password"
                      required
                    />
                  </div>
                ) : (
                  <div className="rounded-md border border-[var(--border)] bg-surface-tertiary px-3 py-2.5">
                    <p className="text-sm text-foreground-secondary">
                      Will use the SSH private key saved in Settings.
                    </p>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={formLoading}>
                  {formLoading ? "Adding..." : "Add Worker"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Workers table */}
      {workers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-surface-secondary py-16">
          <Server className="mb-4 h-12 w-12 text-foreground-muted" />
          <p className="text-foreground-secondary">
            No workers yet. Add your first worker to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] bg-surface-secondary">
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Name
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Host
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Version
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Current Task
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Last Heartbeat
                </th>
                <th className="px-4 py-3 text-right font-medium text-foreground-secondary">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {workers.map((w) => (
                <tr key={w.id} className="bg-surface hover:bg-surface-tertiary">
                  <td className="px-3 py-3">
                    {w.needs_update && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(w.id)}
                        onChange={() => toggleSelect(w.id)}
                        className="h-4 w-4 rounded accent-accent"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {w.name}
                  </td>
                  <td className="px-4 py-3 text-foreground-secondary">
                    {w.ssh_user}@{w.ssh_host}:{w.ssh_port}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot status={w.status} />
                      <span className="text-foreground-secondary capitalize">
                        {w.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <VersionBadge
                      codeHash={w.code_hash}
                      needsUpdate={w.needs_update}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {w.current_task ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                          <span className="text-xs font-medium text-foreground">
                            {w.current_task.task_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                          </span>
                          {w.current_task.website_name && (
                            <span className="text-xs text-foreground-muted">
                              — {w.current_task.website_name}
                            </span>
                          )}
                        </div>
                        {w.current_task.progress && Object.keys(w.current_task.progress).length > 0 && (
                          <span className="text-[10px] text-foreground-muted">
                            {w.current_task.progress.pages_fetched !== undefined && `${w.current_task.progress.pages_fetched} pages`}
                            {w.current_task.progress.links_found !== undefined && ` · ${w.current_task.progress.links_found} links`}
                            {w.current_task.progress.rate !== undefined && ` · ${w.current_task.progress.rate}`}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-foreground-muted">Idle</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {formatTimeAgo(w.last_heartbeat)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openWorkerLogs(w.id, w.name)}
                        title="View logs"
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openTerminal(w.id, w.name)}
                        title="Open terminal"
                      >
                        <TerminalIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleInstall(w.id)}
                        disabled={w.status === "provisioning"}
                        title="Install/update worker"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleReset(w.id)}
                        disabled={w.status === "provisioning"}
                        title="Reset worker (restart container)"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteClick(w)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-foreground-muted hover:text-red-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={(open) => { if (!open) { setDeleteOpen(false); setDeleteTarget(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Worker</DialogTitle>
            <DialogDescription>
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <p className="text-sm text-foreground-secondary">
              Are you sure you want to delete{" "}
              <span className="font-semibold text-foreground">
                {deleteTarget?.name}
              </span>
              ? This will remove the worker from the system. The VPS itself will not be affected, but the worker will stop receiving tasks.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setDeleteOpen(false); setDeleteTarget(null); }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Worker"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Install / Reset Log Dialog */}
      <Dialog open={logOpen} onOpenChange={(open) => !open && closeLog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{logTitle}</DialogTitle>
            <DialogDescription>
              Live output from worker operation.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 h-96 overflow-y-auto rounded-md border border-[var(--border)] bg-gray-950 p-4 font-mono text-xs text-green-400">
            {logLines.map((line, i) => {
              let className = "";
              if (line.startsWith("__DONE__")) {
                className = "text-green-300 font-bold";
              } else if (line.startsWith("__ERROR__")) {
                className = "text-red-400 font-bold";
              } else if (line.startsWith("[stderr]")) {
                className = "text-yellow-400";
              } else if (line.startsWith("===")) {
                className = "text-blue-400 font-bold";
              }
              const display = line
                .replace(/^__DONE__ /, "")
                .replace(/^__ERROR__ /, "");
              return (
                <div key={i} className={className}>
                  {display}
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
          {logDone && (
            <div className="mt-3 flex justify-end">
              <Button onClick={closeLog}>Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Worker Logs Dialog */}
      <Dialog open={workerLogOpen} onOpenChange={(open) => !open && closeWorkerLogs()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Worker Logs — {workerLogWorkerName}</DialogTitle>
            <DialogDescription>
              Live output from worker process. Shows recent history and streams new lines.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 h-[28rem] overflow-y-auto rounded-md border border-[var(--border)] bg-gray-950 p-4 font-mono text-xs text-gray-300">
            {workerLogLines.length === 0 ? (
              <div className="flex h-full items-center justify-center text-foreground-muted">
                No logs yet. Waiting for worker output...
              </div>
            ) : (
              workerLogLines.map((line, i) => {
                let className = "text-gray-300";
                if (line.startsWith("[stderr]")) {
                  className = "text-yellow-400";
                } else if (line.startsWith("[scrape]")) {
                  className = "text-cyan-400";
                } else if (line.includes("error") || line.includes("Error") || line.includes("failed")) {
                  className = "text-red-400";
                } else if (line.startsWith("Heartbeat OK")) {
                  className = "text-green-500/60";
                } else if (line.startsWith("Received task") || line.startsWith("Running plugin")) {
                  className = "text-blue-400 font-medium";
                } else if (line.startsWith("Task finished") || line.includes("completed")) {
                  className = "text-green-400 font-medium";
                }
                return (
                  <div key={i} className={className}>
                    {line}
                  </div>
                );
              })
            )}
            <div ref={workerLogEndRef} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={closeWorkerLogs}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Terminal Side Drawer */}
      {terminalOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeTerminal}
          />
          {/* Drawer */}
          <div
            className="relative flex h-full w-[70%] min-w-[500px] flex-col border-l-2 border-emerald-500/50 shadow-2xl"
            style={{ backgroundColor: "#111118" }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{
                background:
                  "linear-gradient(to right, rgba(16, 185, 129, 0.12), transparent)",
                borderBottom: "1px solid rgba(16, 185, 129, 0.25)",
              }}
            >
              <div className="flex items-center gap-3">
                {/* Traffic light dots */}
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-full bg-red-500/80" />
                  <span className="inline-block h-3 w-3 rounded-full bg-yellow-500/80" />
                  <span className="inline-block h-3 w-3 rounded-full bg-green-500/80" />
                </div>
                <div className="mx-2 h-4 w-px bg-gray-700" />
                <TerminalIcon className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-50">
                  {terminalWorkerName}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={closeTerminal}
                className="text-gray-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {/* Terminal container */}
            <div
              ref={terminalRef}
              className="flex-1 p-1"
              style={{ backgroundColor: "#0d0d0d" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
