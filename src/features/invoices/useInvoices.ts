import { useCallback, useEffect, useState } from 'react';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';

export interface LocalInvoice {
  id: string;
  job_id: string;
  company_id: string;
  invoice_number: string;
  line_items: string; // JSON
  subtotal: number;
  tax: number;
  total: number;
  status: string;
  pdf_path: string | null;
  payment_link: string | null;
  paid_at: string | null;
  created_at: string;
}

export function useInvoices(companyId?: string) {
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const db = getRawDb();
      const rows = (await db.getAllAsync(
        companyId
          ? `SELECT * FROM invoices WHERE company_id=? ORDER BY created_at DESC LIMIT 100`
          : `SELECT * FROM invoices ORDER BY created_at DESC LIMIT 100`,
        companyId ? [companyId] : []
      )) as LocalInvoice[];
      setInvoices(rows);
      // background pull if online
      try {
        const supabase = getSupabase();
        const q = supabase.from('invoices').select('*').order('created_at', { ascending: false }).limit(50);
        const { data } = companyId ? await q.eq('company_id', companyId) : await q;
        if (data && data.length > 0) {
          for (const r of data) {
            // Prefer real Stripe URL over stub: if existing local has real https://checkout.stripe.com or https://buy.stripe.com and remote is stub, keep real
            const existing = (await db.getFirstAsync(`SELECT payment_link FROM invoices WHERE id=?`, [r.id])) as any;
            const incomingLink = r.payment_link as string | null;
            const keepExisting = existing?.payment_link && existing.payment_link.includes('stripe.com') && incomingLink?.includes('pay.fieldops.example');
            const finalLink = keepExisting ? existing.payment_link : incomingLink;
            await db.runAsync(
              `INSERT OR REPLACE INTO invoices (id, job_id, company_id, invoice_number, line_items, subtotal, tax, total, status, pdf_path, payment_link, paid_at, created_at, synced)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
              [r.id, r.job_id, r.company_id, r.invoice_number, JSON.stringify(r.line_items ?? []), r.subtotal ?? 0, r.tax ?? 0, r.total ?? 0, r.status ?? 'draft', r.pdf_path, finalLink, (r as any).paid_at ?? null, r.created_at]
            );
          }
          const refreshed = (await db.getAllAsync(`SELECT * FROM invoices ORDER BY created_at DESC LIMIT 100`)) as LocalInvoice[];
          setInvoices(refreshed);
        }
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { invoices, loading, refresh };
}
