import { useState, useEffect, useCallback, useRef } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import api from "@/api/client";
import { Button } from "@/components/ui/button";
import { usePagination } from "./usePagination";
import { PaginationBar } from "./PaginationBar";

interface LinkItem {
  id: string;
  url: string;
  created_at: string;
}

interface Props {
  websiteId: string;
  onCountChange: () => void;
}

export default function LinksTab({ websiteId, onCountChange }: Props) {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lastCheckedIdx = useRef<number | null>(null);
  const pag = usePagination();

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/websites/${websiteId}/links/list`, {
        params: { page: pag.page, page_size: pag.pageSize, search: pag.debouncedSearch },
      });
      setLinks(res.data.items);
      pag.setTotal(res.data.total);
    } finally {
      setLoading(false);
    }
  }, [websiteId, pag.page, pag.pageSize, pag.debouncedSearch]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  useEffect(() => {
    setSelected(new Set());
    lastCheckedIdx.current = null;
  }, [pag.page, pag.debouncedSearch]);

  const toggleOne = (id: string, index: number, shiftKey: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedIdx.current !== null) {
        const start = Math.min(lastCheckedIdx.current, index);
        const end = Math.max(lastCheckedIdx.current, index);
        for (let i = start; i <= end; i++) {
          next.add(links[i].id);
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
    if (selected.size === links.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(links.map((l) => l.id)));
    }
  };

  const handleDeleteOne = async (id: string) => {
    await api.post(`/websites/${websiteId}/links/bulk-delete`, { ids: [id] });
    fetchLinks();
    onCountChange();
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      await api.post(`/websites/${websiteId}/links/bulk-delete`, { ids: Array.from(selected) });
      setSelected(new Set());
      fetchLinks();
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
          placeholder="Search links..."
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

      {loading && links.length === 0 ? (
        <div className="py-12 text-center text-foreground-muted">Loading...</div>
      ) : links.length === 0 ? (
        <div className="py-12 text-center text-foreground-muted">
          {pag.debouncedSearch ? "No links match your search." : "No links scraped yet."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] bg-surface-secondary">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={links.length > 0 && selected.size === links.length}
                    onChange={toggleAll}
                    className="rounded border-[var(--border)]"
                  />
                </th>
                <th className="px-4 py-2 text-left font-medium text-foreground-secondary">URL</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {links.map((link, idx) => (
                <tr key={link.id} className="bg-surface hover:bg-surface-tertiary group">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(link.id)}
                      onChange={(e) => toggleOne(link.id, idx, (e.nativeEvent as MouseEvent).shiftKey)}
                      className="rounded border-[var(--border)]"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground hover:text-accent truncate max-w-[800px]"
                    >
                      <span className="truncate">{link.url}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" />
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => handleDeleteOne(link.id)}
                      className="opacity-0 group-hover:opacity-100 text-foreground-muted hover:text-red-400 transition-opacity"
                      title="Delete link"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
