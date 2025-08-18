#!/usr/bin/env python3
"""
Depth-limited web crawler

Usage:
  python crawl_site.py <url> --depth 2 [--images-dir images] [--same-domain] [--delay 0.5]

Behavior:
- Crawls starting at <url>, following links up to --depth levels deep.
- Saves each fetched HTML page as an .html file in the current working directory.
- Downloads images to the specified images directory (default: ./images).
- By default, only follows links within the same domain as the starting URL.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import time
from collections import deque
from dataclasses import dataclass
from typing import Set, Tuple
from urllib.parse import urljoin, urlparse, urldefrag

import requests
from bs4 import BeautifulSoup


DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0.0.0 Safari/537.36 SiteCrawler/1.0"
)


@dataclass(frozen=True)
class CrawlConfig:
    start_url: str
    max_depth: int
    images_dir: str = "images"
    same_domain_only: bool = True
    delay_seconds: float = 0.5
    timeout_seconds: float = 15.0
    max_pages: int | None = None  # Optional safety cap


def ensure_dir(path: str) -> None:
    if path and not os.path.exists(path):
        os.makedirs(path, exist_ok=True)


def normalize_url(base_url: str, link: str) -> str | None:
    if not link:
        return None

    link = link.strip()
    # Ignore non-http(s) schemes and javascript/mailto/etc.
    if link.startswith(("javascript:", "mailto:", "tel:", "data:")):
        return None

    # Resolve relative URLs
    absolute = urljoin(base_url, link)

    # Remove URL fragments
    absolute, _ = urldefrag(absolute)

    parsed = urlparse(absolute)
    if parsed.scheme not in ("http", "https"):
        return None
    return absolute


def same_domain(a: str, b: str) -> bool:
    pa, pb = urlparse(a), urlparse(b)
    return pa.netloc.lower() == pb.netloc.lower()


def html_filename_for_url(url: str) -> str:
    """Generate a safe, unique-ish HTML filename for a URL."""
    p = urlparse(url)
    path = p.path if p.path else "/"

    # Base name from netloc + path
    base = f"{p.netloc}{path}"
    if base.endswith("/"):
        base += "index"

    # Replace unsafe characters with _
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)

    # Hash query to avoid collisions when same path with different query
    qhash = ""
    if p.query:
        qhash = "-" + hashlib.sha1(p.query.encode("utf-8")).hexdigest()[:8]

    # Enforce a reasonable length
    if len(base) > 160:
        base = base[:120] + "-" + hashlib.sha1(base.encode("utf-8")).hexdigest()[:8]

    return f"{base}{qhash}.html"


def image_filename_for_url(img_url: str) -> str:
    p = urlparse(img_url)
    name = os.path.basename(p.path) or "image"
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    # Add a short hash to avoid collisions
    suffix = hashlib.sha1(img_url.encode("utf-8")).hexdigest()[:8]
    # Preserve extension if present, otherwise default to .bin (possibly replaced later)
    root, ext = os.path.splitext(name)
    ext = ext if ext else ".bin"
    return f"{root}-{suffix}{ext}"


def extract_links_and_images(html: str, base_url: str) -> Tuple[Set[str], Set[str]]:
    links: Set[str] = set()
    images: Set[str] = set()
    soup = BeautifulSoup(html, "html.parser")

    for a in soup.find_all("a", href=True):
        nu = normalize_url(base_url, a.get("href"))
        if nu:
            links.add(nu)

    for img in soup.find_all("img", src=True):
        iu = normalize_url(base_url, img.get("src"))
        if iu:
            images.add(iu)

    return links, images


def rewrite_image_sources(html: str, replacements: dict[str, str]) -> str:
    if not replacements:
        return html
    soup = BeautifulSoup(html, "html.parser")
    for img in soup.find_all("img", src=True):
        src = img.get("src")
        abs_src = normalize_url("", src) or src
        # Try direct first, then fall back to simple lookup if abs wasn't resolvable exactly
        if abs_src in replacements:
            img["src"] = replacements[abs_src]
        elif src in replacements:
            img["src"] = replacements[src]
    return str(soup)


def download_image(session: requests.Session, img_url: str, images_dir: str, timeout: float) -> str | None:
    try:
        resp = session.get(img_url, timeout=timeout, stream=True)
        resp.raise_for_status()
        ctype = resp.headers.get("Content-Type", "").lower()
        if not ctype.startswith("image/"):
            # Not an image; skip
            return None

        ensure_dir(images_dir)
        filename = image_filename_for_url(img_url)
        local_path = os.path.join(images_dir, filename)

        # Adjust extension if possible from content-type when we used .bin
        root, ext = os.path.splitext(local_path)
        if ext == ".bin":
            subtype = ctype.split("/", 1)[-1].split(";")[0]
            # Basic sanity for subtype
            if re.match(r"^[A-Za-z0-9.+-]+$", subtype):
                local_path = root + "." + subtype

        with open(local_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        return local_path
    except Exception:
        return None


def fetch_html(session: requests.Session, url: str, timeout: float) -> tuple[str | None, str | None]:
    """Return (html_text, content_type) or (None, None) on failure/not html."""
    try:
        resp = session.get(url, timeout=timeout)
        resp.raise_for_status()
        ctype = resp.headers.get("Content-Type", "").lower()
        if "text/html" not in ctype:
            return None, None
        resp.encoding = resp.apparent_encoding or resp.encoding
        return resp.text, ctype
    except Exception:
        return None, None


def crawl(config: CrawlConfig) -> None:
    session = requests.Session()
    session.headers.update({
        "User-Agent": DEFAULT_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })

    visited: Set[str] = set()
    queue: deque[Tuple[str, int]] = deque()
    queue.append((config.start_url, 0))

    pages_crawled = 0

    while queue:
        url, depth = queue.popleft()
        if url in visited:
            continue
        visited.add(url)

        if config.max_pages is not None and pages_crawled >= config.max_pages:
            break

        html, ctype = fetch_html(session, url, config.timeout_seconds)
        if html is None:
            continue  # Not HTML or failed

        # Collect and download images
        links, images = extract_links_and_images(html, url)

        img_replacements: dict[str, str] = {}
        for iu in images:
            local = download_image(session, iu, config.images_dir, config.timeout_seconds)
            if local:
                # Store relative path for rewriting
                img_replacements[iu] = os.path.relpath(local, os.getcwd())

        # Optionally rewrite image srcs to local paths
        html_to_save = rewrite_image_sources(html, img_replacements)

        # Save HTML file
        filename = html_filename_for_url(url)
        with open(filename, "w", encoding="utf-8") as f:
            f.write(html_to_save)
        pages_crawled += 1

        # Enqueue child links if within depth
        if depth < config.max_depth:
            for link in links:
                if config.same_domain_only and not same_domain(config.start_url, link):
                    continue
                if link not in visited:
                    queue.append((link, depth + 1))

        # Be polite
        if config.delay_seconds > 0:
            time.sleep(config.delay_seconds)


def parse_args() -> CrawlConfig:
    p = argparse.ArgumentParser(description="Depth-limited website crawler")
    p.add_argument("url", help="Starting URL to crawl")
    p.add_argument("--depth", type=int, default=1, help="Maximum link depth to follow (default: 1)")
    p.add_argument("--images-dir", default="images", help="Directory to save images (default: images)")
    p.add_argument(
        "--same-domain", action=argparse.BooleanOptionalAction, default=True,
        help="Restrict crawling to the same domain as the starting URL (default: true)"
    )
    p.add_argument("--delay", type=float, default=0.5, help="Delay in seconds between requests (default: 0.5)")
    p.add_argument("--timeout", type=float, default=15.0, help="Per-request timeout in seconds (default: 15)")
    p.add_argument("--max-pages", type=int, default=None, help="Optional safety cap on total pages crawled")
    args = p.parse_args()

    # Ensure images dir path is relative to current working directory on save
    images_dir = args.images_dir

    return CrawlConfig(
        start_url=args.url,
        max_depth=max(0, args.depth),
        images_dir=images_dir,
        same_domain_only=bool(args.same_domain),
        delay_seconds=max(0.0, args.delay),
        timeout_seconds=max(1.0, args.timeout),
        max_pages=args.max_pages,
    )


def main() -> None:
    cfg = parse_args()
    crawl(cfg)


if __name__ == "__main__":
    main()
