import { getRawDb } from './client';

const DEFAULT_TEMPLATES = [
  {
    name: 'Pre-Start Electrical',
    description: 'Mandatory before any electrical work — photo proof required for fails',
    fields: [
      { key: 'isolated', label: 'Site isolated & locked out', type: 'pass_fail', required: true },
      { key: 'ppe', label: 'PPE checked (helmet, gloves, glasses)', type: 'pass_fail', required: true },
      { key: 'test_tag', label: 'Tools test & tagged (current)', type: 'pass_fail', required: true },
      { key: 'hazards', label: 'Hazards identified & controls in place', type: 'pass_fail', required: true },
      { key: 'first_aid', label: 'First aid kit accessible', type: 'checkbox', required: false },
      { key: 'weather', label: 'Weather conditions', type: 'select', options: ['Clear', 'Windy', 'Rain', 'Extreme heat'], required: true },
      { key: 'site_photo', label: 'Site photo proof', type: 'photo', required: false },
      { key: 'notes', label: 'Additional notes', type: 'text', required: false },
    ],
  },
  {
    name: 'Working at Heights',
    description: 'Required for work >2m — harness + anchor proof',
    fields: [
      { key: 'harness', label: 'Harness inspected & fitted', type: 'pass_fail', required: true },
      { key: 'anchor', label: 'Anchor point certified', type: 'pass_fail', required: true },
      { key: 'barriers', label: 'Edge protection / barriers in place', type: 'pass_fail', required: true },
      { key: 'weather_h', label: 'Wind / weather suitable', type: 'pass_fail', required: true },
      { key: 'rescue_plan', label: 'Rescue plan briefed', type: 'checkbox', required: true },
      { key: 'height_notes', label: 'Notes', type: 'text', required: false },
    ],
  },
];

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function seedDefaultChecklists(companyId: string) {
  const db = getRawDb();
  const existing = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM compliance_checklists WHERE company_id=?`, [companyId])) as { c: number } | null;
  if (existing && existing.c > 0) return; // already seeded

  const now = new Date().toISOString();
  for (const tpl of DEFAULT_TEMPLATES) {
    const id = uuid();
    await db.runAsync(
      `INSERT INTO compliance_checklists (id, company_id, name, description, fields, is_active, synced) VALUES (?, ?, ?, ?, ?, 1, 0)`,
      [id, companyId, tpl.name, tpl.description, JSON.stringify(tpl.fields)]
    );
  }
  console.log('[seed] Inserted default checklist templates for', companyId);
}

const DEMO_JOBS = [
  { title: 'Switchboard upgrade — 12 Smith St', customer_name: 'Jane Smith', customer_phone: '+61 400 111 222', address: '12 Smith St, Perth WA 6000', description: 'Replace 3-phase board, test & tag', status: 'scheduled' as const },
  { title: 'Leaking tap — 45 High Rd', customer_name: 'Bob Lee', customer_phone: '+61 400 333 444', address: '45 High Rd, Fremantle WA 6160', description: 'Kitchen mixer cartridge', status: 'in_progress' as const },
  { title: 'AC service — 8 Beach Ave', customer_name: 'Krystal Bloom', customer_phone: '+61 400 555 666', address: '8 Beach Ave, Cottesloe WA 6011', description: 'Quarterly service, filter clean', status: 'completed' as const },
];

export async function seedDemoJobs(companyId: string, assignedTo?: string) {
  const db = getRawDb();
  const existing = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM jobs WHERE company_id=?`, [companyId])) as { c: number } | null;
  if (existing && existing.c > 0) return;
  const now = new Date().toISOString();
  for (const j of DEMO_JOBS) {
    const id = uuid();
    await db.runAsync(
      `INSERT INTO jobs (id, local_id, company_id, assigned_to, customer_name, customer_phone, address, title, description, status, scheduled_at, materials, notes, version, created_at, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, 1, ?, ?, 0)`,
      [id, id, companyId, assignedTo ?? null, j.customer_name, j.customer_phone, j.address, j.title, j.description, j.status, now, now, now]
    );
  }
  console.log('[seed] Demo jobs inserted for', companyId);
}

export { DEFAULT_TEMPLATES, DEMO_JOBS };
