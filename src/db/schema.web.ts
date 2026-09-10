 // Web stub for drizzle schema — no sqlite, just dummy exports to avoid Jimp/drizzle bundling issues
export const companies = {} as any;
export const users = {} as any;
export const jobs = {} as any;
export const jobPhotos = {} as any;
export const jobSignatures = {} as any;
export const complianceChecklists = {} as any;
export const checklistSubmissions = {} as any;
export const invoices = {} as any;
export const outbox = {} as any;
export const syncMeta = {} as any;
export type JobStatus = 'scheduled' | 'in_progress' | 'completed' | 'invoiced';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
