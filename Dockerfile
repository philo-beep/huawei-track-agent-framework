FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=7860 \
    PLATFORM_PROXY_HOST=1 \
    PUBLIC_ORIGIN=https://philosophia-promotion-agent.ms.show

COPY huawei-sales-agent/ /app/huawei-sales-agent/
COPY huawei-sales-agent-data/ /app/huawei-sales-agent-data/
COPY README.md /app/README.md
COPY 团队协作与分工说明.md /app/团队协作与分工说明.md
COPY 文件归属与责任矩阵.md /app/文件归属与责任矩阵.md

WORKDIR /app/huawei-sales-agent

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python3 -c "import urllib.request; r=urllib.request.urlopen('http://127.0.0.1:7860/api/health', timeout=4); raise SystemExit(0 if r.status == 200 else 1)"

CMD ["python3", "backend/main.py", "--host", "0.0.0.0", "--port", "7860"]

