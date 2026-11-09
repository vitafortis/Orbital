# Orbital

- SvelteKit 3 + Svelte 5 runes + Tailwind 4, built with adapter-node. `server.js` is the production entry: it adds WebSocket upgrades (terminals), which adapter-node lacks; in dev, the plugin in `vite.config.ts` does the same.
- The theme is the shared ·modern palette (pg-modern, octo-modern, debrief) with primary hue 255. Keep `src/app.css` in step with those projects rather than inventing new tokens.
- Two images: the app (`Dockerfile`) and the session runtime (`session/Dockerfile`). The contract between them is the env vars set in `src/lib/server/sessions/runtime.ts`, the scripts in `session/bin`, `/session/.orb/launch.json` (Claude's argv, built by `claudeArgs` in `src/lib/launch.ts`), and `/session/.orb/mcp.json` (the Library's MCP servers, `src/lib/server/sessions/mcp.ts`).
- Claude Code's transcript format is internal and changes between versions: `src/lib/transcript.ts` must skip anything it doesn't recognise, never throw.
- Checks: `pnpm check`, `pnpm test`, `pnpm build`. With Docker available, `pnpm e2e` against a running instance.
