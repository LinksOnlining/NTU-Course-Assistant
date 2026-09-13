import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../node_modules/pdfjs-dist/cmaps/", import.meta.url));
const target = fileURLToPath(new URL("../public/pdfjs/cmaps/", import.meta.url));

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const ocrTarget = fileURLToPath(new URL("../public/ocr/", import.meta.url));
await rm(ocrTarget, { recursive: true, force: true });
await mkdir(fileURLToPath(new URL("core/", new URL("../public/ocr/", import.meta.url))), {
  recursive: true,
});
await mkdir(fileURLToPath(new URL("lang/", new URL("../public/ocr/", import.meta.url))), {
  recursive: true,
});
await cp(
  fileURLToPath(new URL("../node_modules/tesseract.js/dist/worker.min.js", import.meta.url)),
  fileURLToPath(new URL("../public/ocr/worker.min.js", import.meta.url)),
);
await cp(
  fileURLToPath(new URL("../node_modules/tesseract.js-core/", import.meta.url)),
  fileURLToPath(new URL("../public/ocr/core/", import.meta.url)),
  { recursive: true },
);
for (const language of ["chi_sim", "eng"]) {
  await cp(
    fileURLToPath(
      new URL(`../node_modules/@tesseract.js-data/${language}/4.0.0/${language}.traineddata.gz`, import.meta.url),
    ),
    fileURLToPath(new URL(`../public/ocr/lang/${language}.traineddata.gz`, import.meta.url)),
  );
}
