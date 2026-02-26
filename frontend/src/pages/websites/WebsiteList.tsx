import { useEffect, useState } from "react";
import { Globe, Plus, Trash2 } from "lucide-react";
import api from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";

interface Website {
  id: string;
  name: string;
  url: string;
  sitemap_url: string | null;
  created_at: string;
}

export default function WebsiteList() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchWebsites = async () => {
    const res = await api.get("/websites");
    setWebsites(res.data);
  };

  useEffect(() => {
    fetchWebsites();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/websites", { name, url });
      setName("");
      setUrl("");
      setOpen(false);
      fetchWebsites();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/websites/${id}`);
    fetchWebsites();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Websites</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Add Website
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Website</DialogTitle>
              <DialogDescription>Enter the website details below.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="site-name">Name</Label>
                <Input
                  id="site-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Website"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="site-url">URL</Label>
                <Input
                  id="site-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Adding..." : "Add Website"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {websites.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-surface-secondary py-16">
          <Globe className="mb-4 h-12 w-12 text-foreground-muted" />
          <p className="text-foreground-secondary">No websites yet. Add your first website to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] bg-surface-secondary">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Name</th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">URL</th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Added</th>
                <th className="px-4 py-3 text-right font-medium text-foreground-secondary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {websites.map((site) => (
                <tr key={site.id} className="bg-surface hover:bg-surface-tertiary">
                  <td className="px-4 py-3 font-medium text-foreground">{site.name}</td>
                  <td className="px-4 py-3 text-foreground-secondary">{site.url}</td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {new Date(site.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(site.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-foreground-muted hover:text-red-400" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
