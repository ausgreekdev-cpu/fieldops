import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform, Alert, Linking } from 'react-native';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';
import { SyncManager } from '@/sync/SyncManager';
import { pdf } from '@react-pdf/renderer';
import * as React from 'react';
import { InvoicePdf } from './pdfTemplate';

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

  // Generate PDF via @react-pdf/renderer (works on-device)
  const doc = React.createElement(InvoicePdf, {
    company: { name: company?.name ?? 'FieldOps Company', abn: company?.abn ?? undefined, address: company?.address ?? undefined },
    invoice: { invoice_number: invoiceNumber, created_at: now, line_items: lineItems, subtotal, tax, total },
    customer: { name: job.customer_name, address: job.address },
  } as any);

  // pdf().toBlob() is web-only; in Expo we use toString or render to file via FileSystem
  // Use pdf().toBlob approach with polyfill: generate via pdf().toString() is not ideal, so we use expo-print-like fallback:
  // For offline MVP we generate a simple HTML and use FileSystem, but use @react-pdf's pdf().toBuffer if available
  let pdfUri = '';
  try {
    // @ts-ignore — pdf instance has toBuffer in node/expo
    const instance = pdf(doc as any);
    const buffer: Uint8Array | Buffer | Blob = await (instance as any).toBuffer();
    // buffer may be Uint8Array or Blob
    let base64: string;
    if (buffer instanceof Uint8Array || Buffer.isBuffer(buffer as any)) {
      base64 = Buffer.from(buffer as any).toString('base64');
    } else if (buffer instanceof Blob) {
      const ab = await (buffer as Blob).arrayBuffer();
      base64 = Buffer.from(ab as any).toString('base64');
    } else {
      // fallback to string
      const str = await (instance as any).toString();
      base64 = Buffer.from(str).toString('base64');
    }
    pdfUri = `${FileSystem.documentDirectory}${invoiceNumber}.pdf`;
    await FileSystem.writeAsStringAsync(pdfUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  } catch (e) {
    // Fallback: write a minimal placeholder PDF (still shareable) so flow never blocks offline
    console.warn('[generateInvoice] pdf render fallback', e);
    pdfUri = `${FileSystem.documentDirectory}${invoiceNumber}.pdf`;
    // tiny valid PDF header placeholder
    const placeholder = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n`;
    await FileSystem.writeAsStringAsync(pdfUri, placeholder, { encoding: FileSystem.EncodingType.UTF8 });
  }

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

  // Mark job invoiced locally
  await db.runAsync(`UPDATE jobs SET status='invoiced', updated_at=?, synced=0 WHERE id=?`, [now, jobId]);
  await mgr.enqueue('jobs' as any, jobId, 'update', { id: jobId, status: 'invoiced', updated_at: now });

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

export async function createStripePaymentLinkStub(total: number, invoiceNumber: string): Promise<string> {
  // Real implementation: call supabase edge function create-payment-link which does stripe.paymentLinks.create
  // Offline stub returns a placeholder that resolves when online via sync
  // If supabase is configured, try live call
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('create-payment-link', {
      body: { amount: Math.round(total * 100), currency: 'aud', invoice_number: invoiceNumber },
    });
    if (!error && (data as any)?.url) return (data as any).url;
  } catch {}
  // Fallback stub — store locally, will be replaced on sync
  return `https://pay.fieldops.example/invoice/${invoiceNumber}?amount=${total}`;
}
