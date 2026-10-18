FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=7860 PUBLIC_ORIGIN=https://philosophia-promotion-agent.ms.show PLATFORM_PROXY_HOST=1
COPY --chown=node:node backend/marketing /app/backend/marketing
COPY --chown=node:node contracts /app/contracts
COPY --chown=node:node frontend/cloud /app/frontend/cloud
COPY --chown=node:node data/official /app/data/official
USER node
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:7860/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "backend/marketing/cloud-server.js"]
