/**
 * Client-side PDF generation.
 *
 * The PDF is built from the report document returned by /api/ai/report, which is
 * itself rendered deterministically from the validated assessment. jsPDF writes
 * real vector text, so the result is selectable, searchable and small — not a
 * screenshot of the page.
 */

import type { ReportDocument } from "@/lib/ai/prompts/report";

type AutoTableModule = typeof import("jspdf-autotable");

const BRAND: [number, number, number] = [13, 148, 136];
const INK: [number, number, number] = [26, 32, 44];
const MUTED: [number, number, number] = [98, 108, 122];
const CRITICAL: [number, number, number] = [200, 42, 62];
const CAUTION: [number, number, number] = [190, 110, 12];
const LINE: [number, number, number] = [219, 224, 231];

const PAGE = { width: 210, height: 297, margin: 16 } as const;
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

function severityColor(emphasis: string | undefined): [number, number, number] {
  if (emphasis === "critical") return CRITICAL;
  if (emphasis === "highlight") return CAUTION;
  return BRAND;
}

export async function buildReportPdf(report: ReportDocument): Promise<Blob> {
  const [{ jsPDF }, autoTable] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const autoTableFn = (autoTable as AutoTableModule).default;

  /* -------------------------------------------------------- header ----- */
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, PAGE.width, 4, "F");

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(report.title, PAGE.margin, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(report.subtitle, PAGE.margin, 27);
  doc.text(`Generated: ${new Date(report.generatedAt).toLocaleString()}`, PAGE.margin, 33);

  doc.setDrawColor(...LINE);
  doc.line(PAGE.margin, 37, PAGE.width - PAGE.margin, 37);

  let cursor = 44;

  /* --------------------------------------------------- disclaimer box -- */
  const disclaimerLines = doc.splitTextToSize(report.disclaimer, CONTENT_WIDTH - 8) as string[];
  const boxHeight = disclaimerLines.length * 4.2 + 10;

  doc.setFillColor(253, 248, 240);
  doc.setDrawColor(...CAUTION);
  doc.roundedRect(PAGE.margin, cursor, CONTENT_WIDTH, boxHeight, 2, 2, "FD");
  doc.setFontSize(7.6);
  doc.setTextColor(...INK);
  doc.text(disclaimerLines, PAGE.margin + 4, cursor + 6, { lineHeightFactor: 1.3 });

  cursor += boxHeight + 8;

  /* --------------------------------------------------------- sections -- */
  for (const section of report.sections) {
    // Reserve space, break the page when needed.
    const estimatedHeight = estimateSectionHeight(section, doc);
    if (cursor + estimatedHeight > PAGE.height - 22) {
      addFooter(doc);
      doc.addPage();
      cursor = 18;
    }

    const accent = severityColor(section.emphasis);
    doc.setFillColor(...accent);
    doc.rect(PAGE.margin, cursor - 3.4, 2, 5, "F");

    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(section.title, PAGE.margin + 4, cursor);
    cursor += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    for (const paragraph of section.paragraphs) {
      const lines = doc.splitTextToSize(paragraph, CONTENT_WIDTH) as string[];
      for (const line of lines) {
        if (cursor > PAGE.height - 22) {
          addFooter(doc);
          doc.addPage();
          cursor = 18;
        }
        doc.setTextColor(...MUTED);
        doc.text(line, PAGE.margin + 4, cursor);
        cursor += 4.4;
      }
      cursor += 1.6;
    }

    if (section.bullets.length > 0) {
      autoTableFn(doc, {
        startY: cursor,
        margin: { left: PAGE.margin + 4, right: PAGE.margin },
        theme: "plain",
        styles: {
          font: "helvetica",
          fontSize: 8.6,
          cellPadding: { top: 1.4, bottom: 1.4, left: 4, right: 2 },
          textColor: MUTED,
          lineWidth: 0,
          overflow: "linebreak",
          valign: "top",
        },
        columnStyles: { 0: { cellWidth: 4, textColor: accent } },
        body: section.bullets.map((bullet) => ["•", bullet.replace(/^\s*[•\-]\s*/, "")]),
      });

      // Recompute the cursor from the table's final position.
      const tableEnd = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
      cursor = (tableEnd?.finalY ?? cursor) + 6;
    }

    cursor += 3;
  }

  addFooter(doc);
  return doc.output("blob");
}

function estimateSectionHeight(
  section: { paragraphs: string[]; bullets: string[] },
  doc: import("jspdf").jsPDF,
): number {
  const paragraphs = section.paragraphs.reduce((sum, paragraph) => {
    const lines = doc.splitTextToSize(paragraph, CONTENT_WIDTH - 4) as string[];
    return sum + lines.length * 4.4 + 1.6;
  }, 0);

  const bullets = section.bullets.reduce((sum, bullet) => {
    const lines = doc.splitTextToSize(bullet.replace(/^\s*[•\-]\s*/, ""), CONTENT_WIDTH - 12) as string[];
    return sum + lines.length * 4.2 + 1.4;
  }, 0);

  return 8 + paragraphs + bullets;
}

function addFooter(doc: import("jspdf").jsPDF): void {
  const pages = doc.getNumberOfPages();
  const pageHeight = PAGE.height;

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...LINE);
    doc.line(PAGE.margin, pageHeight - 14, PAGE.width - PAGE.margin, pageHeight - 14);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      "Generated by MedAssist AI — AI-generated decision support, not a diagnosis. Verify everything against your original documents with a qualified healthcare professional.",
      PAGE.margin,
      pageHeight - 9,
      { maxWidth: CONTENT_WIDTH - 18 },
    );
    doc.text(`${page} / ${pages}`, PAGE.width - PAGE.margin, pageHeight - 9, { align: "right" });
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}