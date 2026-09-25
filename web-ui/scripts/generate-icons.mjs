/**
 * Generates the favicon / home-screen icon set from the canonical logo,
 * `assets/logo/zippy.svg`, into `web-ui/public/`.
 *
 * Run manually whenever the logo changes:  npm run generate:icons
 *
 * This is intentionally NOT part of `build`/`verify`: it needs the `sharp`
 * dev dependency and only needs to run when the source art changes, so the
 * generated PNGs are committed and served as static assets.
 *
 * Dark mode:
 * - The browser favicon (favicon.svg) carries a `prefers-color-scheme` style
 *   block, so the tab icon adapts to light/dark. Browsers that ignore it fall
 *   back to the light appearance.
 * - Home-screen icons (apple-touch-icon, Android manifest icons) are static:
 *   neither iOS nor Android swaps them by color scheme. They use a full-bleed
 *   brand-blue background that reads well on both light and dark home screens.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const sourcePath = resolve(repoRoot, "assets/logo/zippy.svg");
const publicDir = resolve(here, "..", "public");

// Background for opaque home-screen tiles and OS chrome. Matches the web UI's
// own background (`--bg` in web-ui/src/styles.css) so the icon, splash, and app
// feel continuous. The dark slate also gives the blue droplet strong contrast.
const tileBackground = "#0f172a";
const themeColor = "#0f172a";

const sourceSvg = readFileSync(sourcePath, "utf8");

mkdirSync(publicDir, { recursive: true });

const out = (name) => resolve(publicDir, name);

/** Render the logo, contained within `size`, centered, on a transparent canvas. */
async function renderContained(size, padding) {
  const inner = Math.round(size * (1 - padding * 2));
  const logo = await sharp(Buffer.from(sourceSvg), { density: 384 })
    .resize({
      width: inner,
      height: inner,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png();
}

/** Transparent icon (droplet only), contained with a little breathing room. */
async function transparentIcon(size, file, padding = 0.06) {
  await (await renderContained(size, padding)).toFile(out(file));
  return file;
}

/** Opaque tile with the droplet centered. `padding` is the safe-zone. */
async function brandTile(size, file, padding) {
  const contained = await renderContained(size, padding);
  const logoBuf = await contained.toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: tileBackground,
    },
  })
    .composite([{ input: logoBuf, gravity: "center" }])
    .png()
    .toFile(out(file));
  return file;
}

/**
 * A dark-mode-aware SVG favicon: the source art plus a style block that lightens
 * the droplet's darkest edges slightly in dark mode so it doesn't disappear
 * against a dark tab strip. The bolt and face stay as-is (already high contrast).
 */
function writeAdaptiveFavicon() {
  const darkStyle = `
  <style>
    @media (prefers-color-scheme: dark) {
      /* Nudge the droplet lighter so it stays legible on a dark tab bar. */
      :root { filter: brightness(1.12) saturate(1.05); }
    }
  </style>`;
  // Inject the style right after the opening <svg ...> tag.
  const withStyle = sourceSvg.replace(/(<svg\b[^>]*>)/, `$1${darkStyle}`);
  writeFileSync(out("favicon.svg"), withStyle);
  return "favicon.svg";
}

function writeManifest() {
  const manifest = {
    name: "Irrigatalizer",
    short_name: "Irrigatalizer",
    description:
      "Irrigation controller for a Raspberry Pi driving relay-operated valves.",
    start_url: "/",
    display: "standalone",
    background_color: tileBackground,
    theme_color: themeColor,
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
  writeFileSync(
    out("manifest.webmanifest"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return "manifest.webmanifest";
}

const written = [];
written.push(writeAdaptiveFavicon());
written.push(await transparentIcon(16, "favicon-16.png"));
written.push(await transparentIcon(32, "favicon-32.png"));

// iOS home-screen icon: opaque tile, small safe-zone.
written.push(await brandTile(180, "apple-touch-icon.png", 0.1));

// Android "any" icons: opaque tile.
written.push(await brandTile(192, "icon-192.png", 0.1));
written.push(await brandTile(512, "icon-512.png", 0.1));

// Android maskable icons: larger safe-zone so adaptive shapes don't clip the art.
// Android's mask can crop up to ~10% per edge; ~20% padding keeps the droplet safe.
written.push(await brandTile(192, "icon-192-maskable.png", 0.2));
written.push(await brandTile(512, "icon-512-maskable.png", 0.2));

written.push(writeManifest());

console.log("Generated icons from assets/logo/zippy.svg:");
for (const file of written) console.log("  web-ui/public/" + file);
