import { useState } from "react";
import { Document, Page } from "react-pdf";
import "../lib/pdfWorker";
import "react-pdf/dist/Page/AnnotationLayer.css";
import type { Bbox } from "../lib/documents";

export interface Highlight {
  key: string;
  pageNo: number; // 1-indexed
  bbox: Bbox;
  colour: "supports" | "conflicts";
  label: string;
}

interface Props {
  fileUrl: string;
  pageNo: number;
  highlights: Highlight[];
  renderWidth?: number;
}

// Renders one PDF page with bbox overlays scaled from PDF points to rendered pixels (spec §20.4
// DocumentViewer: "bbox highlight overlays with labels"). PyMuPDF's bbox coordinates (top-left
// origin, y-down, at 1x/72dpi scale — see services/engine/engine/documents/pipeline.py) line up
// directly with pdf.js's rendered viewport, which uses the same convention.
export default function DocumentViewer({ fileUrl, pageNo, highlights, renderWidth = 700 }: Props) {
  const [scale, setScale] = useState<number | null>(null);

  const onPageLoadSuccess = (page: { getViewport: (opts: { scale: number }) => { width: number } }) => {
    const viewport = page.getViewport({ scale: 1 });
    setScale(renderWidth / viewport.width);
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <Document file={fileUrl} loading={<div className="field hint">Loading document…</div>} error={<div className="error-banner">Could not load this PDF.</div>}>
        <Page pageNumber={pageNo} width={renderWidth} onLoadSuccess={onPageLoadSuccess} renderTextLayer={false} renderAnnotationLayer={false} />
      </Document>
      {scale !== null &&
        highlights
          .filter((h) => h.pageNo === pageNo)
          .map((h) => (
            <div
              key={h.key}
              title={h.label}
              style={{
                position: "absolute",
                left: h.bbox.x0 * scale - 2,
                top: h.bbox.y0 * scale - 2,
                width: (h.bbox.x1 - h.bbox.x0) * scale + 4,
                height: (h.bbox.y1 - h.bbox.y0) * scale + 4,
                border: `2px solid ${h.colour === "conflicts" ? "var(--fail-fg)" : "var(--pass-fg)"}`,
                background: h.colour === "conflicts" ? "rgba(180,35,24,0.12)" : "rgba(27,122,75,0.12)",
                borderRadius: 3,
                pointerEvents: "none",
              }}
            />
          ))}
    </div>
  );
}
