import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as TerminalIcon, X, FolderTree } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import FilePanel from "./FilePanel";

interface WorkerTerminalProps {
  workerId: string;
  workerName: string;
  onClose: () => void;
}

export default function WorkerTerminal({ workerId, workerName, onClose }: WorkerTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitPercent, setSplitPercent] = useState(33);
  const isDragging = useRef(false);

  /* ---- Terminal setup (unchanged logic) ---- */
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      rightClickSelectsWord: true,
      theme: {
        background: "#0d0d0d",
        foreground: "#d4d4d8",
        cursor: "#10b981",
        cursorAccent: "#0d0d0d",
        selectionBackground: "#10b98133",
      },
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    setTimeout(() => fitAddon.fit(), 50);

    const token = localStorage.getItem("access_token");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal/${workerId}?token=${token}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    };

    ws.onmessage = (event) => term.write(event.data);
    ws.onerror = () => term.write("\r\n\x1b[31mWebSocket connection failed\x1b[0m\r\n");
    ws.onclose = () => term.write("\r\n\x1b[33mConnection closed\x1b[0m\r\n");

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // Right-click: copy selection or paste from clipboard (CMD-style)
    const fallbackCopy = (text: string) => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      ta.setAttribute("readonly", "");
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    };

    const fallbackPaste = (cb: (text: string) => void) => {
      const ta = document.createElement("textarea");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      document.execCommand("paste");
      const text = ta.value;
      document.body.removeChild(ta);
      if (text) cb(text);
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const selection = term.getSelection();
      if (selection) {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(selection).then(() => term.clearSelection());
        } else {
          fallbackCopy(selection);
          term.clearSelection();
        }
      } else {
        if (navigator.clipboard?.readText) {
          navigator.clipboard.readText().then((text) => {
            if (text && ws.readyState === WebSocket.OPEN) ws.send(text);
          });
        } else {
          fallbackPaste((text) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(text);
          });
        }
      }
    };
    terminalRef.current.addEventListener("contextmenu", handleContextMenu);

    const handleResize = () => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      terminalRef.current?.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("resize", handleResize);
      ws.close();
      term.dispose();
      fitAddonRef.current = null;
    };
  }, [workerId]);

  /* ---- Re-fit terminal when split changes ---- */
  useEffect(() => {
    const timer = setTimeout(() => {
      fitAddonRef.current?.fit();
    }, 50);
    return () => clearTimeout(timer);
  }, [splitPercent]);

  /* ---- Divider drag logic ---- */
  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        const clamped = Math.max(15, Math.min(60, pct));
        setSplitPercent(clamped);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        // re-fit after drag ends
        setTimeout(() => fitAddonRef.current?.fit(), 30);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    []
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative flex h-full w-[85%] min-w-[700px] flex-col border-l-2 border-emerald-500/50 shadow-2xl"
        style={{ backgroundColor: "#111118" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{
            background: "linear-gradient(to right, rgba(16, 185, 129, 0.12), transparent)",
            borderBottom: "1px solid rgba(16, 185, 129, 0.25)",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full bg-red-500/80" />
              <span className="inline-block h-3 w-3 rounded-full bg-yellow-500/80" />
              <span className="inline-block h-3 w-3 rounded-full bg-green-500/80" />
            </div>
            <div className="mx-2 h-4 w-px bg-gray-700" />
            <FolderTree className="h-4 w-4 text-emerald-400" />
            <span className="text-sm text-emerald-50/60">Files</span>
            <TerminalIcon className="ml-2 h-4 w-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-50">{workerName}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Split content area */}
        <div ref={containerRef} className="flex flex-1 overflow-hidden">
          {/* Left: File panel */}
          <div
            className="h-full overflow-hidden"
            style={{ width: `${splitPercent}%` }}
          >
            <FilePanel workerId={workerId} />
          </div>

          {/* Divider */}
          <div
            className="w-1 shrink-0 cursor-col-resize bg-gray-700 transition-colors hover:bg-emerald-500/50"
            onMouseDown={handleDividerMouseDown}
          />

          {/* Right: Terminal */}
          <div
            className="h-full flex-1 overflow-hidden p-1"
            style={{ backgroundColor: "#0d0d0d" }}
          >
            <div ref={terminalRef} className="h-full w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
