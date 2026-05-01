# Match Kasm Workspaces release on your server (Admin → About). Wrong minor = broken sessions/streaming.
ARG KASM_CHROME_TAG=1.15.0
FROM kasmweb/chrome:${KASM_CHROME_TAG}

# Official Linux bundle (bundled CPython + wheels). Avoids pip on Kasm's older system Python.
ARG MITMPROXY_VERSION=11.0.2

USER root

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libnss3-tools \
    && mkdir -p /opt/mitmproxy-bin \
    && curl -fsSL \
        "https://downloads.mitmproxy.org/${MITMPROXY_VERSION}/mitmproxy-${MITMPROXY_VERSION}-linux-x86_64.tar.gz" \
        -o /tmp/mitm.tgz \
    && tar -xzf /tmp/mitm.tgz -C /opt/mitmproxy-bin \
    && ln -sf /opt/mitmproxy-bin/mitmdump /usr/local/bin/mitmdump \
    && ln -sf /opt/mitmproxy-bin/mitmproxy /usr/local/bin/mitmproxy \
    && rm /tmp/mitm.tgz \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/opt/chrome/policies/managed \
    /etc/chromium/policies/managed \
    /opt/soc \
    /home/kasm-user/.mitmproxy \
    && chown -R 1000:0 /home/kasm-user/.mitmproxy

COPY chrome-policies/managed/mitm-proxy.json /etc/opt/chrome/policies/managed/mitm-proxy.json
COPY chrome-policies/managed/mitm-proxy.json /etc/chromium/policies/managed/mitm-proxy.json

COPY mitm_addon.py /opt/soc/mitm_addon.py
COPY entrypoint.sh /usr/local/bin/kasm-mitm-entrypoint.sh
COPY kasm-mitm-nss-trust.sh /usr/local/bin/kasm-mitm-nss-trust.sh

RUN chmod +x /usr/local/bin/kasm-mitm-entrypoint.sh /usr/local/bin/kasm-mitm-nss-trust.sh /opt/soc/mitm_addon.py

# Writable by kasm-user (UID 1000). Stock kasmweb/chrome never runs workspace sessions as root.
ENV MITM_LISTEN_PORT=8080 \
    MITM_CONFDIR=/home/kasm-user/.mitmproxy

USER 1000

ENTRYPOINT ["/usr/local/bin/kasm-mitm-entrypoint.sh"]
CMD ["--wait"]
