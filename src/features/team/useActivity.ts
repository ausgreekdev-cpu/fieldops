import * as React from 'react';
import { getRawDb } from '@/db/client';
import { getSupabase } from '@/lib/supabase';

export interface ActivityItem {
  id: string;
  type: 'job' | 'checklist' | 'invoice' | 'sync';
  title: string;
  subtitle: string;
  time: string;
  status?: string;
}

export function useActivity(limit = 20) {
  const [items, setItems] = React.useState<ActivityItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const db = getRawDb();
      let rows: ActivityItem[] = [];

      // Jobs recent
      try {
        const jobs = (await db.getAllAsync(`SELECT id, title, status, updated_at FROM jobs WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ${limit}`)) as any[];
        jobs.forEach(j => rows.push({ id: `job-${j.id}`, type: 'job', title: j.title, subtitle: `Job • ${j.status}`, time: j.updated_at, status: j.status }));
      } catch {}

      // Checklist submissions
      try {
        const checks = (await db.getAllAsync(`SELECT id, result, created_at FROM checklist_submissions ORDER BY created_at DESC LIMIT ${limit}`)) as any[];
        checks.forEach(c => rows.push({ id: `chk-${c.id}`, type: 'checklist', title: `Checklist ${c.result}`, subtitle: `Safety • ${c.result}`, time: c.created_at, status: c.result }));
      } catch {}

      // Invoices
      try {
        const invs = (await db.getAllAsync(`SELECT id, invoice_number, status, created_at FROM invoices ORDER BY created_at DESC LIMIT ${limit}`)) as any[];
        invs.forEach(i => rows.push({ id: `inv-${i.id}`, type: 'invoice', title: i.invoice_number, subtitle: `Invoice • ${i.status}`, time: i.created_at, status: i.status }));
      } catch {}

      // Sort by time desc, take limit
      rows.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      rows = rows.slice(0, limit);

      // Try enrich with Supabase sync_logs if online
      try {
        const supabase = getSupabase();
        const { data } = await supabase.from('sync_logs').select('*').order('created_at', { ascending: false }).limit(10);
        if (data) {
          data.forEach((s: any) => {
            // avoid dup by id
            if (!rows.find(r => r.id === s.id)) {
              rows.unshift({ id: s.id, type: 'sync', title: `${s.table_name} • ${s.operation}`, subtitle: `Sync • ${s.status}`, time: s.created_at, status: s.status });
            }
          });
          rows = rows.slice(0, limit);
        }
      } catch {}

      setItems(rows);
    } finally { setLoading(false); }
  }, [limit]);

  React.useEffect(() => { refresh(); }, [refresh]);

  return { items, loading, refresh };
}
