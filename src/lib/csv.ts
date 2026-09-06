import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

function esc(v: any): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

export async function exportCsvAndShare(filename: string, header: string[], rows: any[][]) {
  const csv = [header.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const uri = `${FileSystem.documentDirectory}${filename}_${Date.now()}.csv`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: `Share ${filename}` });
  } else {
    Alert.alert('CSV exported', uri);
  }
  return uri;
}

export async function exportJobsCsv(jobs: any[]) {
  const header = ['id', 'title', 'customer_name', 'address', 'customer_phone', 'status', 'scheduled_at', 'created_at'];
  const rows = jobs.map(j => [j.id, j.title, j.customer_name, j.address, j.customer_phone ?? '', j.status, j.scheduled_at ?? '', j.created_at ?? '']);
  return exportCsvAndShare('jobs', header, rows);
}

export async function exportInvoicesCsv(invoices: any[]) {
  const header = ['id', 'invoice_number', 'job_id', 'company_id', 'subtotal', 'tax', 'total', 'status', 'created_at'];
  const rows = invoices.map(i => [i.id, i.invoice_number, i.job_id, i.company_id, i.subtotal, i.tax, i.total, i.status, i.created_at]);
  return exportCsvAndShare('invoices', header, rows);
}
