import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Trash2 } from "lucide-react";
import api from "@/api/client";
import { Button } from "@/components/ui/button";
import { usePagination } from "./usePagination";
import { PaginationBar } from "./PaginationBar";

interface PageItem {
  id: string;
  url: string;
  title: string | null;
  meta_description: string | null;
  body_text: string | null;
  created_at: string;
}

interface Props {
  websiteId: string;
  onCountChange: () => void;
}

export default function PagesTab({ websiteId, onCountChange }: Props) {
  const [pages, setPages] = useState<PageItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lastCheckedIdx = useRef<number | null>(null);
  const pag = usePagination();

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/websites/${websiteId}/pages/list`, {
        params: { page: pag.page, page_size: pag.pageSize, search: pag.debouncedSearch },
      });
      setPages(res.data.items);
      pag.setTotal(res.data.total);
    } finally {
      setLoading(false);
    }
  }, [websiteId, pag.page, pag.pageSize, pag.debouncedSearch]);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  useEffect(() => {
    setSelected(new Set());
    setExpanded(new Set());
    lastCheckedIdx.current = null;
  }, [pag.page, pag.debouncedSearch]);

  const toggleOne = (id: string, index: number, shiftKey: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedIdx.current !== null) {
        const start = Math.min(lastCheckedIdx.current, index);
        const end = Math.max(lastCheckedIdx.current, index);
        for (let i = start; i <= end; i++) {
          next.add(pages[i].id);
        }
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      lastCheckedIdx.current = index;
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === pages.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pages.map((p) => p.id)));
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteOne = async (id: string) => {
    await api.post(`/websites/${websiteId}/pages/bulk-delete`, { ids: [id] });
    fetchPages();
    onCountChange();
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      await api.post(`/websites/${websiteId}/pages/bulk-delete`, { ids: Array.from(selected) });
      setSelected(new Set());
      fetchPages();
      onCountChange();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search pages..."
          value={pag.search}
          onChange={(e) => pag.handleSearch(e.target.value)}
          className="h-9 w-64 rounded-md border border-[var(--border)] bg-surface px-3 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
        />
        <select
          value={pag.pageSize}
          onChange={(e) => pag.setPageSize(Number(e.target.value))}
          className="h-9 rounded-md border border-[var(--border)] bg-surface px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
        >
          <option value={100}>100</option>
          <option value={200}>200</option>
          <option value={500}>500</option>
        </select>
        {selected.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={deleting}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            {deleting ? "Deleting..." : `Delete (${selected.size})`}
          </Button>
        )}
      </div>

      {loading && pages.length === 0 ? (
        <div className="py-12 text-center text-foreground-muted">Loading...</div>
      ) : pages.length === 0 ? (
        <div className="py-12 text-center text-foreground-muted">
          {pag.debouncedSearch ? "No pages match your search." : "No pages scraped yet."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-2 bg-surface-secondary text-sm font-medium text-foreground-secondary">
            <input
              type="checkbox"
              checked={pages.length > 0 && selected.size === pages.length}
              onChange={toggleAll}
              className="rounded border-[var(--border)]"
            />
            <span className="flex-1">Page</span>
          </div>

          {pages.map((pg, idx) => (
            <div key={pg.id} className="bg-surface hover:bg-surface-tertiary group">
              <div className="flex items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={selected.has(pg.id)}
                  onChange={(e) => toggleOne(pg.id, idx, (e.nativeEvent as MouseEvent).shiftKey)}
                  className="mt-0.5 rounded border-[var(--border)]"
                />
                <button
                  onClick={() => pg.body_text && toggleExpand(pg.id)}
                  className={`mt-0.5 shrink-0 ${pg.body_text ? "text-foreground-muted hover:text-foreground" : "text-transparent"}`}
                >
                  {expanded.has(pg.id) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">
                      {pg.title || "(no title)"}
                    </span>
                    <a
                      href={pg.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      <ExternalLink className="h-3 w-3 text-foreground-muted hover:text-accent" />
                    </a>
                  </div>
                  <div className="font-mono text-xs text-foreground-muted truncate">{pg.url}</div>
                  {pg.meta_description && (
                    <div className="mt-1 text-xs text-foreground-secondary line-clamp-2">
                      {pg.meta_description}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteOne(pg.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-foreground-muted hover:text-red-400 transition-opacity"
                  title="Delete page"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {expanded.has(pg.id) && pg.body_text && (
                <div className="mx-4 mb-3 ml-14 max-h-64 overflow-y-auto rounded border border-[var(--border)] bg-surface-secondary p-3">
                  <pre className="whitespace-pre-wrap text-xs text-foreground-secondary font-sans">
                    {pg.body_text}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <PaginationBar
        page={pag.page}
        totalPages={pag.totalPages}
        from={pag.from}
        to={pag.to}
        total={pag.total}
        onPageChange={pag.setPage}
      />
    </div>
  );
}
