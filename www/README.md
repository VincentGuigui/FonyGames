# www/

**Source** of the FonyGames site. Not what gets served — Vite compiles this to
`dist/`, and `dist/` is what the deploy uploads
([../docs/deployment.md](../docs/deployment.md) §5).

```bash
npm install
npm run dev        # dev server, bound to 0.0.0.0 so a phone on the LAN can open it
npm run build      # tsc --noEmit && vite build  ->  ../dist
```

| Path | What |
| --- | --- |
| `index.html` | Hub entry |
| `src/main.tsx` | Mounts the hub |
| `src/core/` | Shared runtime: types, room code, theme tokens |
| `src/hub/` | Catalogue rendering, cards, placeholder illustrations |
| `src/games/registry.ts` | The catalogue the hub renders |
| `public/` | Copied verbatim into the build |

Layout rules: [../docs/architecture.md](../docs/architecture.md) §3.
Code style: [../docs/conventions/code-style.md](../docs/conventions/code-style.md).
Design tokens live in `src/core/ui/theme.css` — never hardcode a colour.

This file is not deployed; only `dist/` is.
