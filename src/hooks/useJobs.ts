import { useEffect, useState, useCallback } from 'react';
import { getRawDb } from '@/db/client';
import { JobStatus } from '@/types';

export interface LocalJob {
  id: string;
  title: string;
  customer_name: string;
  address: string;
  customer_phone: string | null;
  status: JobStatus;
  scheduled_at: string | null;
  lat: number | null;
  lng: number | null;
}

export function useJobs(filter?: JobStatus | 'all') {
  const [jobs, setJobs] = useState<LocalJob[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const db = getRawDb();
      const where = filter && filter !== 'all' ? `WHERE status='${filter}' AND deleted_at IS NULL` : `WHERE deleted_at IS NULL`;
      const rows = (await db.getAllAsync(`SELECT id, title, customer_name, address, customer_phone, status, scheduled_at, lat, lng FROM jobs ${where} ORDER BY scheduled_at DESC, created_at DESC LIMIT 100`)) as LocalJob[];
      setJobs(rows);
    } catch (e) {
      console.warn('[useJobs]', e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    let mounted = true;
    refresh();
    const id = setInterval(() => mounted && refresh(), 3000); // cheap poll for local changes
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [refresh]);

  return { jobs, loading, refresh };
}
