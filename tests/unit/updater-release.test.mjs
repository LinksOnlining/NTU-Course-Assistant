import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUpdaterManifest } from "../../scripts/normalize-updater-manifest.mjs";
import {
  describeUpdaterError,
  isTransientUpdaterError,
} from "../../src/services/updater-diagnostics.ts";

const makeFixture = () => {
  const manifest = {
    version: "2.0.2",
    platforms: {
      "windows-x86_64": {
        url: "https://api.github.com/repos/LinksOnlining/NTU-Course-Assistant/releases/assets/1",
        signature: "signed-nsis",
      },
      "windows-x86_64-nsis": {
        url: "https://api.github.com/repos/LinksOnlining/NTU-Course-Assistant/releases/assets/1",
        signature: "signed-nsis",
      },
      "windows-x86_64-msi": {
        url: "https://api.github.com/repos/LinksOnlining/NTU-Course-Assistant/releases/assets/2",
        signature: "signed-msi",
      },
    },
  };
  const assets = [
    {
      name: "Links.Workplace_2.0.2_x64-setup.exe",
      apiUrl: "https://api.github.com/repos/LinksOnlining/NTU-Course-Assistant/releases/assets/1",
    },
    { name: "Links.Workplace_2.0.2_x64-setup.exe.sig" },
    {
      name: "Links.Workplace_2.0.2_x64_en-US.msi",
      apiUrl: "https://api.github.com/repos/LinksOnlining/NTU-Course-Assistant/releases/assets/2",
    },
    { name: "Links.Workplace_2.0.2_x64_en-US.msi.sig" },
  ];
  return { manifest, assets };
};

test("normalizes Windows release-asset API URLs without changing signatures", () => {
  const { manifest, assets } = makeFixture();
  const result = normalizeUpdaterManifest(
    manifest,
    assets,
    "LinksOnlining/NTU-Course-Assistant",
    "v2.0.2",
  );
  assert.equal(
    result.platforms["windows-x86_64"].url,
    "https://github.com/LinksOnlining/NTU-Course-Assistant/releases/download/v2.0.2/Links.Workplace_2.0.2_x64-setup.exe",
  );
  assert.equal(
    result.platforms["windows-x86_64-msi"].url,
    "https://github.com/LinksOnlining/NTU-Course-Assistant/releases/download/v2.0.2/Links.Workplace_2.0.2_x64_en-US.msi",
  );
  assert.equal(result.platforms["windows-x86_64"].signature, "signed-nsis");
  assert.equal(manifest.platforms["windows-x86_64"].url, assets[0].apiUrl);
});

test("refuses unsigned, missing or wrong-version assets", () => {
  const { manifest, assets } = makeFixture();
  assert.throws(
    () =>
      normalizeUpdaterManifest(
        manifest,
        assets.slice(0, 1),
        "LinksOnlining/NTU-Course-Assistant",
        "v2.0.2",
      ),
    /signature/,
  );
  assert.throws(
    () =>
      normalizeUpdaterManifest(manifest, assets, "LinksOnlining/NTU-Course-Assistant", "v2.0.3"),
    /mismatch/,
  );
  assets[0].name = "Links.Workplace_2.0.1_x64-setup.exe";
  assert.throws(
    () =>
      normalizeUpdaterManifest(manifest, assets, "LinksOnlining/NTU-Course-Assistant", "v2.0.2"),
    /Wrong/,
  );
});

test("diagnoses 403, timeout, signature errors and unknown backend errors", () => {
  assert.match(describeUpdaterError("HTTP 403 Forbidden"), /403/);
  assert.match(describeUpdaterError(new Error("operation timed out")), /超时/);
  assert.match(describeUpdaterError("Invalid signature"), /签名/);
  assert.match(describeUpdaterError("error sending request"), /网络/);
  assert.match(describeUpdaterError("unknown native failure"), /unknown native failure/);
  assert.equal(isTransientUpdaterError("error sending request"), true);
  assert.equal(isTransientUpdaterError("HTTP 403"), false);
});
