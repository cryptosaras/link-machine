import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ExternalLink, Link, FileText } from "lucide-react";
import api from "@/api/client";
import { Button } from "@/components/ui/button";
import LinksTab from "./LinksTab";
import PagesTab from "./PagesTab";

interface Website {
  id: string;
  name: string;
  url: string;
  sitemap_url: string | null;
  links_count: number;
  pages_count: number;
}

type Tab = "links" | "pages";

export default function WebsiteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [website, setWebsite] = useState<Website | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("links");

  const fetchWebsite = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.get(`/websites/${id}`);
      setWebsite(res.data);
    } catch {
      navigate("/websites");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchWebsite();
  }, [fetchWebsite]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-foreground-muted">
        Loading...
      </div>
    );
  }

  if (!website || !id) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/websites")}
          className="mb-3 -ml-2 text-foreground-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to Websites
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{website.name}</h1>
          <a
            href={website.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-foreground-muted hover:text-accent"
          >
            {website.url}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="mt-2 flex items-center gap-4 text-sm text-foreground-secondary">
          <span className="inline-flex items-center gap-1.5">
            <Link className="h-3.5 w-3.5 text-foreground-muted" />
            {website.links_count.toLocaleString()} links
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-foreground-muted" />
            {website.pages_count.toLocaleString()} pages
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--border)]">
        <div className="flex gap-0">
          <button
            onClick={() => setTab("links")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "links"
                ? "border-accent text-accent"
                : "border-transparent text-foreground-secondary hover:text-foreground hover:border-foreground-muted"
            }`}
          >
            Links
          </button>
          <button
            onClick={() => setTab("pages")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "pages"
                ? "border-accent text-accent"
                : "border-transparent text-foreground-secondary hover:text-foreground hover:border-foreground-muted"
            }`}
          >
            Pages
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {tab === "links" ? (
        <LinksTab websiteId={id} onCountChange={fetchWebsite} />
      ) : (
        <PagesTab websiteId={id} onCountChange={fetchWebsite} />
      )}
    </div>
  );
}
