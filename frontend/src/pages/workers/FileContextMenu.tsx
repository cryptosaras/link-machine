import { useEffect, useRef, useState, useCallback } from "react";
import { Download, FolderPlus, Pencil, Trash2, Upload } from "lucide-react";
import api from "@/api/client";
import type { TreeNode } from "./FilePanel";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FileContextMenuProps {
  x: number;
  y: number;
  node: TreeNode;
  workerId: string;
  onClose: () => void;
  onRefresh: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function FileContextMenu({
  x,
  y,
  node,
  workerId,
  onClose,
  onRefresh,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"menu" | "mkdir" | "rename">("menu");
  const [inputValue, setInputValue] = useState("");

  /* ---- Positioning ---- */
  const menuWidth = 200;
  const menuHeight = 220;
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8);

  /* ---- Close on click outside / escape ---- */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  /* ---- Actions ---- */

  const done = useCallback(() => {
    onRefresh();
    onClose();
  }, [onRefresh, onClose]);

  const handleDownload = useCallback(async () => {
    try {
      const res = await api.get(`/workers/${workerId}/files/download`, {
        params: { path: node.path },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = node.entry.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Download failed");
    }
    onClose();
  }, [workerId, node, onClose]);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      form.append("path", node.path);
      try {
        await api.post(`/workers/${workerId}/files/upload`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } catch (err: any) {
        alert(err?.response?.data?.detail || "Upload failed");
      }
      done();
    },
    [workerId, node, done]
  );

  const handleMkdir = useCallback(
    async (name: string) => {
      if (!name.trim()) {
        onClose();
        return;
      }
      const parentPath = node.entry.is_dir ? node.path : node.path.replace(/\/[^/]+$/, "") || "/";
      const newPath = parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
      try {
        await api.post(`/workers/${workerId}/files/mkdir`, { path: newPath });
      } catch (err: any) {
        alert(err?.response?.data?.detail || "Create folder failed");
      }
      done();
    },
    [workerId, node, done]
  );

  const handleRename = useCallback(
    async (newName: string) => {
      if (!newName.trim() || newName === node.entry.name) {
        onClose();
        return;
      }
      const parentDir = node.path.replace(/\/[^/]+$/, "") || "/";
      const newPath = parentDir === "/" ? `/${newName}` : `${parentDir}/${newName}`;
      try {
        await api.post(`/workers/${workerId}/files/rename`, {
          old_path: node.path,
          new_path: newPath,
        });
      } catch (err: any) {
        alert(err?.response?.data?.detail || "Rename failed");
      }
      done();
    },
    [workerId, node, done]
  );

  const handleDelete = useCallback(async () => {
    const confirmed = window.confirm(`Delete "${node.entry.name}"?`);
    if (!confirmed) {
      onClose();
      return;
    }
    try {
      await api.post(`/workers/${workerId}/files/delete`, { path: node.path });
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Delete failed");
    }
    done();
  }, [workerId, node, done]);

  /* ---- Inline input mode ---- */
  if (mode === "mkdir" || mode === "rename") {
    return (
      <div
        ref={menuRef}
        className="fixed z-[100] w-52 rounded-md border border-gray-700 bg-[#1e1e2e] p-2 shadow-xl"
        style={{ left: adjustedX, top: adjustedY }}
      >
        <label className="mb-1 block text-[10px] text-gray-500">
          {mode === "mkdir" ? "New folder name" : "Rename to"}
        </label>
        <input
          autoFocus
          className="w-full rounded border border-gray-600 bg-[#16161e] px-2 py-1 text-xs text-gray-200 outline-none focus:border-emerald-500"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              mode === "mkdir" ? handleMkdir(inputValue) : handleRename(inputValue);
            }
            if (e.key === "Escape") onClose();
          }}
        />
      </div>
    );
  }

  /* ---- Menu items ---- */
  const isDir = node.entry.is_dir;

  const items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; show: boolean }[] = [
    {
      label: "Download",
      icon: <Download className="h-3.5 w-3.5" />,
      onClick: handleDownload,
      show: !isDir,
    },
    {
      label: "Upload here",
      icon: <Upload className="h-3.5 w-3.5" />,
      onClick: handleUpload,
      show: isDir,
    },
    {
      label: "New folder",
      icon: <FolderPlus className="h-3.5 w-3.5" />,
      onClick: () => {
        setInputValue("");
        setMode("mkdir");
      },
      show: true,
    },
    {
      label: "Rename",
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: () => {
        setInputValue(node.entry.name);
        setMode("rename");
      },
      show: true,
    },
    {
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      onClick: handleDelete,
      danger: true,
      show: true,
    },
  ];

  return (
    <>
      <div
        ref={menuRef}
        className="fixed z-[100] w-48 rounded-md border border-gray-700 bg-[#1e1e2e] py-1 shadow-xl"
        style={{ left: adjustedX, top: adjustedY }}
      >
        {items
          .filter((i) => i.show)
          .map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                item.danger
                  ? "text-red-400 hover:bg-red-500/10"
                  : "text-gray-300 hover:bg-white/5"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
      </div>
      {/* hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelected}
      />
    </>
  );
}
