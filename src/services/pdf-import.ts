import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { countPdfTextItems, hasUsablePdfText, normalizePdfText } from "../core/pdf-text.ts";
import type { PdfExtraction, PdfPageText, PdfTextItem } from "../types/pdf.ts";
import type { PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api";

export type PdfImportErrorCode =
  "invalid-file" | "encrypted" | "ocr-failed" | "unsupported-structure" | "unreadable";

export class PdfImportError extends Error {
  readonly code: PdfImportErrorCode;

  constructor(code: PdfImportErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface SelectedPdfFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface PdfImportProgress {
  readonly page: number;
  readonly pageCount: number;
}

function runningInTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? "课程表.pdf";
}

function ensurePdfName(fileName: string): void {
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    throw new PdfImportError("invalid-file", "请选择 PDF 文件。");
  }
}

async function chooseBrowserPdfFile(): Promise<SelectedPdfFile | null> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf";
  return new Promise((resolve) => {
    let settled = false;
    const finish = (file: SelectedPdfFile | null) => {
      if (settled) return;
      settled = true;
      resolve(file);
    };
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.item(0) ?? null;
        if (!file) {
          finish(null);
          return;
        }
        void file.arrayBuffer().then(
          (buffer) => finish({ fileName: file.name, bytes: new Uint8Array(buffer) }),
          () => finish(null),
        );
      },
      { once: true },
    );
    input.addEventListener("cancel", () => finish(null), { once: true });
    input.click();
  });
}

export async function choosePdfFile(): Promise<SelectedPdfFile | null> {
  if (!runningInTauri()) return chooseBrowserPdfFile();
  const selected = await open({
    title: "选择课程表 PDF",
    directory: false,
    multiple: false,
    filters: [{ name: "PDF 文件", extensions: ["pdf"] }],
  });
  // Tauri normally returns null on cancel. Keep the cancel branch tolerant of
  // older/native dialog implementations that use undefined or an empty list.
  if (selected == null || (Array.isArray(selected) && selected.length === 0)) return null;
  if (Array.isArray(selected)) return null;
  const fileName = fileNameFromPath(selected);
  ensurePdfName(fileName);
  try {
    return { fileName, bytes: await readFile(selected) };
  } catch {
    throw new PdfImportError("unreadable", "无法读取所选 PDF，请确认文件仍可访问后重试。");
  }
}

function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder("ascii").decode(bytes.subarray(0, 5)) === "%PDF-";
}

function finiteValue(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function toPdfTextItem(page: number, item: TextItem): PdfTextItem | null {
  const [, , , , x, y] = item.transform;
  const itemX = finiteValue(x);
  const itemY = finiteValue(y);
  const width = finiteValue(item.width);
  const height = finiteValue(item.height);
  if (itemX === null || itemY === null || width === null || height === null) return null;
  const text = normalizePdfText(item.str);
  if (text.trim() === "") return null;
  return {
    page,
    text,
    x: itemX,
    y: itemY,
    width,
    height,
  };
}

async function extractPage(page: PDFPageProxy): Promise<PdfPageText> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items.flatMap((item) => {
    if (!("str" in item)) return [];
    const textItem = toPdfTextItem(page.pageNumber, item);
    return textItem ? [textItem] : [];
  });
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) {
    throw new PdfImportError("unreadable", "PDF 页面尺寸无效，无法读取。");
  }
  return { page: page.pageNumber, width: viewport.width, height: viewport.height, items };
}

async function loadPdfJs() {
  const pdfJs = await import("pdfjs-dist");
  pdfJs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfJs;
}

async function extractOcrPage(
  page: PDFPageProxy,
  report: (page: number) => void,
): Promise<PdfPageText> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new PdfImportError("ocr-failed", "无法准备扫描页面识别。");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  report(page.pageNumber);
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["chi_sim", "eng"], 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    workerBlobURL: false,
  });
  try {
    const result = await worker.recognize(canvas, {}, { blocks: true, tsv: true });
    const pageViewport = page.getViewport({ scale: 1 });
    const words =
      result.data.blocks?.flatMap((block) =>
        block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)),
      ) ?? [];
    const items = words.flatMap((word) => {
      const text = normalizePdfText(word.text);
      const { x0, y0, x1, y1 } = word.bbox;
      if (!text.trim() || x1 <= x0 || y1 <= y0) return [];
      const scale = 2;
      return [
        {
          page: page.pageNumber,
          text,
          x: x0 / scale,
          y: pageViewport.height - y1 / scale,
          width: (x1 - x0) / scale,
          height: (y1 - y0) / scale,
          confidence: word.confidence,
        },
      ];
    });
    if (items.length === 0 && result.data.tsv) {
      for (const row of result.data.tsv.split("\n").slice(1)) {
        const [level, , , , , , x, y, width, height, confidence, ...textParts] = row.split("\t");
        if (level !== "5") continue;
        const text = normalizePdfText(textParts.join("\t"));
        const [left, top, itemWidth, itemHeight, score] = [x, y, width, height, confidence].map(
          Number,
        );
        if (!text.trim() || ![left, top, itemWidth, itemHeight, score].every(Number.isFinite))
          continue;
        items.push({
          page: page.pageNumber,
          text,
          x: left / 2,
          y: pageViewport.height - (top + itemHeight) / 2,
          width: itemWidth / 2,
          height: itemHeight / 2,
          confidence: score,
        });
      }
    }
    return { page: page.pageNumber, width: pageViewport.width, height: pageViewport.height, items };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    await worker.terminate();
  }
}

function parseError(error: unknown): PdfImportError {
  if (error instanceof PdfImportError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "PasswordException"
  ) {
    return new PdfImportError("encrypted", "当前 PDF 已加密，首版暂不支持读取。");
  }
  return new PdfImportError("unreadable", "无法解析该 PDF，请确认文件未损坏后重试。");
}

export async function extractPdfText(
  file: SelectedPdfFile,
  onOcrProgress?: (progress: PdfImportProgress) => void,
): Promise<PdfExtraction> {
  ensurePdfName(file.fileName);
  if (!isPdfBytes(file.bytes)) {
    throw new PdfImportError("invalid-file", "所选文件不是有效的 PDF。");
  }
  const { getDocument } = await loadPdfJs();
  const task = getDocument({
    data: file.bytes,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
  });
  try {
    const document = await task.promise;
    const pages = await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) =>
        extractPage(await document.getPage(index + 1)),
      ),
    );
    const items = pages.flatMap((page) => page.items);
    if (hasUsablePdfText(items)) {
      return {
        fileName: file.fileName,
        pageCount: document.numPages,
        textItemCount: countPdfTextItems(pages),
        pages,
        extractionMode: "text",
      };
    }
    const ocrPages: PdfPageText[] = [];
    try {
      for (let page = 1; page <= document.numPages; page += 1) {
        ocrPages.push(
          await extractOcrPage(await document.getPage(page), (current) =>
            onOcrProgress?.({ page: current, pageCount: document.numPages }),
          ),
        );
      }
    } catch (error) {
      if (error instanceof PdfImportError) throw error;
      throw new PdfImportError("ocr-failed", "无法运行本地文字识别，请确认安装文件完整后重试。");
    }
    const ocrItems = ocrPages.flatMap((page) => page.items);
    if (!hasUsablePdfText(ocrItems)) {
      throw new PdfImportError(
        "ocr-failed",
        "未能从扫描页面中识别出足够文字，请尝试更清晰的 PDF。",
      );
    }
    return {
      fileName: file.fileName,
      pageCount: document.numPages,
      textItemCount: countPdfTextItems(ocrPages),
      pages: ocrPages,
      extractionMode: "ocr",
    };
  } catch (error) {
    throw parseError(error);
  } finally {
    await task.destroy();
  }
}

export async function chooseAndExtractPdf(): Promise<PdfExtraction | null> {
  const file = await choosePdfFile();
  if (file === null) return null;
  return extractPdfText(file);
}
