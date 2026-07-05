// Generates the Deckord app + tray icons with @napi-rs/canvas.
// Motif: a Discord-blurple rounded square holding a 3x2 deck of keys, one lit
// green (a participant speaking) — the app in one glyph.
//
//   node apps/deckord-desktop/scripts/generate-icons.mjs
//
// Output (committed, consumed by electron-builder + the tray):
//   assets/icon.png   1024x1024  (electron-builder derives .ico/.icns/linux)
//   assets/tray.png   32x32      (system tray)
//   assets/tray@2x.png 64x64     (hi-dpi tray)

import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(here, '..', 'assets');
mkdirSync(assetsDir, { recursive: true });

const BLURPLE = '#5865f2';
const KEY = '#f2f3f5';
const SPEAKING = '#23a55a';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawIcon(size, { bg = true } = {}) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const s = size;

  if (bg) {
    ctx.fillStyle = BLURPLE;
    roundRect(ctx, 0, 0, s, s, s * 0.22);
    ctx.fill();
  }

  const cols = 3;
  const rows = 2;
  const pad = s * (bg ? 0.18 : 0.08);
  const gap = s * 0.06;
  const gridW = s - pad * 2;
  const keyW = (gridW - gap * (cols - 1)) / cols;
  const keyH = keyW;
  const gridH = keyH * rows + gap * (rows - 1);
  const startY = (s - gridH) / 2;
  const keyR = keyW * 0.24;

  let i = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = pad + col * (keyW + gap);
      const y = startY + row * (keyH + gap);
      // One key lit green (a participant speaking).
      ctx.fillStyle = i === 1 ? SPEAKING : KEY;
      roundRect(ctx, x, y, keyW, keyH, keyR);
      ctx.fill();
      i++;
    }
  }
  return c.toBuffer('image/png');
}

const outputs = [
  ['icon.png', drawIcon(1024)],
  ['tray.png', drawIcon(32)],
  ['tray@2x.png', drawIcon(64)],
];
for (const [name, buf] of outputs) {
  writeFileSync(path.join(assetsDir, name), buf);
  console.log(`wrote assets/${name} (${buf.length} bytes)`);
}
