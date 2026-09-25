import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform, Alert, Linking } from 'react-native';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import { buildInvoicePdf } from './pdfWriter';

function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r=(Math.random()*16)|0; const v=c==='x'? r : (r&0x3)|0x8; return v.toString(16); }); }

interface GenerateOpts {
  jobId: string;
  companyId: string;
  taxRate?: number; // e.g. 0.1 for 10%
}

export async function generateInvoiceLocally({ jobId, companyId, taxRate = 0.1 }: GenerateOpts): Promise<{ id: string; pdfUri: string; number: string }> {
  const db = getRawDb();
  const job = (await db.getFirstAsync(`SELECT * FROM jobs WHERE id=?`, [jobId])) as any;
  if (!job) throw new Error('Job not found locally');

  const company = (await db.getFirstAsync(`SELECT * FROM companies WHERE id=?`, [companyId])) as any;
  const materials: any[] = job.materials ? JSON.parse(job.materials) : [];

  // Build line items from materials + flat labour fallback if empty
  let lineItems: Array<{ desc: string; qty: number; unit_price: number; amount: number }> = materials.map((m: any) => ({
    desc: m.name ?? m.desc ?? 'Materials',
    qty: Number(m.qty ?? 1),
    unit_price: Number(m.unit_price ?? m.price ?? 0),
    amount: Number(m.qty ?? 1) * Number(m.unit_price ?? m.price ?? 0),
  }));

  // If no materials/prices, add labour line placeholder
  if (lineItems.length === 0 || lineItems.every(li => li.unit_price === 0)) {
    // Keep descriptions but zero prices — user can edit before sending
    if (lineItems.length === 0) lineItems = [{ desc: job.title ?? 'Labour', qty: 1, unit_price: 0, amount: 0 }];
  }

  const subtotal = lineItems.reduce((s, li) => s + li.amount, 0);
  const tax = +(subtotal * taxRate).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  // Invoice number: INV-YYYY-XXX local counter
  const countRow = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM invoices WHERE company_id=?`, [companyId])) as { c: number } | null;
  const seq = (countRow?.c ?? 0) + 1;
  const year = new Date().getFullYear();
  const invoiceNumber = `INV-${year}-${String(seq).padStart(4, '0')}`;

  const id = uuid();
  const now = new Date().toISOString();

  // Generate PDF — dependency-free writer (pdfWriter.ts). Pure ASCII output,
  // no Buffer/pdfkit/@react-pdf — those never resolved under Metro for
  // native and broke iOS/Android bundles.
  const pdfText = buildInvoicePdf({
    invoiceNumber,
    createdAt: now,
    companyName: company?.name ?? 'FieldOps Company',
    abn: company?.abn ?? undefined,
    customerName: job.customer_name,
    customerAddress: job.address,
    lineItems,
    subtotal,
    tax,
    total,
  });
  const pdfUri = `${FileSystem.documentDirectory}${invoiceNumber}.pdf`;
  await FileSystem.writeAsStringAsync(pdfUri, pdfText, { encoding: FileSystem.EncodingType.UTF8 });

  // Save invoice locally (offline-first)
  await db.runAsync(
    `INSERT INTO invoices (id, job_id, company_id, invoice_number, line_items, subtotal, tax, total, status, pdf_path, payment_link, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NULL, ?, 0)`,
    [id, jobId, companyId, invoiceNumber, JSON.stringify(lineItems), subtotal, tax, total, pdfUri, now]
  );

  // Enqueue for sync + storage upload (pdf will be uploaded as invoice bucket file)
  const mgr = SyncManager.getInstance(getSupabase());
  const storagePath = `${companyId}/${jobId}/${invoiceNumber}.pdf`;
  await mgr.enqueue('invoices' as any, id, 'insert', {
    id, job_id: jobId, company_id: companyId, invoice_number: invoiceNumber,
    line_items: lineItems, subtotal, tax, total, status: 'draft', pdf_path: storagePath, created_at: now,
    _localPdfUri: pdfUri, // private for uploader
  });

  // Mark job invoiced locally (version guard for sync)
  const prevJob = (await db.getFirstAsync(`SELECT version FROM jobs WHERE id=?`, [jobId])) as { version: number } | null;
  await db.runAsync(`UPDATE jobs SET status='invoiced', updated_at=?, synced=0, version=version+1 WHERE id=?`, [now, jobId]);
  await mgr.enqueue('jobs' as any, jobId, 'update', { id: jobId, status: 'invoiced', updated_at: now, _expected_version: prevJob?.version ?? 1 });

  return { id, pdfUri, number: invoiceNumber };
}

export async function shareInvoicePdf(pdfUri: string, invoiceNumber: string) {
  try {
    if (Platform.OS === 'web') {
      // web: open in new tab
      window.open(pdfUri, '_blank');
      return;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(pdfUri, { mimeType: 'application/pdf', dialogTitle: `Share ${invoiceNumber}` });
    } else {
      await Linking.openURL(pdfUri);
    }
  } catch (e: any) {
    Alert.alert('Share failed', e.message);
  }
}

export async function shareViaWhatsApp(phone: string | undefined, message: string) {
  const text = encodeURIComponent(message);
  const url = phone ? `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${text}` : `https://wa.me/?text=${text}`;
  Linking.openURL(url);
}

export async function createStripePaymentLinkStub(total: number, invoiceNumber: string, invoiceId?: string): Promise<string> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('create-payment-link', {
      body: { amount: Math.round(total * 100), currency: 'aud', invoice_number: invoiceNumber, invoice_id: invoiceId },
    });
    if (!error && (data as any)?.url) return (data as any).url;
  } catch {}
  return `https://pay.fieldops.example/invoice/${invoiceNumber}?amount=${total}`;
}
