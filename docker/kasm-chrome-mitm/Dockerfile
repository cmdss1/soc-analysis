ARG KASM_CHROME_TAG=1.15.0
FROM kasmweb/chrome:${KASM_CHROME_TAG}

USER root

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/mitm/venv \
    && /opt/mitm/venv/bin/pip install --no-cache-dir "mitmproxy>=10.3.0,<12"

RUN ln -sf /opt/mitm/venv/bin/mitmdump /usr/local/bin/mitmdump \
    && ln -sf /opt/mitm/venv/bin/mitmproxy /usr/local/bin/mitmproxy

RUN mkdir -p /etc/opt/chrome/policies/managed \
    /etc/chromium/policies/managed \
    /etc/mitmproxy/conf \
    /opt/soc

COPY chrome-policies/managed/mitm-proxy.json /etc/opt/chrome/policies/managed/mitm-proxy.json
COPY chrome-policies/managed/mitm-proxy.json /etc/chromium/policies/managed/mitm-proxy.json

COPY mitm_addon.py /opt/soc/mitm_addon.py
COPY entrypoint.sh /usr/local/bin/kasm-mitm-entrypoint.sh

RUN chmod +x /usr/local/bin/kasm-mitm-entrypoint.sh /opt/soc/mitm_addon.py

ENV MITM_LISTEN_PORT=8080 \
    MITM_CONFDIR=/etc/mitmproxy/conf \
    http_proxy=http://127.0.0.1:8080 \
    https_proxy=http://127.0.0.1:8080 \
    HTTP_PROXY=http://127.0.0.1:8080 \
    HTTPS_PROXY=http://127.0.0.1:8080 \
    NO_PROXY=localhost,127.0.0.1

ENTRYPOINT ["/usr/local/bin/kasm-mitm-entrypoint.sh"]
