import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Globe, Link, Plus, Search, Trash2 } from "lucide-react";
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
  links_count: number;
  created_at: string;
}

export default function WebsiteList() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [scrapeWebsite, setScrapeWebsite] = useState<Website | null>(null);
  const [scrapeDepth, setScrapeDepth] = useState("0");
  const [scrapeMaxPages, setScrapeMaxPages] = useState("10000");
  const [scrapeConcurrent, setScrapeConcurrent] = useState("30");
  const [scrapeUseSitemap, setScrapeUseSitemap] = useState(false);
  const [scrapeLoading, setScrapeLoading] = useState(false);

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

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scrapeWebsite) return;
    setScrapeLoading(true);
    try {
      await api.post("/tasks", {
        website_id: scrapeWebsite.id,
        task_type: "scrape_links",
        params: {
          depth: parseInt(scrapeDepth),
          max_pages: parseInt(scrapeMaxPages),
          concurrent: parseInt(scrapeConcurrent),
          use_sitemap: scrapeUseSitemap,
        },
      });
      setScrapeOpen(false);
      navigate("/tasks");
    } finally {
      setScrapeLoading(false);
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
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Links</th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Added</th>
                <th className="px-4 py-3 text-right font-medium text-foreground-secondary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {websites.map((site) => (
                <tr key={site.id} className="bg-surface hover:bg-surface-tertiary">
                  <td className="px-4 py-3 font-medium text-foreground">{site.name}</td>
                  <td className="px-4 py-3 text-foreground-secondary">{site.url}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-foreground-secondary">
                      <Link className="h-3.5 w-3.5 text-foreground-muted" />
                      {site.links_count.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {new Date(site.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setScrapeWebsite(site);
                        setScrapeOpen(true);
                      }}
                      title="Scrape Links"
                    >
                      <Search className="h-4 w-4 text-foreground-muted hover:text-emerald-400" />
                    </Button>
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

      <Dialog open={scrapeOpen} onOpenChange={setScrapeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scrape Links</DialogTitle>
            <DialogDescription>
              Configure scraping for {scrapeWebsite?.name}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleScrape} className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scrape-depth">Max Depth (0 = unlimited)</Label>
              <Input
                id="scrape-depth"
                type="number"
                value={scrapeDepth}
                onChange={(e) => setScrapeDepth(e.target.value)}
                min="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scrape-max-pages">Max Pages</Label>
              <Input
                id="scrape-max-pages"
                type="number"
                value={scrapeMaxPages}
                onChange={(e) => setScrapeMaxPages(e.target.value)}
                min="1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scrape-concurrent">Concurrent Workers</Label>
              <Input
                id="scrape-concurrent"
                type="number"
                value={scrapeConcurrent}
                onChange={(e) => setScrapeConcurrent(e.target.value)}
                min="1"
                max="100"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="scrape-sitemap"
                type="checkbox"
                checked={scrapeUseSitemap}
                onChange={(e) => setScrapeUseSitemap(e.target.checked)}
                className="rounded border-[var(--border)]"
              />
              <Label htmlFor="scrape-sitemap">Start from sitemap URL</Label>
            </div>
            <Button type="submit" className="w-full" disabled={scrapeLoading}>
              {scrapeLoading ? "Creating task..." : "Start Scraping"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
