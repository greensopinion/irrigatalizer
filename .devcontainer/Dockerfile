# Secure Node.js Development Container
# Purpose: Isolate Node.js/npm execution from Mac credentials
# See: docs/runbooks/initial-setup.md for usage

FROM node:24-bookworm

# Pin terraform-ls version for reproducibility
ARG TERRAFORM_LS_VERSION=0.38.7

# Install essential tools (no terraform CLI, no cloud CLIs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    build-essential \
    python3 \
    unzip \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install terraform-ls (language server only — no terraform binary)
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://releases.hashicorp.com/terraform-ls/${TERRAFORM_LS_VERSION}/terraform-ls_${TERRAFORM_LS_VERSION}_linux_${ARCH}.zip" \
    -o /tmp/terraform-ls.zip && \
    unzip /tmp/terraform-ls.zip -d /usr/local/bin && \
    rm /tmp/terraform-ls.zip && \
    chmod +x /usr/local/bin/terraform-ls

# Upgrade npm to v12 for allowScripts support
RUN npm install -g npm@12

# Pre-create workspace and node_modules with correct ownership (as root)
# When a Docker volume is mounted on node_modules, if the volume is empty,
# Docker copies the directory's ownership from the image to the volume.
RUN mkdir -p /workspace/node_modules && chown -R node:node /workspace

# Switch to non-root user
USER node
WORKDIR /home/node

# Configure git: disable credential helper, disable interactive prompts
RUN git config --global credential.helper "" && \
    git config --global core.askPass "" && \
    git config --global init.defaultBranch main

# Configure npm supply-chain protections at image level.
#
# Security-critical npm settings (min-release-age, strict-allow-scripts,
# dangerously-allow-all-scripts) are enforced via npm_config_* environment
# variables in docker-compose.yml.
#
# npm configuration precedence is:
# CLI > environment variables > project .npmrc > user .npmrc > global .npmrc.
#
# Therefore, a project-local .npmrc cannot silently weaken these settings.
# Note: command-line flags passed directly to npm have even higher precedence
# and can still override them.
#
# The ~/.npmrc below provides defaults and visibility (e.g., for `npm config list`).
# strict-npmrc=true catches unknown/typo'd keys (hard error instead of warning).
# audit=true is advisory-only so .npmrc is sufficient.
RUN echo "min-release-age=21" > ~/.npmrc && \
    echo "audit=true" >> ~/.npmrc && \
    echo "strict-npmrc=true" >> ~/.npmrc && \
    echo "strict-allow-scripts=true" >> ~/.npmrc

WORKDIR /workspace
