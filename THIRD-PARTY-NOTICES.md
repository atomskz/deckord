# Third-party notices

Deckord itself is released under the [MIT License](LICENSE).

Deckord bundles and/or depends on the third-party open-source packages listed
below. Each retains its own copyright and license; the full license texts are
distributed with each package inside `node_modules/<package>` (and, for the
packaged desktop app, alongside the Electron runtime).

## Runtime dependencies

All of Deckord's production dependencies are MIT-licensed:

| Package | Version | License |
| --- | --- | --- |
| `@napi-rs/canvas` (+ platform binaries) | 0.1.x | MIT |
| `ws` | 8.x | MIT |
| `zod` | 3.x | MIT |
| `react`, `react-dom` | 18.x | MIT |
| `scheduler`, `js-tokens`, `loose-envify` (transitive) | — | MIT |

## Desktop runtime

The desktop shell is built with **Electron**, which is MIT-licensed. Electron in
turn embeds **Chromium** and **Node.js**, which are distributed under their own
licenses (BSD-style and MIT/BSD respectively); their full license texts ship
inside the Electron distribution bundled by `electron-builder` (see the
`LICENSES.chromium.html` and `LICENSE` files in the packaged app).

## Build-time tools

Build/test tooling (TypeScript, Vite, esbuild, Vitest, ESLint, Prettier,
electron-builder) is MIT-licensed and is **not** distributed in the shipped
product.

---

A machine-readable summary can be regenerated at any time with:

```bash
pnpm licenses list --prod
```
