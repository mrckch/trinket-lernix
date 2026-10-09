# Trinket Lernix – App-Image
#
# Läuft hinter dem externen Nginx Proxy Manager (TLS endet dort), siehe docs/lernix/PLAN.md.
# Die Konfiguration kommt ausschließlich aus Umgebungsvariablen; docker/entrypoint.sh
# erzeugt daraus beim Start config/local.yaml.

FROM node:20-bookworm-slim

# git: Abhängigkeit "marked" kommt aus einem GitHub-Fork; build-essential/python3: native Module
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r trinket \
    && useradd -r -g trinket -m -c "trinket user" trinket \
    && mkdir -p /usr/local/node/trinket \
    && chown trinket:trinket /usr/local/node/trinket

WORKDIR /usr/local/node/trinket

# Ab hier als App-Benutzer, damit node_modules, Komponenten und CSS ihm gehören
# (nötig für `npm install` im Dev-Container mit gemountetem Quellcode).
USER trinket

# Abhängigkeiten zuerst (Layer-Cache), inkl. devDependencies für den CSS-Build (vite, sass)
COPY --chown=trinket:trinket package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --include=dev \
    && npm cache clean --force

COPY --chown=trinket:trinket . .

# Frontend-Komponenten (Ace, Skulpt, Blockly, GlowScript …) liegen nicht im Repo,
# sondern als Tarball im GitHub-Release. Überschreibbar mit --build-arg COMPONENTS_URL=…
ARG COMPONENTS_URL=https://github.com/trinketapp/trinket-oss/releases/download/v1.1.0/public-components.tgz
RUN curl -fsSL -o /tmp/public-components.tgz "$COMPONENTS_URL" \
    && tar xzf /tmp/public-components.tgz \
    && rm /tmp/public-components.tgz \
    && test -d public/components

# SCSS → public/css/*.css
RUN npm run build:css \
    && chmod +x docker/entrypoint.sh

ENV NODE_ENV=production \
    NODE_CONFIG_PERSIST_ON_CHANGE=N

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:3000/healthz || exit 1

ENTRYPOINT ["/usr/local/node/trinket/docker/entrypoint.sh"]
CMD ["node", "app.js"]
