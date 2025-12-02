import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  ShadingType,
} from "docx";
import type { FactureReportData } from "./pdfReport";
import { decodeLineType } from "./codecs";

const colors = {
  header: "D1E8F7",
  primary: "365F8E",
  chipValid: "16A34A",
  chipContest: "DC2626",
  chipVerify: "9CA3AF",
};

const statusLabel = (value?: string) => {
  const normalized = (value || "").toLowerCase();
  if (normalized.includes("valid")) return "VALIDEE";
  if (normalized.includes("contest")) return "CONTESTE";
  return "A VERIFIER";
};

const chipColor = (value?: string) => {
  const normalized = (value || "").toLowerCase();
  if (normalized.includes("valid")) return colors.chipValid;
  if (normalized.includes("contest")) return colors.chipContest;
  return colors.chipVerify;
};

const emptyBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

const chip = (fill: string) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    shading: { type: ShadingType.SOLID, fill, color: fill },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text: " ", size: 8 })],
  });

const keyValRow = (label: string, value: Paragraph | string) =>
  new TableRow({
    children: [
      new TableCell({
        width: { size: 40, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, fill: "F4F8FB", color: "F4F8FB" },
        borders: emptyBorders,
        children: [
          new Paragraph({
            children: [new TextRun({ text: label, color: "586373", bold: true, size: 22, font: "Segoe UI" })],
            spacing: { after: 80 },
          }),
        ],
      }),
      new TableCell({
        width: { size: 60, type: WidthType.PERCENTAGE },
        borders: emptyBorders,
        children: [
          typeof value === "string"
            ? new Paragraph({ children: [new TextRun({ text: value, size: 22, font: "Segoe UI" })] })
            : value,
        ],
      }),
    ],
  });

export async function exportFactureReportDocx(data: FactureReportData) {
  const factureStatus = statusLabel(data.factureStatut?.toString());
  const ecartStatus = statusLabel(data.metricStatuts.ecart);
  const dateStr = new Date().toLocaleString("fr-FR");

  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: emptyBorders,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.SOLID, fill: colors.header, color: colors.header },
            borders: emptyBorders,
            children: [
              new Paragraph({
                children: [new TextRun({ text: data.entrepriseNom || "Entreprise", bold: true, size: 30, color: colors.primary, font: "Segoe UI" })],
                spacing: { after: 40 },
              }),
            ],
          }),
          new TableCell({
            shading: { type: ShadingType.SOLID, fill: colors.header, color: colors.header },
            borders: emptyBorders,
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: dateStr, size: 20, color: colors.primary, font: "Segoe UI" })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const factureTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: emptyBorders,
    rows: [
      keyValRow("Compte de facturation", `${data.compteNum}${data.compteNom ? ` - ${data.compteNom}` : ""}`),
      keyValRow("Numéro de facture", `${data.factureNum || data.factureId}`),
      keyValRow("Date d'émission", data.factureDate || ""),
      keyValRow("Statut de la facture", chip(chipColor(factureStatus))),
      keyValRow("Ecart facture / lignes", `${data.ecart.toFixed(2)} €`),
      keyValRow("Achats", `${data.achat.toFixed(2)} €`),
    ],
  });

  const resultatRows = [
    keyValRow("Statut ecart", chip(chipColor(ecartStatus))),
    keyValRow("Montant ecart", `${data.ecart.toFixed(2)} €`),
  ];
  if (data.metricComments?.ecart) {
    resultatRows.push(keyValRow("Commentaire ecart", data.metricComments.ecart));
  }

  const resultatTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: emptyBorders,
    rows: resultatRows,
  });

  const borderSep = { style: BorderStyle.SINGLE, size: 4, color: "E5E7EB" };
  const rowBottom = { style: BorderStyle.SINGLE, size: 2, color: "E5E7EB" };
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

  const headerCells = [
    { text: "Type", width: 14, right: borderSep },
    { text: "Qte", width: 8, right: borderSep },
    { text: "Net", width: 9, right: noBorder },
    { text: "", width: 4, right: noBorder },
    { text: "Commentaire abo", width: 24, right: borderSep },
    { text: "Achats", width: 8, right: noBorder },
    { text: "", width: 4, right: noBorder },
    { text: "Commentaire achats", width: 29, right: noBorder },
  ];

  const regroupementRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: headerCells.map((cell) =>
        new TableCell({
          shading: { type: ShadingType.SOLID, fill: colors.header, color: colors.header },
          width: { size: cell.width, type: WidthType.PERCENTAGE },
          borders: { ...emptyBorders, right: cell.right, bottom: rowBottom },
          children: [
            new Paragraph({
              children: cell.text ? [new TextRun({ text: cell.text, bold: true, color: colors.primary, font: "Segoe UI" })] : [],
            }),
          ],
        })
      ),
    }),
  ];

  data.groupes.forEach((g) => {
    const key = `${g.ligne_type}|${(g.prix_abo || 0).toFixed(2)}`;
    const stat = data.groupStatuts[key] || { aboNet: "a_verifier", achat: "a_verifier" };
    const comments = data.groupComments[key] || {};
    const achatTotal = (g as any).achat_total;

    const bodyCells = [
      { text: decodeLineType(g.ligne_type), width: 14, right: borderSep },
      { text: `${g.count}`, width: 8, right: borderSep },
      { text: `${g.prix_abo.toFixed(2)} €`, width: 9, right: noBorder },
      { chip: chip(chipColor(stat.aboNet)), width: 4, right: noBorder },
      { text: comments.aboNet || "", width: 24, right: borderSep },
      { text: achatTotal !== undefined && achatTotal !== null ? `${Number(achatTotal).toFixed(2)} €` : "", width: 8, right: noBorder },
      { chip: chip(chipColor(stat.achat)), width: 4, right: noBorder },
      { text: comments.achat || "", width: 29, right: noBorder },
    ];

    regroupementRows.push(
      new TableRow({
        children: bodyCells.map((cell) =>
          new TableCell({
            width: { size: cell.width, type: WidthType.PERCENTAGE },
            borders: { ...emptyBorders, right: cell.right, bottom: rowBottom },
            children: cell.chip
              ? [cell.chip]
              : [
                  new Paragraph({
                    children: [new TextRun({ text: cell.text, font: "Segoe UI" })],
                  }),
                ],
          })
        ),
      })
    );
  });

  const regroupementTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: borderSep,
      bottom: borderSep,
      left: borderSep,
      right: borderSep,
      insideHorizontal: noBorder,
      insideVertical: noBorder,
    },
    rows: regroupementRows,
  });

  const footerLegend = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [
      new TextRun({ text: "Legende:  ", size: 14, font: "Segoe UI" }),
      new TextRun({ text: "■ ", color: colors.chipValid, size: 14 }),
      new TextRun({ text: "valide   ", size: 14, font: "Segoe UI" }),
      new TextRun({ text: "■ ", color: colors.chipContest, size: 14 }),
      new TextRun({ text: "conteste   ", size: 14, font: "Segoe UI" }),
      new TextRun({ text: "■ ", color: colors.chipVerify, size: 14 }),
      new TextRun({ text: "a verifier", size: 14, font: "Segoe UI" }),
    ],
  });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Segoe UI", size: 22 },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({ children: [footerLegend] }),
        },
        children: [
          headerTable,
          new Paragraph({
            text: "Rapport de Conformité",
            heading: HeadingLevel.TITLE,
            spacing: { after: 200, before: 120 },
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({ text: "Facture", heading: HeadingLevel.HEADING_2, spacing: { after: 80 } }),
          factureTable,
          new Paragraph({ text: "Résultat", heading: HeadingLevel.HEADING_2, spacing: { after: 80, before: 140 } }),
          resultatTable,
          data.globalComment
            ? new Paragraph({ text: "Commentaire global", heading: HeadingLevel.HEADING_2, spacing: { after: 80, before: 140 } })
            : null,
          data.globalComment
            ? new Paragraph({ children: [new TextRun({ text: data.globalComment, size: 22, font: "Segoe UI" })] })
            : null,
          new Paragraph({ text: "Regroupements", heading: HeadingLevel.HEADING_2, spacing: { after: 80, before: 140 } }),
          regroupementTable,
        ].filter(Boolean) as (Paragraph | Table)[],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rapport_${data.factureNum || data.factureId}.docx`;
  link.click();
  URL.revokeObjectURL(url);
}
