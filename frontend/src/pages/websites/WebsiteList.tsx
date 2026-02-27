import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Globe, Link, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
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
  pages_count: number;
  created_at: string;
}

export default function WebsiteList() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [scrapeWebsite, setScrapeWebsite] = useState<Website | null>(null);
  const [scrapeDepth, setScrapeDepth] = useState("0");
  const [scrapeMaxPages, setScrapeMaxPages] = useState("10000");
  const [scrapeConcurrent, setScrapeConcurrent] = useState("30");
  const [scrapeUseSitemap, setScrapeUseSitemap] = useState(false);
  const [scrapeExtractText, setScrapeExtractText] = useState(false);
  const [scrapeTextOnly, setScrapeTextOnly] = useState(false);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetWebsite, setResetWebsite] = useState<Website | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

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
      await api.post("/websites", { name, url, sitemap_url: sitemapUrl || null });
      setName("");
      setUrl("");
      setSitemapUrl("");
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
          extract_text: scrapeExtractText,
          extract_text_only: scrapeTextOnly,
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

  const handleResetLinks = async () => {
    if (!resetWebsite) return;
    setResetLoading(true);
    try {
      await api.delete(`/websites/${resetWebsite.id}/links`);
      setResetOpen(false);
      setResetWebsite(null);
      fetchWebsites();
    } finally {
      setResetLoading(false);
    }
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
              <div className="space-y-2">
                <Label htmlFor="site-sitemap-url">Sitemap URL (optional)</Label>
                <Input
                  id="site-sitemap-url"
                  value={sitemapUrl}
                  onChange={(e) => setSitemapUrl(e.target.value)}
                  placeholder="https://example.com/sitemap.xml"
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
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Pages</th>
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
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-foreground-secondary">
                      <FileText className="h-3.5 w-3.5 text-foreground-muted" />
                      {site.pages_count.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {new Date(site.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setScrapeWebsite(site);
                          setScrapeExtractText(false);
                          setScrapeTextOnly(false);
                          setScrapeOpen(true);
                        }}
                        className="bg-accent text-accent-foreground hover:bg-accent/80"
                      >
                        <Search className="h-3.5 w-3.5 mr-1.5" />
                        Scrape
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setResetWebsite(site);
                          setResetOpen(true);
                        }}
                        title="Reset links & pages"
                      >
                        <RotateCcw className="h-4 w-4 text-foreground-muted hover:text-orange-400" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(site.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-foreground-muted hover:text-red-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reset Links Confirmation */}
      <Dialog open={resetOpen} onOpenChange={(o) => { if (!o) { setResetOpen(false); setResetWebsite(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Links & Pages</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <p className="text-sm text-foreground-secondary">
              Are you sure you want to delete all scraped links and pages for{" "}
              <span className="font-semibold text-foreground">{resetWebsite?.name}</span>?
              This will remove{" "}
              <span className="font-semibold text-foreground">
                {resetWebsite?.links_count.toLocaleString()} links
              </span>
              {" "}and{" "}
              <span className="font-semibold text-foreground">
                {resetWebsite?.pages_count.toLocaleString()} pages
              </span>.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setResetOpen(false); setResetWebsite(null); }}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleResetLinks} disabled={resetLoading}>
                {resetLoading ? "Deleting..." : "Delete All Links & Pages"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={scrapeOpen} onOpenChange={setScrapeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scrape Website</DialogTitle>
            <DialogDescription>
              Configure scraping for {scrapeWebsite?.name}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleScrape} className="mt-4 space-y-4">
            {!scrapeTextOnly && (
              <>
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
              </>
            )}

            <div className="rounded-md border border-[var(--border)] bg-surface-secondary p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  id="scrape-extract-text"
                  type="checkbox"
                  checked={scrapeExtractText}
                  onChange={(e) => {
                    setScrapeExtractText(e.target.checked);
                    if (!e.target.checked) setScrapeTextOnly(false);
                  }}
                  className="rounded border-[var(--border)]"
                />
                <Label htmlFor="scrape-extract-text">
                  Extract page text (title, description, body)
                </Label>
              </div>
              {scrapeExtractText && scrapeWebsite && scrapeWebsite.links_count > 0 && (
                <div className="flex items-center gap-2 ml-5">
                  <input
                    id="scrape-text-only"
                    type="checkbox"
                    checked={scrapeTextOnly}
                    onChange={(e) => setScrapeTextOnly(e.target.checked)}
                    className="rounded border-[var(--border)]"
                  />
                  <Label htmlFor="scrape-text-only" className="text-foreground-secondary">
                    Text only — re-visit {scrapeWebsite.links_count.toLocaleString()} existing links
                  </Label>
                </div>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={scrapeLoading}>
              {scrapeLoading
                ? "Creating task..."
                : scrapeTextOnly
                  ? "Start Text Extraction"
                  : scrapeExtractText
                    ? "Start Scraping (Links + Text)"
                    : "Start Scraping"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
