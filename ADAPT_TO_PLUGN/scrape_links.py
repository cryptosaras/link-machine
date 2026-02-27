#!/usr/bin/env python3
"""
Fast async internal link scraper with link type classification.
Uses aiohttp + selectolax for maximum speed.
Queue-based worker pool: workers pull URLs from queue, fetch, parse,
and push newly discovered links back into the queue.

Each link is classified by type (product, post, page, category, etc.)
based on sitemap source and URL patterns.

Usage:
    python scrape_links.py https://example.com
    python scrape_links.py https://example.com/sitemap_index.xml
    python scrape_links.py https://example.com --depth 3 --concurrent 50
"""

import argparse
import asyncio
import csv
import random
import re
import sys
import time
from collections import Counter
from urllib.parse import urljoin, urlparse, urlunparse, parse_qs, urlencode

import aiohttp
from selectolax.lexbor import LexborHTMLParser

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
]

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "ref", "fbclid", "gclid", "mc_cid", "mc_eid", "msclkid", "_ga",
}

LOC_RE = re.compile(r"<loc>\s*(.*?)\s*</loc>", re.IGNORECASE)

SKIP_EXTENSIONS = frozenset((
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
    ".css", ".js", ".woff", ".woff2", ".ttf", ".eot",
    ".mp3", ".mp4", ".avi", ".mov", ".wmv", ".flv",
    ".zip", ".tar", ".gz", ".rar", ".7z",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".rss", ".atom",
))

# Sitemap filename patterns → link type
SITEMAP_TYPE_PATTERNS = [
    (re.compile(r"product-sitemap", re.IGNORECASE), "product"),
    (re.compile(r"post-sitemap", re.IGNORECASE), "post"),
    (re.compile(r"page-sitemap", re.IGNORECASE), "page"),
    (re.compile(r"category-sitemap", re.IGNORECASE), "category"),
    (re.compile(r"local-sitemap", re.IGNORECASE), "local"),
    (re.compile(r"tag-sitemap", re.IGNORECASE), "tag"),
    (re.compile(r"author-sitemap", re.IGNORECASE), "author"),
]

# URL path patterns for inferring type when not from sitemap
URL_TYPE_PATTERNS = [
    (re.compile(r"/produkto-kategorija/|/product-category/|/kategoria/"), "category"),
    (re.compile(r"/category/|/kategorija/"), "category"),
    (re.compile(r"/tag/|/tags/"), "tag"),
    (re.compile(r"/product/|/shop/|/produktas/"), "product"),
    (re.compile(r"/blog/|/post/|/news/|/naujienos/"), "post"),
    (re.compile(r"/author/|/autorius/"), "author"),
    (re.compile(r"/cart|/krepselis|/checkout|/atsiskaitymas"), "shop-page"),
    (re.compile(r"/my-account|/paskyra|/wishlist|/palyginimas"), "shop-page"),
    (re.compile(r"\.(kml|xml)$"), "data"),
]


def random_headers() -> dict[str, str]:
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
    }


def normalize_url(url: str, base_url: str) -> str | None:
    url = urljoin(base_url, url)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return None
    scheme = parsed.scheme.lower()
    host = (parsed.hostname or "").lower()
    if not host:
        return None
    port = parsed.port
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        port = None
    netloc = host + (f":{port}" if port else "")
    path = parsed.path.rstrip("/") or "/"
    params = parse_qs(parsed.query, keep_blank_values=False)
    filtered = {k: v for k, v in sorted(params.items()) if k not in TRACKING_PARAMS}
    query = urlencode(filtered, doseq=True)
    return urlunparse((scheme, netloc, path, "", query, ""))


def is_sitemap_content(text: str) -> bool:
    start = text[:4000]
    return "<urlset" in start or "<sitemapindex" in start


def extract_sitemap_urls(text: str) -> list[str]:
    return [url.strip() for url in LOC_RE.findall(text) if url.strip()]


def extract_html_links(html: str, page_url: str) -> set[str]:
    tree = LexborHTMLParser(html)
    links = set()
    for node in tree.css("a[href]"):
        href = node.attrs.get("href", "")
        if href:
            norm = normalize_url(href, page_url)
            if norm:
                links.add(norm)
    return links


def type_from_sitemap_url(sitemap_url: str) -> str:
    """Infer link type from the sitemap filename."""
    filename = urlparse(sitemap_url).path.split("/")[-1].lower()
    for pattern, link_type in SITEMAP_TYPE_PATTERNS:
        if pattern.search(filename):
            return link_type
    return "other"


def type_from_url_path(url: str) -> str:
    """Infer link type from URL path patterns."""
    path = urlparse(url).path.lower()
    for pattern, link_type in URL_TYPE_PATTERNS:
        if pattern.search(path):
            return link_type
    # Heuristic: deep paths with many segments are likely products
    segments = [s for s in path.split("/") if s]
    if len(segments) >= 3:
        return "product"
    if len(segments) == 0 or path == "/":
        return "page"
    return "other"


class Crawler:
    def __init__(
        self,
        start_url: str,
        max_depth: int = 0,
        max_pages: int = 10000,
        max_concurrent: int = 30,
        delay: float = 0.1,
        timeout: float = 5.0,
        verbose: bool = False,
    ):
        parsed = urlparse(start_url)
        self.domain = (parsed.hostname or "").lower()
        self.start_url = normalize_url(start_url, start_url) or start_url
        self.max_depth = max_depth
        self.max_pages = max_pages
        self.max_concurrent = max_concurrent
        self.delay = delay
        self.timeout = timeout
        self.verbose = verbose

        # Dedup: URLs already queued for fetching
        self.queued: set[str] = set()
        # ALL internal links: url -> type
        self.all_internal_links: dict[str, str] = {}
        # Counters
        self.pages_crawled = 0
        self.sitemaps_processed = 0
        self.fetched_count = 0
        self.error_count = 0
        self.t0 = 0.0
        self._done = False

    def _is_internal(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        return host == self.domain or host.endswith(f".{self.domain}")

    def _skip_extension(self, url: str) -> bool:
        path = urlparse(url).path.lower()
        return any(path.endswith(ext) for ext in SKIP_EXTENSIONS)

    def _set_link_type(self, url: str, link_type: str):
        """Set link type. Sitemap-derived types take priority over inferred ones."""
        existing = self.all_internal_links.get(url)
        if existing is None or existing == "other":
            self.all_internal_links[url] = link_type

    async def _fetch(self, session: aiohttp.ClientSession, url: str) -> str | None:
        """Fetch URL with streaming — keeps partial HTML on timeout instead of discarding."""
        try:
            # Connection timeout is short (fail fast if server unreachable).
            # Body reading uses our own deadline so we keep partial data.
            async with session.get(
                url,
                headers=random_headers(),
                timeout=aiohttp.ClientTimeout(
                    sock_connect=min(self.timeout, 10),
                    sock_read=None,       # we handle read timeout ourselves
                    total=None,
                ),
                allow_redirects=True,
                ssl=False,
            ) as resp:
                if resp.status == 200:
                    ct = resp.headers.get("Content-Type", "")
                    if "text/html" in ct or "xml" in ct or "text/plain" in ct:
                        # Stream body with deadline — keep whatever we got
                        chunks = bytearray()
                        partial = False
                        deadline = asyncio.get_event_loop().time() + self.timeout
                        try:
                            while True:
                                remaining = deadline - asyncio.get_event_loop().time()
                                if remaining <= 0:
                                    partial = True
                                    break
                                chunk = await asyncio.wait_for(
                                    resp.content.readany(), timeout=remaining
                                )
                                if not chunk:
                                    break  # EOF — full body received
                                chunks.extend(chunk)
                        except (asyncio.TimeoutError, TimeoutError):
                            partial = True

                        if not chunks:
                            if self.verbose:
                                print(f"  [empty] {url}", flush=True)
                            self.error_count += 1
                            return None

                        if partial and self.verbose:
                            print(
                                f"  [partial] {len(chunks)} bytes before timeout: {url}",
                                flush=True,
                            )
                        return bytes(chunks).decode("utf-8", errors="replace")

                    if self.verbose:
                        print(f"  [skip] non-html ({ct[:40]}) {url}", flush=True)
                    return None
                if self.verbose:
                    print(f"  [{resp.status}] {url}", flush=True)
                self.error_count += 1
                return None
        except asyncio.TimeoutError:
            # Connection timeout — server didn't respond at all
            if self.verbose:
                print(f"  [connect timeout] {url}", flush=True)
            self.error_count += 1
            return None
        except (aiohttp.ClientError, UnicodeDecodeError) as e:
            if self.verbose:
                print(f"  [error] {type(e).__name__} {url}", flush=True)
            self.error_count += 1
            return None

    def _enqueue(self, queue: asyncio.Queue, url: str, depth: int) -> bool:
        if url not in self.queued:
            self.queued.add(url)
            queue.put_nowait((url, depth))
            return True
        return False

    async def _worker(self, worker_id: int, queue: asyncio.Queue, session: aiohttp.ClientSession):
        while not self._done:
            try:
                url, depth = await asyncio.wait_for(queue.get(), timeout=3.0)
            except asyncio.TimeoutError:
                if queue.empty():
                    break
                continue

            try:
                if self.fetched_count >= self.max_pages:
                    queue.task_done()
                    break

                if self.delay > 0:
                    await asyncio.sleep(random.uniform(0, self.delay))

                text = await self._fetch(session, url)
                self.fetched_count += 1

                if text is None:
                    queue.task_done()
                    continue

                if is_sitemap_content(text):
                    self._process_sitemap(queue, url, text, depth)
                else:
                    self._process_html(queue, url, text, depth)

            except Exception as e:
                print(f"  [WORKER ERROR] {type(e).__name__}: {e} on {url}", flush=True)
                self.error_count += 1
            finally:
                queue.task_done()

    def _process_sitemap(self, queue: asyncio.Queue, url: str, text: str, depth: int):
        raw_urls = extract_sitemap_urls(text)
        queued_count = 0
        sitemap_type = type_from_sitemap_url(url)

        for link in raw_urls:
            norm = normalize_url(link, url)
            if not norm:
                continue
            if self._is_internal(norm):
                # Check if child URL is itself a sitemap (ends with .xml)
                if norm.endswith(".xml"):
                    # It's a child sitemap reference, queue it
                    if self._enqueue(queue, norm, depth + 1):
                        queued_count += 1
                else:
                    # It's a content URL — tag with type from parent sitemap
                    self._set_link_type(norm, sitemap_type)
                    if not self._skip_extension(norm):
                        if self._enqueue(queue, norm, depth + 1):
                            queued_count += 1

        self.sitemaps_processed += 1
        print(
            f"[sitemap #{self.sitemaps_processed}] {url} "
            f"-> {len(raw_urls)} URLs ({sitemap_type}), {queued_count} new queued "
            f"(queue size: {queue.qsize()})",
            flush=True,
        )

    def _process_html(self, queue: asyncio.Queue, url: str, text: str, depth: int):
        html_links = extract_html_links(text, url)
        internal_count = 0
        new_queued = 0

        # The page itself
        if url not in self.all_internal_links:
            self._set_link_type(url, type_from_url_path(url))

        for link in html_links:
            if not self._is_internal(link):
                continue
            internal_count += 1
            # Add link — only infer type if not already known from sitemap
            if link not in self.all_internal_links:
                self._set_link_type(link, type_from_url_path(link))
            # Queue for crawling
            if not self._skip_extension(link):
                if self.max_depth == 0 or depth < self.max_depth:
                    if self._enqueue(queue, link, depth + 1):
                        new_queued += 1

        self.pages_crawled += 1
        elapsed = time.monotonic() - self.t0
        rate = self.fetched_count / elapsed if elapsed > 0 else 0
        if self.verbose or self.pages_crawled % 100 == 0:
            print(
                f"[page:{self.pages_crawled} | links:{len(self.all_internal_links)} | "
                f"fetched:{self.fetched_count} | {rate:.1f} pg/s] {url} "
                f"({internal_count} internal, {new_queued} new queued)",
                flush=True,
            )

    async def crawl(self) -> dict[str, str]:
        connector = aiohttp.TCPConnector(
            limit=self.max_concurrent * 2,
            limit_per_host=self.max_concurrent,
            ttl_dns_cache=300,
            use_dns_cache=True,
            enable_cleanup_closed=True,
            force_close=False,
        )

        queue: asyncio.Queue = asyncio.Queue()
        self._enqueue(queue, self.start_url, 0)
        self.t0 = time.monotonic()

        async with aiohttp.ClientSession(connector=connector) as session:
            workers = [
                asyncio.create_task(self._worker(i, queue, session))
                for i in range(self.max_concurrent)
            ]
            await queue.join()
            self._done = True
            for w in workers:
                w.cancel()
            await asyncio.gather(*workers, return_exceptions=True)

        return self.all_internal_links


def main():
    parser = argparse.ArgumentParser(
        description="Fast async internal link scraper with type classification",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
examples:
  python scrape_links.py https://example.com
  python scrape_links.py https://example.com/sitemap_index.xml
  python scrape_links.py https://example.com --depth 3
  python scrape_links.py https://example.com --depth 0 --concurrent 50
        """,
    )
    parser.add_argument("url", help="Starting URL or sitemap URL to crawl")
    parser.add_argument(
        "--depth", type=int, default=0,
        help="Max crawl depth (0 = unlimited, default: 0)",
    )
    parser.add_argument(
        "--max-pages", type=int, default=10000,
        help="Max pages to fetch (default: 10000)",
    )
    parser.add_argument(
        "--concurrent", type=int, default=30,
        help="Max concurrent workers (default: 30)",
    )
    parser.add_argument(
        "--delay", type=float, default=0.1,
        help="Max random delay per request in seconds (default: 0.1)",
    )
    parser.add_argument(
        "--timeout", type=float, default=5.0,
        help="Request timeout in seconds (default: 5)",
    )
    parser.add_argument(
        "--output", "-o", type=str, default=None,
        help="Save results to CSV file (url,type)",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Show errors, skips, and per-page stats",
    )

    args = parser.parse_args()

    parsed = urlparse(args.url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        print(f"Error: Invalid URL: {args.url}", file=sys.stderr)
        sys.exit(1)

    crawler = Crawler(
        start_url=args.url,
        max_depth=args.depth,
        max_pages=args.max_pages,
        max_concurrent=args.concurrent,
        delay=args.delay,
        timeout=args.timeout,
        verbose=args.verbose,
    )

    depth_str = "unlimited" if args.depth == 0 else str(args.depth)
    print(f"Crawling: {args.url}")
    print(f"Domain: {crawler.domain}")
    print(f"Config: depth={depth_str}, max_pages={args.max_pages}, "
          f"concurrent={args.concurrent}, delay={args.delay}s, timeout={args.timeout}s")
    print("-" * 70)

    t_start = time.monotonic()
    links = asyncio.run(crawler.crawl())
    elapsed = time.monotonic() - t_start

    # Count by type
    type_counts = Counter(links.values())

    print("\n" + "=" * 70)
    print(f"DONE in {elapsed:.2f}s")
    print(f"Pages fetched: {crawler.fetched_count}")
    print(f"  Sitemaps processed: {crawler.sitemaps_processed}")
    print(f"  HTML pages crawled: {crawler.pages_crawled}")
    print(f"Unique internal links found: {len(links)}")
    print(f"Errors: {crawler.error_count}")
    if elapsed > 0:
        print(f"Speed: {crawler.fetched_count / elapsed:.1f} pages/sec")
    print()
    print("Links by type:")
    for link_type, count in type_counts.most_common():
        print(f"  {link_type:>12}: {count}")
    print("=" * 70)

    if args.output:
        with open(args.output, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["url", "type"])
            for url, link_type in sorted(links.items()):
                writer.writerow([url, link_type])
        print(f"Saved {len(links)} links to: {args.output}")
    else:
        # Print grouped by type
        by_type: dict[str, list[str]] = {}
        for url, link_type in links.items():
            by_type.setdefault(link_type, []).append(url)

        for link_type in sorted(by_type):
            urls = sorted(by_type[link_type])
            print(f"\n--- {link_type.upper()} ({len(urls)}) ---")
            for url in urls:
                print(f"  {url}")


if __name__ == "__main__":
    main()
