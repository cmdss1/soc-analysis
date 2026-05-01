from __future__ import annotations

import ipaddress
from urllib.parse import urlparse


class UrlRejected(ValueError):
    pass


def validate_target_url(raw: str, *, block_private_ips: bool) -> str:
    raw = (raw or "").strip()
    if len(raw) > 8192:
        raise UrlRejected("URL too long")
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise UrlRejected("Only http and https URLs are allowed")
    host = parsed.hostname
    if not host:
        raise UrlRejected("Missing host")
    if "\x00" in raw:
        raise UrlRejected("Invalid URL")

    if block_private_ips:
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
            ):
                raise UrlRejected("Blocked target IP range")

    return raw
