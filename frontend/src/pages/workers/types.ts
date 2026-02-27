export interface WorkerCurrentTask {
  id: string;
  task_type: string;
  status: string;
  website_name: string | null;
  progress: Record<string, unknown>;
  started_at: string | null;
}

export interface StatsEntry {
  cpu: number | null;
  ram: number | null;
  ts: string;
}

export interface Worker {
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
  stats_history: StatsEntry[];
  created_at: string;
  api_key?: string;
}
