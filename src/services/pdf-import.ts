import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { countPdfTextItems, hasPdfText, normalizePdfText } from "../core/pdf-text.ts";
import type { PdfExtraction, PdfPageText, PdfTextItem } from "../types/pdf.ts";
import type { PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api";

export type PdfImportErrorCode = "invalid-file" | "encrypted" | "no-text" | "unreadable";

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
  if (selected === null || Array.isArray(selected)) return null;
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

export async function extractPdfText(file: SelectedPdfFile): Promise<PdfExtraction> {
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
    if (!hasPdfText(items)) {
      throw new PdfImportError("no-text", "当前 PDF 可能是扫描版，首版暂不支持。");
    }
    return {
      fileName: file.fileName,
      pageCount: document.numPages,
      textItemCount: countPdfTextItems(pages),
      pages,
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
