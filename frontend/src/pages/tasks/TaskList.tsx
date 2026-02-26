import { useEffect, useState, useRef } from "react";
import { ListTodo } from "lucide-react";
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

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [links, setLinks] = useState<string[]>([]);
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
                  className="cursor-pointer bg-surface hover:bg-surface-tertiary"
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
        <div className="rounded-lg border border-[var(--border)] bg-surface-secondary p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {taskTypeLabel(selectedTask.task_type)} —{" "}
              {selectedTask.website_name}
            </h2>
            <button
              onClick={() => setSelectedTask(null)}
              className="text-foreground-muted hover:text-foreground text-sm"
            >
              Close
            </button>
          </div>

          {selectedTask.result_summary && (
            <div className="grid grid-cols-3 gap-4 text-sm">
              {Object.entries(selectedTask.result_summary).map(([k, v]) => (
                <div key={k}>
                  <span className="text-foreground-muted">
                    {k.replace(/_/g, " ")}:
                  </span>{" "}
                  <span className="text-foreground font-medium">
                    {String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {selectedTask.error_message && (
            <div className="rounded bg-red-500/10 p-3 text-sm text-red-400">
              {selectedTask.error_message}
            </div>
          )}

          {links.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm text-foreground-secondary font-medium">
                Scraped Links ({links.length})
              </p>
              <div className="max-h-64 overflow-y-auto rounded bg-surface p-2 text-xs font-mono">
                {links.map((url, i) => (
                  <div
                    key={i}
                    className="text-foreground-secondary py-0.5 truncate"
                  >
                    {url}
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
