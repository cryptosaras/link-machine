import { useEffect, useState, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  RefreshCw,
  Home,
  Loader2,
} from "lucide-react";
import api from "@/api/client";
import FileContextMenu from "./FileContextMenu";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FileEntry {
  name: string;
  is_dir: boolean;
  size: number;
  modified: string;
  permissions: string;
}

export interface TreeNode {
  entry: FileEntry;
  path: string;
  children: TreeNode[] | null;
  expanded: boolean;
  loading: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fileIconColor(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  switch (ext) {
    case ".py":
      return "text-yellow-400";
    case ".js":
    case ".ts":
    case ".tsx":
    case ".jsx":
      return "text-blue-400";
    case ".json":
      return "text-green-400";
    case ".yml":
    case ".yaml":
      return "text-pink-400";
    case ".md":
      return "text-gray-300";
    case ".sh":
    case ".bash":
      return "text-green-300";
    case ".log":
      return "text-gray-500";
    case ".env":
      return "text-yellow-300";
    default:
      return "text-gray-400";
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} M`;
}

/** Recursively update a node found by path */
function updateNode(
  nodes: TreeNode[],
  targetPath: string,
  updater: (node: TreeNode) => TreeNode
): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) return updater(n);
    if (n.children) return { ...n, children: updateNode(n.children, targetPath, updater) };
    return n;
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface FilePanelProps {
  workerId: string;
}

export default function FilePanel({ workerId }: FilePanelProps) {
  const [rootEntries, setRootEntries] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rootPath, setRootPath] = useState("/");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(
    null
  );

  const fetchDir = useCallback(
    async (path: string): Promise<TreeNode[]> => {
      const res = await api.get(`/workers/${workerId}/files`, { params: { path } });
      const entries: FileEntry[] = res.data;
      return entries
        .sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .map((entry) => ({
          entry,
          path: path === "/" ? `/${entry.name}` : `${path}/${entry.name}`,
          children: null,
          expanded: false,
          loading: false,
        }));
    },
    [workerId]
  );

  const loadRoot = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const nodes = await fetchDir(path);
        setRootEntries(nodes);
        setRootPath(path);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load files";
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [fetchDir]
  );

  useEffect(() => {
    loadRoot("/");
  }, [loadRoot]);

  const toggleFolder = useCallback(
    async (node: TreeNode) => {
      if (node.expanded) {
        // collapse
        setRootEntries((prev) => updateNode(prev, node.path, (n) => ({ ...n, expanded: false })));
        return;
      }

      if (node.children !== null) {
        // already loaded, just expand
        setRootEntries((prev) => updateNode(prev, node.path, (n) => ({ ...n, expanded: true })));
        return;
      }

      // need to fetch
      setRootEntries((prev) =>
        updateNode(prev, node.path, (n) => ({ ...n, loading: true, expanded: true }))
      );
      try {
        const children = await fetchDir(node.path);
        setRootEntries((prev) =>
          updateNode(prev, node.path, (n) => ({ ...n, children, loading: false }))
        );
      } catch {
        setRootEntries((prev) =>
          updateNode(prev, node.path, (n) => ({
            ...n,
            children: [],
            loading: false,
          }))
        );
      }
    },
    [fetchDir]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: TreeNode) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    []
  );

  const handleRefresh = useCallback(() => {
    // reload entire tree from root
    setRootEntries([]);
    loadRoot(rootPath);
  }, [loadRoot, rootPath]);

  /* ---- Row renderer ---- */

  function renderRow(node: TreeNode, depth: number) {
    const isDir = node.entry.is_dir;

    return (
      <div key={node.path}>
        <div
          className="group flex cursor-pointer items-center py-0.5 pr-2 hover:bg-white/5"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => isDir && toggleFolder(node)}
          onContextMenu={(e) => handleContextMenu(e, node)}
        >
          {/* chevron / spinner / spacer */}
          {isDir ? (
            node.loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin text-gray-500" />
            ) : node.expanded ? (
              <ChevronDown className="mr-1 h-3.5 w-3.5 shrink-0 text-gray-500" />
            ) : (
              <ChevronRight className="mr-1 h-3.5 w-3.5 shrink-0 text-gray-500" />
            )
          ) : (
            <span className="mr-1 inline-block w-3.5 shrink-0" />
          )}

          {/* icon */}
          {isDir ? (
            node.expanded ? (
              <FolderOpen className="mr-1.5 h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <Folder className="mr-1.5 h-4 w-4 shrink-0 text-amber-400" />
            )
          ) : (
            <File className={`mr-1.5 h-4 w-4 shrink-0 ${fileIconColor(node.entry.name)}`} />
          )}

          {/* name */}
          <span className="min-w-0 flex-1 truncate text-xs text-gray-300">{node.entry.name}</span>

          {/* size on hover for files */}
          {!isDir && (
            <span className="ml-2 hidden shrink-0 text-[10px] text-gray-500 group-hover:inline">
              {formatSize(node.entry.size)}
            </span>
          )}
        </div>

        {/* children */}
        {isDir && node.expanded && (
          <>
            {node.children && node.children.length === 0 && (
              <div
                className="py-0.5 text-xs italic text-gray-600"
                style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              >
                empty
              </div>
            )}
            {node.children?.map((child) => renderRow(child, depth + 1))}
          </>
        )}
      </div>
    );
  }

  /* ---- Main render ---- */

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: "#16161e" }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700/50 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Explorer
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => loadRoot("/")}
            className="rounded p-1 text-gray-500 hover:bg-white/5 hover:text-gray-300"
            title="Home"
          >
            <Home className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleRefresh}
            className="rounded p-1 text-gray-500 hover:bg-white/5 hover:text-gray-300"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="border-b border-gray-700/50 px-3 py-1">
        <span className="font-mono text-[10px] text-gray-600">{rootPath}</span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
          </div>
        )}
        {error && <div className="px-3 py-4 text-xs text-red-400">{error}</div>}
        {!loading && !error && rootEntries.length === 0 && (
          <div className="px-3 py-4 text-xs italic text-gray-600">No files</div>
        )}
        {!loading && !error && rootEntries.map((node) => renderRow(node, 0))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          workerId={workerId}
          onClose={() => setContextMenu(null)}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
}
