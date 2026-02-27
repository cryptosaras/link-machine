import {
  Download,
  FileText,
  RotateCcw,
  Terminal as TerminalIcon,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import SparklineChart from "./SparklineChart";
import { formatTimeAgo, formatRam } from "./utils";
import type { Worker } from "./types";

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

interface WorkerTableProps {
  workers: Worker[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onInstall: (workerId: string) => void;
  onReset: (workerId: string) => void;
  onDelete: (worker: Worker) => void;
  onOpenTerminal: (workerId: string, workerName: string) => void;
  onOpenLogs: (workerId: string, workerName: string) => void;
}

export default function WorkerTable({
  workers,
  selectedIds,
  onToggleSelect,
  onInstall,
  onReset,
  onDelete,
  onOpenTerminal,
  onOpenLogs,
}: WorkerTableProps) {
  return (
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
              CPU
            </th>
            <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
              RAM
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
          {workers.map((w) => {
            const cpuData = w.stats_history.map((s) => s.cpu);
            const ramData = w.stats_history.map((s) => s.ram);
            const latestCpu = w.system_stats.cpu_percent as number | undefined;
            const latestRam = w.system_stats.ram_percent as number | undefined;
            const cpuCores = w.system_stats.cpu_cores as number | undefined;
            const ramTotal = w.system_stats.ram_total_mb as number | undefined;

            return (
              <tr key={w.id} className="bg-surface hover:bg-surface-tertiary">
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(w.id)}
                    onChange={() => onToggleSelect(w.id)}
                    className="h-4 w-4 rounded accent-accent"
                  />
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
                  <div className="flex flex-col gap-0.5">
                    <SparklineChart
                      data={cpuData}
                      color="#10b981"
                      fillColor="rgba(16, 185, 129, 0.15)"
                      label={latestCpu !== undefined ? `${Math.round(latestCpu)}%` : undefined}
                    />
                    {cpuCores !== undefined && (
                      <span className="text-[10px] text-foreground-muted">
                        {cpuCores} cores
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <SparklineChart
                      data={ramData}
                      color="#8b5cf6"
                      fillColor="rgba(139, 92, 246, 0.15)"
                      label={latestRam !== undefined ? `${Math.round(latestRam)}%` : undefined}
                    />
                    {ramTotal !== undefined && (
                      <span className="text-[10px] text-foreground-muted">
                        {formatRam(ramTotal)}
                      </span>
                    )}
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
                          {w.current_task.task_type
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (c) => c.toUpperCase())}
                        </span>
                        {w.current_task.website_name && (
                          <span className="text-xs text-foreground-muted">
                            — {w.current_task.website_name}
                          </span>
                        )}
                      </div>
                      {w.current_task.progress &&
                        Object.keys(w.current_task.progress).length > 0 && (
                          <span className="text-[10px] text-foreground-muted">
                            {w.current_task.progress.pages_fetched !== undefined &&
                              `${w.current_task.progress.pages_fetched} pages`}
                            {w.current_task.progress.links_found !== undefined &&
                              ` · ${w.current_task.progress.links_found} links`}
                            {w.current_task.progress.rate !== undefined &&
                              ` · ${w.current_task.progress.rate}`}
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
                      onClick={() => onOpenLogs(w.id, w.name)}
                      title="View logs"
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpenTerminal(w.id, w.name)}
                      title="Open terminal"
                    >
                      <TerminalIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onInstall(w.id)}
                      disabled={w.status === "provisioning"}
                      title="Install/update worker"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onReset(w.id)}
                      disabled={w.status === "provisioning"}
                      title="Reset worker (restart container)"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(w)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-foreground-muted hover:text-red-400" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
