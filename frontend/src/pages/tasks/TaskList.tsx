import { useEffect, useState, useRef } from "react";
import { ListTodo, RotateCcw, ExternalLink } from "lucide-react";
import api from "@/api/client";

interface Task {
  id: string;
  task_type: string;
  status: string;
  params: Record<string, unknown>;
  progress: Record<string, unknown>;
  result_summary: Record<string, unknown> | null;
  error_message: string | null;
  website_name: string | null;
  worker_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  running: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
};

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "-";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function formatProgress(task: Task): string {
  const p = task.progress;
  if (!p || Object.keys(p).length === 0) {
    if (task.status === "pending") return "Waiting for worker...";
    if (task.status === "completed" && task.result_summary) {
      const r = task.result_summary;
      return `${r.total_links ?? 0} links found`;
    }
    return "-";
  }
  return `${p.pages_fetched ?? 0} pages | ${p.links_found ?? 0} links | ${p.rate ?? ""}`;
}

function taskTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatParamKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatParamValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [links, setLinks] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);
  const wsRefs = useRef<Map<string, WebSocket>>(new Map());

  const fetchTasks = async () => {
    const res = await api.get("/tasks");
    setTasks(res.data);
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, []);

  // Keep selectedTask in sync with live task data
  useEffect(() => {
    if (selectedTask) {
      const updated = tasks.find((t) => t.id === selectedTask.id);
      if (updated) setSelectedTask(updated);
    }
  }, [tasks]);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    tasks.forEach((task) => {
      if (task.status === "running" && !wsRefs.current.has(task.id)) {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(
          `${proto}//${window.location.host}/ws/task/${task.id}?token=${token}`
        );
        wsRefs.current.set(task.id, ws);

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === "progress") {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id ? { ...t, progress: data.progress } : t
              )
            );
          } else if (data.type === "complete") {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id
                  ? {
                      ...t,
                      status: data.status,
                      result_summary: data.result_summary,
                      error_message: data.error_message,
                    }
                  : t
              )
            );
            ws.close();
            wsRefs.current.delete(task.id);
          }
        };

        ws.onclose = () => {
          wsRefs.current.delete(task.id);
        };
      }
    });

    wsRefs.current.forEach((ws, id) => {
      const task = tasks.find((t) => t.id === id);
      if (!task || task.status !== "running") {
        ws.close();
        wsRefs.current.delete(id);
      }
    });

    return () => {
      wsRefs.current.forEach((ws) => ws.close());
      wsRefs.current.clear();
    };
  }, [tasks]);

  const handleRowClick = async (task: Task) => {
    setSelectedTask(task);
    if (task.status === "completed") {
      const res = await api.get(`/tasks/${task.id}/links`);
      setLinks(res.data);
    } else {
      setLinks([]);
    }
  };

  const handleRetry = async () => {
    if (!selectedTask) return;
    setRetrying(true);
    try {
      await api.post(`/tasks/${selectedTask.id}/retry`);
      await fetchTasks();
      setLinks([]);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Tasks</h1>
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-surface-secondary py-16">
          <ListTodo className="mb-4 h-12 w-12 text-foreground-muted" />
          <p className="text-foreground-secondary">
            No tasks yet. Start a scrape from the Websites page.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] bg-surface-secondary">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Type
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Website
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Progress
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Worker
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Duration
                </th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => handleRowClick(task)}
                  className={`cursor-pointer bg-surface hover:bg-surface-tertiary ${
                    selectedTask?.id === task.id ? "ring-1 ring-inset ring-blue-500/40" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {taskTypeLabel(task.task_type)}
                  </td>
                  <td className="px-4 py-3 text-foreground-secondary">
                    {task.website_name || "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[task.status] || ""}`}
                    >
                      {task.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-secondary text-xs">
                    {formatProgress(task)}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted text-xs">
                    {task.worker_name || "-"}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted text-xs">
                    {formatDuration(task.started_at, task.completed_at)}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted text-xs">
                    {new Date(task.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedTask && (
        <div className="rounded-lg border border-[var(--border)] bg-surface-secondary p-5 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-foreground">
                {taskTypeLabel(selectedTask.task_type)}
              </h2>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[selectedTask.status] || ""}`}
              >
                {selectedTask.status}
              </span>
              {selectedTask.website_name && (
                <span className="text-sm text-foreground-muted">
                  {selectedTask.website_name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(selectedTask.status === "failed" || selectedTask.status === "running") && (
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {retrying ? "Retrying..." : "Retry"}
                </button>
              )}
              <button
                onClick={() => setSelectedTask(null)}
                className="text-foreground-muted hover:text-foreground text-sm px-2"
              >
                Close
              </button>
            </div>
          </div>

          {/* Configuration params */}
          {selectedTask.params && Object.keys(selectedTask.params).length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Configuration
              </h3>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {Object.entries(selectedTask.params).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className="text-foreground-muted">{formatParamKey(k)}:</span>
                    <span className="text-foreground font-medium">{formatParamValue(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live progress (when running) */}
          {selectedTask.status === "running" && selectedTask.progress && Object.keys(selectedTask.progress).length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Live Progress
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(selectedTask.progress).map(([k, v]) => (
                  <div key={k} className="rounded bg-surface px-3 py-2">
                    <div className="text-xs text-foreground-muted">{formatParamKey(k)}</div>
                    <div className="text-sm font-semibold text-foreground">{String(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result summary */}
          {selectedTask.result_summary && Object.keys(selectedTask.result_summary).length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Results
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(selectedTask.result_summary).map(([k, v]) => (
                  <div key={k} className="rounded bg-surface px-3 py-2">
                    <div className="text-xs text-foreground-muted">{formatParamKey(k)}</div>
                    <div className="text-sm font-semibold text-foreground">{String(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error message */}
          {selectedTask.error_message && (
            <div className="rounded bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              <span className="font-medium">Error:</span> {selectedTask.error_message}
            </div>
          )}

          {/* Timing info */}
          <div className="flex gap-6 text-xs text-foreground-muted">
            <span>Created: {new Date(selectedTask.created_at).toLocaleString()}</span>
            {selectedTask.started_at && (
              <span>Started: {new Date(selectedTask.started_at).toLocaleString()}</span>
            )}
            {selectedTask.completed_at && (
              <span>Completed: {new Date(selectedTask.completed_at).toLocaleString()}</span>
            )}
            {selectedTask.started_at && (
              <span>Duration: {formatDuration(selectedTask.started_at, selectedTask.completed_at)}</span>
            )}
          </div>

          {/* Scraped links */}
          {links.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Scraped Links ({links.length.toLocaleString()})
              </h3>
              <div className="max-h-80 overflow-y-auto rounded bg-surface border border-[var(--border)] divide-y divide-[var(--border)]">
                {links.map((url, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-tertiary group"
                  >
                    <span className="text-xs text-foreground-secondary truncate flex-1 font-mono">
                      {url}
                    </span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-foreground-muted hover:text-blue-400 opacity-0 group-hover:opacity-100 shrink-0"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
