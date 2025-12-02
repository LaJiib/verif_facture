import { jsPDF } from "jspdf";
import { decodeFactureStatus, decodeLineType } from "./codecs";

export interface FactureGroupStatut {
  aboNet: string;
  achat: string;
}

export interface FactureGroupData {
  ligne_type: number;
  prix_abo: number; // net unitaire
  count: number;
  ref_net?: number;
  achat_total?: number;
}

export interface FactureReportData {
  entrepriseNom?: string | null;
  compteNum: string;
  compteNom?: string | null;
  factureId: number;
  factureNum?: string;
  factureDate?: string;
  factureStatut?: number;
  ecart: number;
  achat: number;
  metricStatuts: { ecart?: string; achat?: string };
  metricComments?: { ecart?: string; achat?: string };
  groupStatuts: Record<string, FactureGroupStatut>;
  groupComments: Record<string, { aboNet?: string; achat?: string }>;
  groupReals?: Record<string, { aboNet?: string; achat?: string }>;
  globalComment?: string;
  groupes: FactureGroupData[];
}

export function exportFactureReportPdf(data: FactureReportData) {
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const lineHeight = 6;
  const headerBandHeight = 24;

  const colors = {
    header: { r: 205, g: 231, b: 245 },
    primary: { r: 54, g: 97, b: 142 },
    border: { r: 167, g: 192, b: 210 },
    muted: { r: 88, g: 99, b: 115 },
    success: { r: 34, g: 139, b: 76 },
    danger: { r: 220, g: 38, b: 38 },
    warning: { r: 156, g: 163, b: 175 }, // gris pour "à vérifier"
  };

  const formatCurrency = (value: number) => `${value.toFixed(2)} \u20ac`;
  const formatDate = (date?: string) => {
    if (!date) return "";
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("fr-FR");
  };
  const now = new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const statusBadge = (status?: string) => {
    const normalized = (status || "").toLowerCase();
    if (normalized.includes("valid")) return { label: "VALID\u00c9E", color: colors.success };
    if (normalized.includes("contest")) return { label: "CONTEST\u00c9E", color: colors.danger };
    return { label: "\u00c0 V\u00c9RIFIER", color: colors.warning };
  };

  const factureStatus = statusBadge(decodeFactureStatus(data.factureStatut || 0));
  const ecartStatus = statusBadge(data.metricStatuts.ecart || "a_verifier");
  const achatStatus = statusBadge(data.metricStatuts.achat || "a_verifier");

  const drawHeader = () => {
    doc.setFillColor(colors.header.r, colors.header.g, colors.header.b);
    doc.rect(0, 0, pageWidth, headerBandHeight, "F");
    doc.setTextColor(colors.primary.r, colors.primary.g, colors.primary.b);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(data.entrepriseNom || "Entreprise", margin, 11);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(now, pageWidth - margin, 11, { align: "right" as any });
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
  };

  const drawReportTitle = () => {
    const titleY = headerBandHeight + 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(colors.primary.r, colors.primary.g, colors.primary.b);
    doc.text("Rapport de Conformité", pageWidth / 2, titleY, { align: "center" as any });
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    currentY = titleY + 8;
  };

  let currentY = 0;
  const addPageIfNeeded = (heightNeeded: number) => {
    if (currentY + heightNeeded > pageHeight - margin) {
      doc.addPage();
      drawHeader();
      drawReportTitle();
    }
  };

  const drawBadge = (label: string, color: { r: number; g: number; b: number }, x: number, y: number) => {
    const paddingX = 3;
    const height = 7;
    const width = doc.getTextWidth(label) + paddingX * 2;
    doc.setFillColor(color.r, color.g, color.b);
    doc.roundedRect(x, y, width, height, 1.2, 1.2, "F");
    doc.setTextColor(255, 255, 255);
    const textY = y + height / 2 + 0.2;
    doc.text(label, x + width / 2, textY, { align: "center" as any, baseline: "middle" as any });
    doc.setTextColor(30, 41, 59);
  };

  const drawSectionTitle = (title: string) => {
    addPageIfNeeded(10);
    doc.setFillColor(244, 248, 251);
    doc.rect(margin, currentY - 4, pageWidth - margin * 2, 10, "F");
    doc.setDrawColor(colors.border.r, colors.border.g, colors.border.b);
    doc.line(margin, currentY + 6, pageWidth - margin, currentY + 6);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(colors.primary.r, colors.primary.g, colors.primary.b);
    doc.text(title, margin + 2, currentY + 2);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);
    currentY += 12;
  };

  const drawKeyValue = (label: string, value: string, x: number, maxValueWidth: number) => {
    doc.setTextColor(colors.muted.r, colors.muted.g, colors.muted.b);
    doc.text(label, x, currentY);
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "bold");
    const valueX = x + 68;
    const lines = doc.splitTextToSize(value, maxValueWidth);
    doc.text(lines, valueX, currentY);
    doc.setFont("helvetica", "normal");
    currentY += lineHeight * Math.max(1, lines.length);
  };

  doc.setFontSize(10);
  drawHeader();
  drawReportTitle();
  currentY = headerBandHeight + 18;

  drawSectionTitle("Facture");
  const sectionWidth = pageWidth - margin * 2 - 4;
  const colX = margin + 2;
  const colWidth = sectionWidth - 4;

  addPageIfNeeded(50);
  const startY = currentY;
  drawKeyValue(
    "Compte de facturation",
    `${data.compteNum}${data.compteNom ? ` - ${data.compteNom}` : ""}`,
    colX,
    colWidth
  );
  drawKeyValue("Num\u00e9ro de facture", `${data.factureNum || data.factureId}`, colX, colWidth);
  drawKeyValue("Date d'\u00e9mission", formatDate(data.factureDate), colX, colWidth);

  currentY += lineHeight;
  drawKeyValue("Statut de la facture", factureStatus.label, colX, colWidth);
  drawKeyValue("\u00c9cart facture / lignes", formatCurrency(data.ecart), colX, colWidth);
  drawKeyValue("Achats", formatCurrency(data.achat), colX, colWidth);

  currentY += 10;
  currentY += 2;
  drawSectionTitle("R\u00e9sultat");
  addPageIfNeeded(12);
  const statusBarHeight = 10;
  doc.setFillColor(factureStatus.color.r, factureStatus.color.g, factureStatus.color.b);
  doc.rect(margin, currentY - 2, pageWidth - margin * 2, statusBarHeight, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(factureStatus.label, pageWidth / 2, currentY + 5, { align: "center" as any });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);
  currentY += statusBarHeight + 4;

  const syntheseLines = [
    `Statut écart : ${ecartStatus.label}`,
    `Montant écart : ${formatCurrency(data.ecart)}`,
  ];
  syntheseLines.forEach((line) => {
    addPageIfNeeded(lineHeight);
    doc.text(line, margin + 2, currentY);
    currentY += lineHeight;
  });

  const ecartComment = data.metricComments?.ecart;
  if (ecartComment) {
    const lines = doc.splitTextToSize(`Commentaire écart : ${ecartComment}`, pageWidth - margin * 2 - 4);
    lines.forEach((l: string) => {
      addPageIfNeeded(lineHeight);
      doc.text(l, margin + 2, currentY);
      currentY += lineHeight;
    });
  }

  if (data.globalComment) {
    drawSectionTitle("Commentaire global");
    const lines = doc.splitTextToSize(data.globalComment, pageWidth - margin * 2);
    lines.forEach((line: string) => {
      addPageIfNeeded(lineHeight);
      doc.text(line, margin, currentY);
      currentY += lineHeight;
    });
  }

    // Groupes lignes (par type et net unitaire)
  const groupeEntries = data.groupes.map((g) => {
    const key = `${g.ligne_type}|${(g.prix_abo || 0).toFixed(2)}`;
    return {
      key,
      typeLabel: decodeLineType(g.ligne_type),
      netUnit: g.prix_abo || 0,
      count: g.count,
      achatTotal: g.achat_total ?? 0,
      statuts: data.groupStatuts[key] || { aboNet: "a_verifier", achat: "a_verifier" },
      comments: data.groupComments[key] || {},
      reals: data.groupReals?.[key] || {},
    };
  });

  if (groupeEntries.length > 0) {
    drawSectionTitle("Synthese par type / net unitaire");
    groupeEntries.forEach((entry) => {
      const aboBadge = statusBadge(entry.statuts.aboNet);
      const achatBadge = statusBadge(entry.statuts.achat);
      const commentLines = [
        entry.comments.aboNet,
        entry.comments.achat ? `Achats: ${entry.comments.achat}` : null,
      ]
        .filter(Boolean)
        .flatMap((c) => doc.splitTextToSize(c as string, pageWidth - margin * 2 - 10));
      const realLines: string[] = [];
      if (entry.reals.aboNet) realLines.push(`Abo net corrige: ${entry.reals.aboNet}`);
      if (entry.reals.achat) realLines.push(`Achat corrige: ${entry.reals.achat}`);
      const blockHeight = 20 + commentLines.length * lineHeight + realLines.length * lineHeight;
      addPageIfNeeded(blockHeight);

      // Titre groupe
      doc.setFont("helvetica", "bold");
      doc.text(`${entry.typeLabel}`, margin + 2, currentY);
      doc.setFont("helvetica", "normal");
      doc.text(`Lignes: ${entry.count}`, margin + 2, currentY + lineHeight);

      // Statut + net unitaire (abo) et achats totaux alignés sur la droite
      const badgeHeight = 7;
      const aboBadgeX = pageWidth - margin - 90;
      const achatBadgeX = pageWidth - margin - 45;
      const badgeTop = currentY + 1.2;
      const priceY = badgeTop + badgeHeight / 2 + 0.2;
      doc.setFont("helvetica", "bold");
      doc.text(`${entry.netUnit.toFixed(2)} €`, aboBadgeX - doc.getTextWidth(`${entry.netUnit.toFixed(2)} €`) - 3, priceY);
      const achatLabelText = `${entry.achatTotal.toFixed(2)} €`;
      doc.text(achatLabelText, achatBadgeX - doc.getTextWidth(achatLabelText) - 3, priceY);
      doc.setFont("helvetica", "normal");
      drawBadge(aboBadge.label, aboBadge.color, aboBadgeX, badgeTop);
      drawBadge(achatBadge.label, achatBadge.color, achatBadgeX, badgeTop);

      let y = currentY + lineHeight * 2.2;
      if (commentLines.length) {
        commentLines.forEach((line) => {
          doc.text(line as string, margin + 2, y);
          y += lineHeight;
        });
      }
      if (realLines.length) {
        realLines.forEach((line) => {
          doc.text(line, margin + 2, y);
          y += lineHeight;
        });
      }
      currentY = y + 2;
      doc.setDrawColor(colors.border.r, colors.border.g, colors.border.b);
      doc.line(margin, currentY, pageWidth - margin, currentY);
      currentY += 4;
    });
  }

doc.save(`rapport_facture_${data.factureNum || data.factureId}.pdf`);
}

export interface LotRecapCompte {
  compte_num: string;
  compte_nom?: string | null;
  moisDetails: LotMonthDetail[];
}

export interface LotRecapData {
  entrepriseNom?: string | null;
  lotNom: string;
  moisSelectionnes: string[];
  comptes: LotRecapCompte[];
}

export interface LotMonthDetail {
  mois: string;
  abo: number;
  conso: number;
  remises: number;
  achat: number;
  total: number;
  factures: { num: string; statut: number }[];
}

export function exportLotRecapPdf(data: LotRecapData) {
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const lineHeight = 6;
  const headerBandHeight = 18;

  const colors = {
    header: { r: 205, g: 231, b: 245 },
    primary: { r: 54, g: 97, b: 142 },
    border: { r: 167, g: 192, b: 210 },
    muted: { r: 88, g: 99, b: 115 },
    success: { r: 34, g: 139, b: 76 },
    danger: { r: 220, g: 38, b: 38 },
    warning: { r: 156, g: 163, b: 175 }, // gris pour "a verifier"
  };

  const now = new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const header = () => {
    doc.setFillColor(colors.header.r, colors.header.g, colors.header.b);
    doc.rect(0, 0, pageWidth, headerBandHeight, "F");
    doc.setTextColor(colors.primary.r, colors.primary.g, colors.primary.b);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(data.entrepriseNom || "Entreprise", margin, 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(now, pageWidth - margin, 8, { align: "right" as any });
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
  };

  const badgeForStatut = (statut: number | string) => {
    const label = decodeFactureStatus(typeof statut === "number" ? statut : (statut as any));
    const normalized = (label || "").toLowerCase();
    if (normalized.includes("valid")) return { label, color: colors.success };
    if (normalized.includes("contest")) return { label, color: colors.danger };
    return { label, color: colors.warning };
  };

  const drawStatusChip = (text: string, color: { r: number; g: number; b: number }, x: number, y: number) => {
    const paddingX = 1.0;
    const height = 4.1;
    const prevSize = doc.getFontSize();
    doc.setFontSize(8);
    const width = doc.getTextWidth(text) + paddingX * 2;
    doc.setFillColor(color.r, color.g, color.b);
    doc.roundedRect(x, y, width, height, 1.2, 1.2, "F");
    doc.setTextColor(255, 255, 255);
    doc.text(text, x + width / 2, y + height / 2 + 0.25, { align: "center" as any, baseline: "middle" as any });
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(prevSize);
    return width;
  };

  const addTableHeader = (y: number) => {
    doc.setFillColor(colors.header.r, colors.header.g, colors.header.b);
    doc.rect(margin, y - 5, pageWidth - margin * 2, lineHeight + 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(colors.primary.r, colors.primary.g, colors.primary.b);
    doc.text("Mois", margin + 2, y);
    doc.text("Abo", margin + 32, y);
    doc.text("Conso", margin + 52, y);
    doc.text("Remises", margin + 72, y);
    doc.text("Achats", margin + 96, y);
    doc.text("Total", margin + 118, y);
    doc.text("Factures", margin + 140, y);
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "normal");
  };

  doc.setFontSize(10);
  header();
  let y = headerBandHeight + 10;
  const maxY = pageHeight - margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text("Recapitulatif du lot", pageWidth / 2, y, { align: "center" as any });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`Lot : ${data.lotNom}`, margin, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  y += 14;

  data.comptes.forEach((compte, idx) => {
    if (y + 18 > maxY) {
      doc.addPage();
      header();
      y = headerBandHeight + 10;
    }
    doc.setFont("helvetica", "bold");
    doc.setTextColor(colors.primary.r, colors.primary.g, colors.primary.b);
    doc.text(`Compte ${compte.compte_num}${compte.compte_nom ? ` (${compte.compte_nom})` : ""}`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);
    y += 4;
    doc.setDrawColor(colors.border.r, colors.border.g, colors.border.b);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    addTableHeader(y);
    y += lineHeight;

    data.moisSelectionnes.forEach((moisKey) => {
      if (y + lineHeight > maxY) {
        doc.addPage();
        header();
        y = headerBandHeight + 10;
        addTableHeader(y);
        y += lineHeight;
      }

      const detail = compte.moisDetails.find((d) => d.mois === moisKey);
      if (!detail) return;

      doc.text(moisKey, margin + 2, y);
      doc.text(detail.abo.toFixed(2), margin + 32, y);
      doc.text(detail.conso.toFixed(2), margin + 52, y);
      doc.text(detail.remises.toFixed(2), margin + 72, y);
      doc.text(detail.achat.toFixed(2), margin + 96, y);
      doc.text(detail.total.toFixed(2), margin + 118, y);

      let chipX = margin + 140;
      detail.factures.forEach((f) => {
        const { label, color } = badgeForStatut(f.statut);
        const txt = f.num ? `${f.num}` : label;
        const w = drawStatusChip(txt, color, chipX, y - 3);
        chipX += w + 2;
      });

      y += lineHeight;
    });

    y += 4;
    if (idx < data.comptes.length - 1) {
      doc.setDrawColor(colors.border.r, colors.border.g, colors.border.b);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;
    }
  });

  doc.save(`recap_lot_${data.lotNom}.pdf`);
}


