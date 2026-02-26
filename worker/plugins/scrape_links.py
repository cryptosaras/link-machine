"""
Scrape Links plugin — adapted for worker execution.
Entry point: run(params, callbacks)
"""
import asyncio
import random
import re
import time
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


def random_headers():
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    }


def normalize_url(url, base_url):
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


def is_sitemap_content(text):
    start = text[:4000]
    return "<urlset" in start or "<sitemapindex" in start


def extract_sitemap_urls(text):
    return [url.strip() for url in LOC_RE.findall(text) if url.strip()]


def extract_html_links(html, page_url):
    tree = LexborHTMLParser(html)
    links = set()
    for node in tree.css("a[href]"):
        href = node.attrs.get("href", "")
        if href:
            norm = normalize_url(href, page_url)
            if norm:
                links.add(norm)
    return links


class PluginCrawler:
    def __init__(self, start_url, max_depth=0, max_pages=10000,
                 max_concurrent=30, delay=0.1, timeout=5.0):
        parsed = urlparse(start_url)
        self.domain = (parsed.hostname or "").lower()
        self.start_url = normalize_url(start_url, start_url) or start_url
        self.max_depth = max_depth
        self.max_pages = max_pages
        self.max_concurrent = max_concurrent
        self.delay = delay
        self.timeout = timeout
        self.queued = set()
        self.all_internal_links = set()
        self.pages_crawled = 0
        self.sitemaps_processed = 0
        self.fetched_count = 0
        self.error_count = 0
        self.t0 = 0.0
        self._done = False

    def _is_internal(self, url):
        host = (urlparse(url).hostname or "").lower()
        return host == self.domain or host.endswith(f".{self.domain}")

    def _skip_extension(self, url):
        path = urlparse(url).path.lower()
        return any(path.endswith(ext) for ext in SKIP_EXTENSIONS)

    async def _fetch(self, session, url):
        try:
            async with session.get(
                url, headers=random_headers(),
                timeout=aiohttp.ClientTimeout(total=self.timeout),
                allow_redirects=True, ssl=False,
            ) as resp:
                if resp.status == 200:
                    ct = resp.headers.get("Content-Type", "")
                    if "text/html" in ct or "xml" in ct or "text/plain" in ct:
                        raw = await resp.read()
                        return raw.decode("utf-8", errors="replace")
                    return None
                self.error_count += 1
                return None
        except (asyncio.TimeoutError, aiohttp.ClientError, UnicodeDecodeError):
            self.error_count += 1
            return None

    def _enqueue(self, queue, url, depth):
        if url not in self.queued:
            self.queued.add(url)
            queue.put_nowait((url, depth))
            return True
        return False

    async def _worker(self, queue, session):
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
            except Exception:
                self.error_count += 1
            finally:
                queue.task_done()

    def _process_sitemap(self, queue, url, text, depth):
        raw_urls = extract_sitemap_urls(text)
        for link in raw_urls:
            norm = normalize_url(link, url)
            if not norm:
                continue
            if self._is_internal(norm):
                self.all_internal_links.add(norm)
                if not self._skip_extension(norm):
                    self._enqueue(queue, norm, depth + 1)
        self.sitemaps_processed += 1

    def _process_html(self, queue, url, text, depth):
        html_links = extract_html_links(text, url)
        self.all_internal_links.add(url)
        for link in html_links:
            if not self._is_internal(link):
                continue
            self.all_internal_links.add(link)
            if not self._skip_extension(link):
                if self.max_depth == 0 or depth < self.max_depth:
                    self._enqueue(queue, link, depth + 1)
        self.pages_crawled += 1

    async def crawl(self, progress_callback=None):
        connector = aiohttp.TCPConnector(
            limit=self.max_concurrent * 2,
            limit_per_host=self.max_concurrent,
            ttl_dns_cache=300, use_dns_cache=True,
            enable_cleanup_closed=True, force_close=False,
        )
        queue = asyncio.Queue()
        self._enqueue(queue, self.start_url, 0)
        self.t0 = time.monotonic()

        async with aiohttp.ClientSession(connector=connector) as session:
            workers = [
                asyncio.create_task(self._worker(queue, session))
                for _ in range(self.max_concurrent)
            ]

            if progress_callback:
                async def report_loop():
                    while not self._done:
                        await asyncio.sleep(3)
                        elapsed = time.monotonic() - self.t0
                        rate = self.fetched_count / elapsed if elapsed > 0 else 0
                        await progress_callback({
                            "pages_fetched": self.fetched_count,
                            "links_found": len(self.all_internal_links),
                            "pages_crawled": self.pages_crawled,
                            "sitemaps_processed": self.sitemaps_processed,
                            "errors": self.error_count,
                            "rate": f"{rate:.1f} pg/s",
                        })
                report_task = asyncio.create_task(report_loop())

            await queue.join()
            self._done = True

            if progress_callback:
                report_task.cancel()

            for w in workers:
                w.cancel()
            await asyncio.gather(*workers, return_exceptions=True)

        return self.all_internal_links


async def run(params, report_progress, report_complete, upload_links):
    """Plugin entry point called by task_runner."""
    website_url = params.get("website_url", "")
    website_sitemap_url = params.get("website_sitemap_url")
    depth = params.get("depth", 0)
    max_pages = params.get("max_pages", 10000)
    concurrent = params.get("concurrent", 30)
    delay = params.get("delay", 0.1)
    timeout = params.get("timeout", 5.0)
    use_sitemap = params.get("use_sitemap", False)

    start_url = website_sitemap_url if (use_sitemap and website_sitemap_url) else website_url
    if not start_url:
        await report_complete("failed", error_message="No URL provided")
        return

    crawler = PluginCrawler(
        start_url=start_url,
        max_depth=depth,
        max_pages=max_pages,
        max_concurrent=concurrent,
        delay=delay,
        timeout=timeout,
    )

    try:
        links = await crawler.crawl(progress_callback=report_progress)

        link_list = sorted(links)
        for i in range(0, len(link_list), 500):
            batch = link_list[i:i+500]
            await upload_links(batch)

        elapsed = time.monotonic() - crawler.t0
        await report_complete("completed", result_summary={
            "total_links": len(links),
            "pages_crawled": crawler.pages_crawled,
            "sitemaps_processed": crawler.sitemaps_processed,
            "pages_fetched": crawler.fetched_count,
            "errors": crawler.error_count,
            "duration_seconds": round(elapsed, 2),
        })
    except Exception as e:
        await report_complete("failed", error_message=str(e))
