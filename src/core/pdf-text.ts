import type { PdfPageText, PdfTextItem } from "../types/pdf.ts";

const IGNORED_PDF_MARKERS = new Set(["■", "▲", "◆"]);

export function normalizePdfText(value: string): string {
  return Array.from(value.normalize("NFC"))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (
        !IGNORED_PDF_MARKERS.has(character) &&
        (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127))
      );
    })
    .join("")
    .replace(/[ \t]{2,}/gu, " ");
}

export function hasPdfText(items: readonly PdfTextItem[]): boolean {
  return items.some((item) => item.text.trim() !== "");
}

export function countPdfTextItems(pages: readonly PdfPageText[]): number {
  return pages.reduce((count, page) => count + page.items.length, 0);
}
