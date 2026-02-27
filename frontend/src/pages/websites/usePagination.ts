import { useState, useCallback, useRef, useEffect } from "react";

const STORAGE_KEY = "websiteDetailPageSize";

export function usePagination() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored) : 100;
  });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [total, setTotal] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    localStorage.setItem(STORAGE_KEY, String(size));
    setPage(1);
  }, []);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  }, []);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return {
    page,
    setPage,
    pageSize,
    setPageSize,
    search,
    debouncedSearch,
    handleSearch,
    total,
    setTotal,
    totalPages,
    from,
    to,
  };
}
