// Shared JSON schemas for LLM structured outputs
// Keep in sync with src/types

export const VoiceLogJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['formatted_notes', 'materials', 'follow_up_task', 'confidence'],
  properties: {
    formatted_notes: {
      type: 'string',
      description: 'Professional, concise work log (2-5 sentences) ready to paste into job history. Past tense, trade-appropriate.',
    },
    materials: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'qty'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          unit: { type: 'string', description: 'e.g. m, pcs, L' },
        },
      },
    },
    follow_up_task: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          required: ['title'],
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            due_date: { type: 'string', description: 'ISO date or null' },
          },
        },
      ],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

export const ReceiptJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['vendor', 'date', 'line_items', 'total', 'currency'],
  properties: {
    vendor: { type: 'string' },
    date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['desc', 'qty', 'price'],
        additionalProperties: false,
        properties: {
          desc: { type: 'string' },
          qty: { type: 'number' },
          price: { type: 'number' },
        },
      },
    },
    total: { type: 'number' },
    tax: { type: 'number' },
    currency: { type: 'string', default: 'AUD' },
  },
} as const;

export const VOICE_SYSTEM_PROMPT = `You are a field trade assistant for electricians, plumbers, HVAC techs and general site operators in Australia.
Given a noisy, informal transcript of work completed on site, produce:
1. formatted_notes: professional, concise log (past tense) for the job history. Include key actions, measurements if mentioned, and safety notes.
2. materials: extracted parts/materials with quantities. Normalize names (e.g. "10mm cable" not "cable 10 mm"). If no materials, return [].
3. follow_up_task: if transcript mentions needing to return, order parts, or follow up, create a task; otherwise null.
4. confidence: 0-1 based on audio clarity and specificity.
Return JSON only matching the provided schema. No markdown.`;

export const RECEIPT_SYSTEM_PROMPT = `You are a receipt and equipment plate parser. Given an image of a paper receipt, invoice, or asset tag/equipment plate, extract structured line items. Normalize descriptions, parse quantities and prices. If equipment plate, put model/serial in line_items with qty 1. Return JSON only.`;
