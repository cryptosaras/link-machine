import { useEffect, useState } from "react";
import api from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SettingsPage() {
  const [controlUrl, setControlUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get("/settings/control_server_url")
      .then((r) => setControlUrl(r.data.value))
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await api.put("/settings/control_server_url", { value: controlUrl });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      <div className="max-w-lg rounded-lg border border-gray-800 bg-gray-900 p-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="control-url">Control Server URL</Label>
            <Input
              id="control-url"
              value={controlUrl}
              onChange={(e) => setControlUrl(e.target.value)}
              placeholder="http://YOUR_VPS_IP:8000"
            />
            <p className="text-xs text-gray-500">
              The URL that worker agents use to connect back to this server.
              Include protocol and port (e.g. http://123.45.67.89:8000 or
              https://mydomain.com).
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
