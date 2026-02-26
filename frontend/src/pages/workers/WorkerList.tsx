import { useEffect, useRef, useState, useCallback } from "react";
import {
  Download,
  Plus,
  RefreshCw,
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
  if (!codeHash) return <span className="text-gray-600 text-xs">n/a</span>;
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono ${
        needsUpdate
          ? "bg-orange-900 text-orange-300"
          : "bg-green-900 text-green-300"
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
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logDone, setLogDone] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Terminal drawer state
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalWorkerId, setTerminalWorkerId] = useState<string | null>(null);
  const [terminalWorkerName, setTerminalWorkerName] = useState("");
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalWsRef = useRef<WebSocket | null>(null);

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
    const interval = setInterval(fetchWorkers, 15000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

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
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
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
        payload.ssh_key = formKey;
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

  const handleDelete = async (id: string) => {
    await api.delete(`/workers/${id}`);
    fetchWorkers();
  };

  const handleInstall = async (workerId: string) => {
    try {
      await api.post(`/workers/${workerId}/install`);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Install failed to start";
      alert(msg);
      return;
    }

    setLogLines([]);
    setLogDone(false);
    setLogWorkerId(workerId);
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
        <div className="rounded-lg border border-yellow-700 bg-yellow-950 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-yellow-200">
                Worker API Key (shown once, save it if needed):
              </p>
              <code className="mt-1 block text-xs text-yellow-300">
                {createdApiKey}
              </code>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCreatedApiKey(null)}
            >
              <X className="h-4 w-4 text-yellow-400" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Workers</h1>
          {outdatedCount > 0 && (
            <span className="rounded-full bg-orange-900 px-2.5 py-0.5 text-xs font-medium text-orange-300">
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
                          ? "bg-white text-gray-900"
                          : "bg-gray-800 text-gray-400 hover:text-white"
                      }`}
                    >
                      Password
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormAuthType("key")}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        formAuthType === "key"
                          ? "bg-white text-gray-900"
                          : "bg-gray-800 text-gray-400 hover:text-white"
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
                  <div className="space-y-2">
                    <Label htmlFor="w-key">Private Key (PEM)</Label>
                    <textarea
                      id="w-key"
                      value={formKey}
                      onChange={(e) => setFormKey(e.target.value)}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                      required
                      rows={5}
                      className="flex w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-300 font-mono"
                    />
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
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-800 bg-gray-900 py-16">
          <Server className="mb-4 h-12 w-12 text-gray-600" />
          <p className="text-gray-400">
            No workers yet. Add your first worker to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-800 bg-gray-900">
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="px-4 py-3 text-left font-medium text-gray-400">
                  Name
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">
                  Host
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">
                  Version
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-400">
                  Last Heartbeat
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {workers.map((w) => (
                <tr key={w.id} className="bg-gray-950 hover:bg-gray-900">
                  <td className="px-3 py-3">
                    {w.needs_update && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(w.id)}
                        onChange={() => toggleSelect(w.id)}
                        className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-white accent-white"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-white">
                    {w.name}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {w.ssh_user}@{w.ssh_host}:{w.ssh_port}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot status={w.status} />
                      <span className="text-gray-300 capitalize">
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
                  <td className="px-4 py-3 text-gray-400">
                    {formatTimeAgo(w.last_heartbeat)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
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
                        size="icon"
                        onClick={() => handleDelete(w.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-gray-400 hover:text-red-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Install Log Dialog */}
      <Dialog open={logOpen} onOpenChange={(open) => !open && closeLog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Install Log</DialogTitle>
            <DialogDescription>
              Live output from worker installation.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 h-96 overflow-y-auto rounded-md border border-gray-700 bg-black p-4 font-mono text-xs text-green-400">
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

      {/* Terminal Side Drawer */}
      {terminalOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeTerminal}
          />
          {/* Drawer */}
          <div className="relative flex h-full w-[70%] min-w-[500px] flex-col bg-gray-950 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <TerminalIcon className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-white">
                  Terminal — {terminalWorkerName}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={closeTerminal}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {/* Terminal container */}
            <div
              ref={terminalRef}
              className="flex-1 p-2"
              style={{ backgroundColor: "#0a0a0a" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
