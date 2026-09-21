import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform, Alert } from 'react-native';
import type { Stats } from '@/features/analytics/useStats';
import type { WeeklyPoint } from '@/features/analytics/useRevenueTrend';

// Self-contained minimal PDF builder (A4). No pdfkit/@react-pdf — works on web + native
// and avoids the Metro bundling issues that broke the web build earlier.

function esc(s: any): string {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdf(opts: {
  companyName: string;
  generatedAt: string;
  stats: Stats;
  weekly: WeeklyPoint[];
  paidSum: number;
  draftSum: number;
}): string {
  const { companyName, generatedAt, stats, weekly, paidSum, draftSum } = opts;
  const y = (mm: number) => (mm / 25.4) * 72 + 40; // top margin 40pt

  const lines: string[] = [];
  const barCount = Math.max(1, weekly.length);
  const maxRev = Math.max(1, ...weekly.map(w => w.revenue));
  const barW = 340 / barCount; // content width ~ A4 - margins
  const barMaxH = 80;

  // Header
  lines.push(`BT /F1 20 Tf 20 780 Td (${esc(companyName || 'FieldOps')} — Revenue Report) Tj ET`);
  lines.push(`BT /F1 9 Tf 20 766 Td (Generated ${esc(generatedAt)}) Tj ET`);
  lines.push('BT /F1 9 Tf 20 752 Td (Offline-first • Jobs, Checklists, Invoices) Tj ET');

  // Summary cards (drawn as rectangles + text)
  const cards = [
    { label: 'Total Jobs', value: String(stats.totalJobs) },
    { label: 'Revenue', value: `$${stats.totalRevenue.toFixed(0)}` },
    { label: 'Pending Sync', value: String(stats.pendingSync) },
    { label: 'Checklist Pass', value: stats.passRate !== null ? `${stats.passRate}%` : '—' },
  ];
  cards.forEach((c, i) => {
    const x = 20 + i * 88;
    lines.push(`0 0 0 rg 1 1 0.96 RG ${x} 700 ${84} 52 re S 0.96 0.96 0.92 rg ${x} 700 ${84} 52 re f`);
    lines.push(`0 0 0 rg BT /F2 10 Tf ${x + 6} 738 Td (${esc(c.label)}) Tj ET`);
    lines.push(`BT /F2 16 Tf ${x + 6} 720 Td (${esc(c.value)}) Tj ET`);
  });

  // Paid vs Draft
  lines.push(`BT /F2 12 Tf 20 672 Td (Paid vs Draft — Paid $${paidSum.toFixed(0)} (${stats.totalInvoices} inv) / Draft $${draftSum.toFixed(0)}) Tj ET`);

  // Weekly revenue chart (bars)
  lines.push('0 0 0 RG 20 650 360 1 re S'); // baseline
  weekly.forEach((w, i) => {
    const h = w.revenue > 0 ? Math.max(3, (w.revenue / maxRev) * barMaxH) : 2;
    const x = 20 + i * barW + barW * 0.15;
    const bw = barW * 0.7;
    const yb = 650 - h;
    lines.push(`0.058 0.09 0.259 rg ${x} ${yb} ${bw} ${h} re f`);
    lines.push(`BT /F2 8 Tf ${x} ${yb - 14} Td (${esc(w.label)}) Tj ET`);
    lines.push(`BT /F2 8 Tf ${x} ${yb - 26} Td ($ ${w.revenue.toFixed(0)}) Tj ET`);
  });

  // Jobs by status
  lines.push(`BT /F2 12 Tf 20 ${540} Td (Jobs by Status) Tj ET`);
  let yy = 524;
  Object.entries(stats.byStatus).forEach(([k, v]) => {
    const pct = stats.totalJobs > 0 ? (v / stats.totalJobs) * 100 : 0;
    lines.push(`BT /F2 10 Tf 20 ${yy} Td (${esc(k.replace('_', ' ').toUpperCase())}  ${v}) Tj ET`);
    lines.push(`0.9 0.92 0.95 rg 120 ${yy - 8} 260 8 re f`);
    lines.push(`0.058 0.09 0.259 rg 120 ${yy - 8} ${(pct / 100) * 260} 8 re f`);
    yy -= 18;
  });

  // Footer
  lines.push(`BT /F1 8 Tf 20 40 Td (FieldOps • ${esc(companyName || '')} • Confidential) Tj ET`);

  return `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
endobj
6 0 obj
<< /Length ${lines.join('\n').length + 30} >>
stream
${lines.join('\n')}
endstream
endobj
xref
0 7
0000000000 65535 f 
trailer
<< /Size 7 /Root 1 0 R >>
startxref
1
%%EOF
`;
}

export async function exportRevenuePdf(opts: Parameters<typeof buildPdf>[0]): Promise<string | null> {
  const filename = `fieldops-revenue-${new Date().toISOString().slice(0, 10)}.pdf`;
  try {
    const pdf = buildPdf(opts);
    const uri = `${FileSystem.documentDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(uri, pdf, { encoding: FileSystem.EncodingType.UTF8 });
    if (Platform.OS === 'web') {
      // Web: write isn't shareable; open via blob/data URI
      const blob = new Blob([pdf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      return url;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Share ${filename}` });
    } else {
      Alert.alert('PDF exported', uri);
    }
    return uri;
  } catch (e: any) {
    Alert.alert('Export failed', e.message);
    return null;
  }
}