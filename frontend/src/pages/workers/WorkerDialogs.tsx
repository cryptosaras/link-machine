import { useEffect, useRef, useState } from "react";
import { Copy, Check, X } from "lucide-react";
import api from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Worker } from "./types";

/* ─── Add Worker Dialog ─── */

interface AddWorkerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (apiKey: string) => void;
}

export function AddWorkerDialog({ open, onOpenChange, onCreated }: AddWorkerDialogProps) {
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formUser, setFormUser] = useState("root");
  const [formPort, setFormPort] = useState("22");
  const [formAuthType, setFormAuthType] = useState<"password" | "key">("password");
  const [formPassword, setFormPassword] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  const resetForm = () => {
    setFormName("");
    setFormHost("");
    setFormUser("root");
    setFormPort("22");
    setFormAuthType("password");
    setFormPassword("");
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
      onCreated(res.data.api_key);
      resetForm();
      onOpenChange(false);
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
  );
}

/* ─── Delete Confirmation Dialog ─── */

interface DeleteDialogProps {
  open: boolean;
  worker: Worker | null;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}

export function DeleteWorkerDialog({ open, worker, onClose, onConfirm, deleting }: DeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Worker</DialogTitle>
          <DialogDescription>This action cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-4">
          <p className="text-sm text-foreground-secondary">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-foreground">{worker?.name}</span>?
            This will remove the worker from the system. The VPS itself will not be
            affected, but the worker will stop receiving tasks.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete Worker"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Install / Reset Log Dialog ─── */

interface LogDialogProps {
  open: boolean;
  title: string;
  lines: string[];
  done: boolean;
  onClose: () => void;
}

export function LogDialog({ open, title, lines, done, onClose }: LogDialogProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Live output from worker operation.</DialogDescription>
        </DialogHeader>
        <div className="mt-2 h-96 overflow-y-auto rounded-md border border-[var(--border)] bg-gray-950 p-4 font-mono text-xs text-green-400">
          {lines.map((line, i) => {
            let className = "";
            if (line.startsWith("__DONE__")) className = "text-green-300 font-bold";
            else if (line.startsWith("__ERROR__")) className = "text-red-400 font-bold";
            else if (line.startsWith("[stderr]")) className = "text-yellow-400";
            else if (line.startsWith("===")) className = "text-blue-400 font-bold";
            const display = line.replace(/^__DONE__ /, "").replace(/^__ERROR__ /, "");
            return (
              <div key={i} className={className}>
                {display}
              </div>
            );
          })}
          <div ref={logEndRef} />
        </div>
        {done && (
          <div className="mt-3 flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Worker Logs Dialog ─── */

interface WorkerLogDialogProps {
  open: boolean;
  workerName: string;
  lines: string[];
  onClose: () => void;
}

export function WorkerLogDialog({ open, workerName, lines, onClose }: WorkerLogDialogProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Worker Logs — {workerName}</DialogTitle>
          <DialogDescription>
            Live output from worker process. Shows recent history and streams new lines.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 h-[28rem] overflow-y-auto rounded-md border border-[var(--border)] bg-gray-950 p-4 font-mono text-xs text-gray-300">
          {lines.length === 0 ? (
            <div className="flex h-full items-center justify-center text-foreground-muted">
              No logs yet. Waiting for worker output...
            </div>
          ) : (
            lines.map((line, i) => {
              let className = "text-gray-300";
              if (line.startsWith("[stderr]")) className = "text-yellow-400";
              else if (line.startsWith("[scrape]")) className = "text-cyan-400";
              else if (line.includes("error") || line.includes("Error") || line.includes("failed"))
                className = "text-red-400";
              else if (line.startsWith("Heartbeat OK")) className = "text-green-500/60";
              else if (line.startsWith("Received task") || line.startsWith("Running plugin"))
                className = "text-blue-400 font-medium";
              else if (line.startsWith("Task finished") || line.includes("completed"))
                className = "text-green-400 font-medium";
              return (
                <div key={i} className={className}>
                  {line}
                </div>
              );
            })
          )}
          <div ref={logEndRef} />
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Login Details Dialog ─── */

interface WorkerCredentials {
  ssh_host: string;
  ssh_user: string;
  ssh_port: number;
  ssh_password: string | null;
  ssh_key: string | null;
  api_key: string;
}

interface LoginDetailsDialogProps {
  open: boolean;
  worker: Worker | null;
  onClose: () => void;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs text-foreground-muted">{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border border-[var(--border)] bg-surface-tertiary px-3 py-1.5 text-xs font-mono text-foreground break-all">
          {value}
        </code>
        <Button variant="ghost" size="icon" onClick={handleCopy} className="shrink-0 h-8 w-8">
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export function LoginDetailsDialog({ open, worker, onClose }: LoginDetailsDialogProps) {
  const [creds, setCreds] = useState<WorkerCredentials | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && worker) {
      setLoading(true);
      setCreds(null);
      api
        .get(`/workers/${worker.id}/credentials`)
        .then((res) => setCreds(res.data))
        .catch(() => setCreds(null))
        .finally(() => setLoading(false));
    }
  }, [open, worker]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Login Details — {worker?.name}</DialogTitle>
          <DialogDescription>SSH credentials and API key for this worker.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-foreground-muted text-sm">
            Loading credentials...
          </div>
        ) : creds ? (
          <div className="mt-2 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <CopyField label="Host" value={creds.ssh_host} />
              <CopyField label="User" value={creds.ssh_user} />
              <CopyField label="Port" value={String(creds.ssh_port)} />
            </div>
            {creds.ssh_password && <CopyField label="Password" value={creds.ssh_password} />}
            {creds.ssh_key && (
              <div className="space-y-1">
                <Label className="text-xs text-foreground-muted">SSH Key</Label>
                <pre className="max-h-32 overflow-y-auto rounded-md border border-[var(--border)] bg-surface-tertiary px-3 py-2 text-[10px] font-mono text-foreground-secondary whitespace-pre-wrap break-all">
                  {creds.ssh_key}
                </pre>
              </div>
            )}
            <CopyField label="API Key" value={creds.api_key} />
            <CopyField
              label="SSH Command"
              value={`ssh ${creds.ssh_user}@${creds.ssh_host} -p ${creds.ssh_port}`}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-red-400 text-sm">
            Failed to load credentials.
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── API Key Banner ─── */

interface ApiKeyBannerProps {
  apiKey: string;
  onDismiss: () => void;
}

export function ApiKeyBanner({ apiKey, onDismiss }: ApiKeyBannerProps) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-yellow-700 dark:bg-yellow-950">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-yellow-200">
            Worker API Key (shown once, save it if needed):
          </p>
          <code className="mt-1 block text-xs text-amber-700 dark:text-yellow-300">
            {apiKey}
          </code>
        </div>
        <Button variant="ghost" size="icon" onClick={onDismiss}>
          <X className="h-4 w-4 text-amber-600 dark:text-yellow-400" />
        </Button>
      </div>
    </div>
  );
}
