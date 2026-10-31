# syntax=docker/dockerfile:1
# The image every Orbital session runs in: Claude Code inside tmux, with git, gh, the AWS
# CLI and the usual tools. One image is shared by all sessions; their repos, homes and
# agent config live in the sessions volume, so containers are disposable.
#
# AGENTS="claude codex gemini" also installs OpenAI's Codex CLI and Google's Gemini CLI
# (published as the :latest-all tag), for sessions on OpenAI or Google accounts.
FROM node:24-trixie-slim

# npm dist-tag or exact version, e.g. stable, latest, 2.1.310.
ARG CLAUDE_CODE_VERSION=stable
ARG AGENTS="claude"
ARG CODEX_VERSION=latest
ARG GEMINI_CLI_VERSION=latest

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates curl git gh tmux ripgrep jq less procps openssh-client \
		python3 python3-venv make g++ unzip xz-utils tini locales \
	&& rm -rf /var/lib/apt/lists/*

# The npm package ships the same native binary as the standalone installer. Updates come
# with a new image (sessions keep running the version they started with).
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
	&& npm cache clean --force \
	&& claude --version

RUN set -e; \
	pkgs=""; \
	case " $AGENTS " in *" codex "*) pkgs="$pkgs @openai/codex@${CODEX_VERSION}" ;; esac; \
	case " $AGENTS " in *" gemini "*) pkgs="$pkgs @google/gemini-cli@${GEMINI_CLI_VERSION}" ;; esac; \
	if [ -n "$pkgs" ]; then npm install -g $pkgs && npm cache clean --force; fi

# The AWS CLI (v2, the official build for this architecture), for sessions with AWS profiles.
# Orbital writes their credentials as the standard files (AWS_SHARED_CREDENTIALS_FILE).
ARG TARGETARCH
RUN set -e; \
	arch=$([ "$TARGETARCH" = arm64 ] && echo aarch64 || echo x86_64); \
	curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${arch}.zip" -o /tmp/awscli.zip; \
	unzip -q /tmp/awscli.zip -d /tmp; \
	/tmp/aws/install; \
	rm -rf /tmp/aws /tmp/awscli.zip; \
	aws --version

COPY tmux.conf /etc/tmux.conf
COPY gitconfig /etc/gitconfig
COPY --chmod=755 bin/ /usr/local/bin/
COPY lib/ /usr/local/lib/orb/

RUN mkdir -p /workspace /claude /codex /gemini && chown node:node /workspace /claude /codex /gemini

ENV LANG=C.UTF-8 \
	TERM=xterm-256color \
	COLORTERM=truecolor \
	SHELL=/bin/bash \
	DISABLE_AUTOUPDATER=1 \
	CLAUDE_CONFIG_DIR=/claude

LABEL org.opencontainers.image.source=https://github.com/vitafortis/Orbital
USER node
WORKDIR /workspace
ENTRYPOINT ["tini", "--", "/usr/local/bin/orb-entrypoint"]
