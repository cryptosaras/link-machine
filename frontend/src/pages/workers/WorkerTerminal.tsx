import { useEffect, useRef } from "react";
import { Terminal as TerminalIcon, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";

interface WorkerTerminalProps {
  workerId: string;
  workerName: string;
  onClose: () => void;
}

export default function WorkerTerminal({ workerId, workerName, onClose }: WorkerTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

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

    const handleResize = () => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      ws.close();
      term.dispose();
    };
  }, [workerId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative flex h-full w-[70%] min-w-[500px] flex-col border-l-2 border-emerald-500/50 shadow-2xl"
        style={{ backgroundColor: "#111118" }}
      >
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
            <TerminalIcon className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-50">{workerName}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div ref={terminalRef} className="flex-1 p-1" style={{ backgroundColor: "#0d0d0d" }} />
      </div>
    </div>
  );
}
