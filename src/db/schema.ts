import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// Local mirror of Postgres schema for expo-sqlite + drizzle
// All ids are text (uuid strings). Timestamps stored as ISO strings.
// jsonb fields stored as text JSON strings — parse on read.

export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  abn: text('abn'),
  taxRate: real('tax_rate').default(10),
  subscriptionTier: text('subscription_tier').default('free'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  // sync helpers
  synced: integer('synced', { mode: 'boolean' }).default(false),
  version: integer('version').default(1),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  role: text('role').default('technician'),
  displayName: text('display_name'),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  synced: integer('synced', { mode: 'boolean' }).default(false),
});

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  localId: text('local_id').unique(),
  companyId: text('company_id').notNull(),
  assignedTo: text('assigned_to'),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone'),
  customerEmail: text('customer_email'),
  address: text('address').notNull(),
  lat: real('lat'),
  lng: real('lng'),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('scheduled'), // scheduled|in_progress|completed|invoiced
  scheduledAt: text('scheduled_at'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  materials: text('materials').default('[]'), // JSON string
  notes: text('notes'),
  version: integer('version').default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  synced: integer('synced', { mode: 'boolean' }).default(false),
});

export const jobPhotos = sqliteTable('job_photos', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  companyId: text('company_id').notNull(),
  storagePath: text('storage_path').notNull(),
  localUri: text('local_uri'),
  caption: text('caption'),
  takenAt: text('taken_at').notNull(),
  synced: integer('synced', { mode: 'boolean' }).default(false),
});

export const jobSignatures = sqliteTable('job_signatures', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  companyId: text('company_id').notNull(),
  storagePath: text('storage_path').notNull(),
  signedByName: text('signed_by_name').notNull(),
  signedAt: text('signed_at').notNull(),
  synced: integer('synced', { mode: 'boolean' }).default(false),
});

export const complianceChecklists = sqliteTable('compliance_checklists', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  fields: text('fields').default('[]'), // JSON
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  synced: integer('synced', { mode: 'boolean' }).default(false),
});

export const checklistSubmissions = sqliteTable('checklist_submissions', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  checklistId: text('checklist_id').notNull(),
  companyId: text('company_id').notNull(),
  responses: text('responses').default('{}'),
  photoProofs: text('photo_proofs'), // JSON array string
  signedBy: text('signed_by'),
  signedAt: text('signed_at'),
  result: text('result'),
  createdAt: text('created_at').notNull(),
  synced: integer('synced', { mode: 'boolean' }).default(false),
});

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  companyId: text('company_id').notNull(),
  invoiceNumber: text('invoice_number').notNull(),
  lineItems: text('line_items').default('[]'),
  subtotal: real('subtotal').default(0),
  tax: real('tax').default(0),
  total: real('total').default(0),
  status: text('status').default('draft'),
  pdfPath: text('pdf_path'),
  paymentLink: text('payment_link'),
  paidAt: text('paid_at'),
  createdAt: text('created_at').notNull(),
  synced: integer('synced', { mode: 'boolean' }).default(false),
});

// Outbox queue — single source of truth for pending sync
export const outbox = sqliteTable('outbox', {
  id: text('id').primaryKey(), // uuid
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  operation: text('operation').notNull(), // insert|update|delete
  payload: text('payload').notNull(), // JSON string
  attempts: integer('attempts').default(0),
  nextRetryAt: text('next_retry_at'),
  status: text('status').default('pending'), // pending|syncing|failed
  error: text('error'),
  createdAt: text('created_at').notNull(),
});

// Sync metadata
export const syncMeta = sqliteTable('sync_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type JobStatus = 'scheduled' | 'in_progress' | 'completed' | 'invoiced';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
