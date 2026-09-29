// Configures pdf.js's worker for Vite (spec §20.4 DocumentViewer). Importing side-effect-only —
// call `import "./pdfWorker"` once before any <Document>/<Page> renders.
import { pdfjs } from "react-pdf";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
