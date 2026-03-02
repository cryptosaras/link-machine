import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import api from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SettingsPage() {
  const [controlUrl, setControlUrl] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showOpenrouterKey, setShowOpenrouterKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get("/settings/control_server_url")
      .then((r) => setControlUrl(r.data.value))
      .catch(() => {});
    api
      .get("/settings/upcloud_ssh_key")
      .then((r) => setSshKey(r.data.value))
      .catch(() => {});
    api
      .get("/settings/openrouter_api_key")
      .then((r) => setOpenrouterKey(r.data.value))
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await Promise.all([
        api.put("/settings/control_server_url", { value: controlUrl }),
        api.put("/settings/upcloud_ssh_key", { value: sshKey }),
        api.put("/settings/openrouter_api_key", { value: openrouterKey }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>

      <div className="max-w-lg rounded-lg border border-[var(--border)] bg-surface-secondary p-6">
        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="control-url">Control Server URL</Label>
            <Input
              id="control-url"
              value={controlUrl}
              onChange={(e) => setControlUrl(e.target.value)}
              placeholder="http://YOUR_VPS_IP:8000"
            />
            <p className="text-xs text-foreground-muted">
              The URL that worker agents use to connect back to this server.
              Include protocol and port (e.g. http://123.45.67.89:8000 or
              https://mydomain.com).
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ssh-key">UpCloud SSH Private Key</Label>
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground-secondary"
              >
                {showKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            {showKey ? (
              <textarea
                id="ssh-key"
                value={sshKey}
                onChange={(e) => setSshKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                rows={6}
                className="flex w-full rounded-md border border-[var(--border)] bg-surface-secondary px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] font-mono"
              />
            ) : (
              <div className="flex w-full items-center rounded-md border border-[var(--border)] bg-surface-secondary px-3 py-2 text-sm text-foreground-muted">
                {sshKey ? "Key configured" : "No key configured"}
              </div>
            )}
            <p className="text-xs text-foreground-muted">
              The SSH private key used to connect to UpCloud workers. Add your
              public key when creating UpCloud servers, paste the private key
              here.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="openrouter-key">OpenRouter API Key</Label>
              <button
                type="button"
                onClick={() => setShowOpenrouterKey(!showOpenrouterKey)}
                className="flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground-secondary"
              >
                {showOpenrouterKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {showOpenrouterKey ? "Hide" : "Show"}
              </button>
            </div>
            <Input
              id="openrouter-key"
              type={showOpenrouterKey ? "text" : "password"}
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
              placeholder="sk-or-v1-..."
            />
            <p className="text-xs text-foreground-muted">
              Your OpenRouter API key for AI-powered features. Get one at{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                openrouter.ai/keys
              </a>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
            {saved && (
              <span className="text-sm text-green-400">Saved successfully</span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
