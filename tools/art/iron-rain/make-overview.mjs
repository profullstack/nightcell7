import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const repo = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const manifest = JSON.parse(
  await readFile(repo + "/apps/game/public/assets/art-manifest.json", "utf8"),
);
const cards = await Promise.all(
  Object.entries(manifest.models).map(
    async ([name, m]) =>
      `<article><img src="data:image/png;base64,${(await readFile(repo + "/build/iron-rain/previews/" + name + ".png")).toString("base64")}"><footer><b>${name.replaceAll("_", " ")}</b><span>${m.triangles.toLocaleString()} tris</span></footer></article>`,
  ),
);
const browser = await chromium.launch({
  executablePath: process.argv[2] ?? undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 2640 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><style>*{box-sizing:border-box}body{margin:0;padding:42px;background:#0d1415;color:#e9e8df;font:18px Arial}h1{font-size:44px;letter-spacing:-1px;margin:0 0 8px}header p{color:#a6b5b3;margin:0 0 30px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}article{background:#182224;border:1px solid #344143}img{width:100%;display:block;aspect-ratio:4/3;object-fit:contain}footer{display:flex;justify-content:space-between;padding:13px 14px;font-size:14px;text-transform:uppercase}footer span{color:#a9b3b0;font-size:12px}</style><header><h1>NIGHTCELL 7 / IRON RAIN</h1><p>${manifest.models.m2_carbine_fp ? Object.keys(manifest.models).length - 1 : Object.keys(manifest.models).length} redesigned models + approved C7 rifle · actual exported geometry</p></header><main>${cards.join("")}</main></html>`,
  );
  await page.screenshot({ path: repo + "/build/iron-rain/contact-sheet.png", fullPage: true });
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    repo + "/build/iron-rain/contact-sheet.png",
    "-quality",
    "90",
    repo + "/docs/art/iron-rain-overview.webp",
  ]);
} finally {
  await browser.close();
}
