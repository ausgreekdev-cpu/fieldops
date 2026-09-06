import * as React from 'react';
import { getRawDb } from '@/db/client';

export interface Stats {
  totalJobs: number;
  byStatus: Record<string, number>;
  totalInvoices: number;
  totalRevenue: number;
  pendingSync: number;
  passRate: number | null;
  totalChecklists: number;
}

export function useStats() {
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const db = getRawDb();
      const totalJobsRow = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM jobs WHERE deleted_at IS NULL`)) as any;
      const byStatusRows = (await db.getAllAsync(`SELECT status, COUNT(*) as c FROM jobs WHERE deleted_at IS NULL GROUP BY status`)) as any[];
      const byStatus: Record<string, number> = {};
      byStatusRows.forEach(r => { byStatus[r.status] = r.c; });

      const invRow = (await db.getFirstAsync(`SELECT COUNT(*) as c, COALESCE(SUM(total),0) as sum FROM invoices`)) as any;
      const pendingRow = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM outbox WHERE status IN ('pending','failed','syncing')`)) as any;
      const checklistRow = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM checklist_submissions`)) as any;
      const passRow = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM checklist_submissions WHERE result='pass'`)) as any;

      const totalChecklists = checklistRow?.c ?? 0;
      const passRate = totalChecklists > 0 ? Math.round(((passRow?.c ?? 0) / totalChecklists) * 100) : null;

      setStats({
        totalJobs: totalJobsRow?.c ?? 0,
        byStatus,
        totalInvoices: invRow?.c ?? 0,
        totalRevenue: Number(invRow?.sum ?? 0),
        pendingSync: pendingRow?.c ?? 0,
        passRate,
        totalChecklists,
      });
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  return { stats, loading, refresh };
}
