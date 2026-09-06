import * as React from 'react';
import { getRawDb } from '@/db/client';

export interface WeeklyPoint { label: string; revenue: number; count: number; }

export function useRevenueTrend(weeks = 6) {
  const [points, setPoints] = React.useState<WeeklyPoint[]>([]);
  const [paidVsDraft, setPaidVsDraft] = React.useState<{ paid: number; draft: number; paidSum: number; draftSum: number } | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const db = getRawDb();
      // Weekly buckets: Monday start
      const now = new Date();
      const pts: WeeklyPoint[] = [];
      for (let i = weeks - 1; i >= 0; i--) {
        const end = new Date(now);
        end.setDate(now.getDate() - i * 7);
        end.setHours(23, 59, 59, 999);
        const start = new Date(end);
        start.setDate(end.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        const label = `${start.getMonth() + 1}/${start.getDate()}`;
        const row = (await db.getFirstAsync(
          `SELECT COUNT(*) as c, COALESCE(SUM(total),0) as sum FROM invoices WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)`,
          [start.toISOString(), end.toISOString()]
        )) as any;
        pts.push({ label, revenue: Number(row?.sum ?? 0), count: row?.c ?? 0 });
      }
      setPoints(pts);

      const paidRow = (await db.getFirstAsync(`SELECT COUNT(*) as c, COALESCE(SUM(total),0) as sum FROM invoices WHERE status='paid'`)) as any;
      const draftRow = (await db.getFirstAsync(`SELECT COUNT(*) as c, COALESCE(SUM(total),0) as sum FROM invoices WHERE status='draft'`)) as any;
      setPaidVsDraft({
        paid: paidRow?.c ?? 0,
        draft: draftRow?.c ?? 0,
        paidSum: Number(paidRow?.sum ?? 0),
        draftSum: Number(draftRow?.sum ?? 0),
      });
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [weeks]);

  React.useEffect(() => { refresh(); }, [refresh]);

  return { points, paidVsDraft, loading, refresh };
}
