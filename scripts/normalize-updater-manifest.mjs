import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function normalizeUpdaterManifest(manifest, assets, repository, tag) {
  if (!/^[-\w.]+\/[-\w.]+$/.test(repository) || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error("Invalid GitHub repository or release tag");
  }
  if (manifest.version !== tag.slice(1) || !manifest.platforms || !Array.isArray(assets)) {
    throw new Error("Updater manifest version/platforms mismatch");
  }
  const normalized = structuredClone(manifest);
  for (const [platform, value] of Object.entries(normalized.platforms)) {
    if (!/^windows-x86_64(?:-(?:nsis|msi))?$/.test(platform)) continue;
    const asset = assets.find((candidate) => candidate.apiUrl === value.url);
    if (!asset || typeof value.signature !== "string" || !value.signature.length) {
      throw new Error(`Missing signed release asset for ${platform}`);
    }
    const expectedExtension = platform.endsWith("-msi") ? ".msi" : ".exe";
    if (
      !asset.name.endsWith(expectedExtension) ||
      !asset.name.includes(`_${normalized.version}_`) ||
      !assets.some((candidate) => candidate.name === `${asset.name}.sig`)
    ) {
      throw new Error(`Wrong installer/signature asset for ${platform}`);
    }
    value.url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(asset.name)}`;
  }
  if (!Object.keys(normalized.platforms).some((key) => key === "windows-x86_64")) {
    throw new Error("Missing Windows x64 default updater platform");
  }
  return normalized;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , manifestPath, assetsPath, repo, tag] = process.argv;
  if (!manifestPath || !assetsPath || !repo || !tag)
    throw new Error(
      "Usage: node normalize-updater-manifest.mjs latest.json assets.json owner/repo vX.Y.Z",
    );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const assets = JSON.parse(readFileSync(assetsPath, "utf8").replace(/^\uFEFF/, "")).assets;
  const result = normalizeUpdaterManifest(manifest, assets, repo, tag);
  writeFileSync(manifestPath, JSON.stringify(result, null, 2) + "\n");
  console.log(`UPDATER_MANIFEST_NORMALIZED ${tag}`);
}
