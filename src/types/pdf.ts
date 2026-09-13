export interface PdfTextItem {
  readonly page: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly confidence?: number;
}

export interface PdfPageText {
  readonly page: number;
  readonly width: number;
  readonly height: number;
  readonly items: readonly PdfTextItem[];
}

export interface PdfExtraction {
  readonly fileName: string;
  readonly pageCount: number;
  readonly textItemCount: number;
  readonly pages: readonly PdfPageText[];
  readonly extractionMode: "text" | "ocr";
}
