// Regression tests for the dependency-free invoice PDF writer (Fix 2).
const { buildInvoicePdf } = require('../src/features/invoices/pdfWriter');

const SAMPLE = {
  invoiceNumber: 'INV-2026-0007',
  createdAt: '2026-09-25T10:00:00.000Z',
  companyName: 'Smith Electrical',
  abn: '12 345 678 901',
  customerName: 'Jane Smith',
  customerAddress: '12 Smith St, Perth WA 6000',
  lineItems: [
    { desc: 'Switchboard upgrade', qty: 1, unit_price: 1200, amount: 1200 },
    { desc: 'Cable 2.5mm (x20)', qty: 20, unit_price: 3.5, amount: 70 },
  ],
  subtotal: 1270,
  tax: 127,
  total: 1397,
};

function xrefEntries(pdf) {
  // Parse xref entry lines: 10-digit offset + ' 00000 n'
  const xrefIdx = pdf.indexOf('\nxref\n');
  expect(xrefIdx).toBeGreaterThan(0);
  const xrefStart = xrefIdx + 1;
  const lines = pdf.slice(xrefStart).split('\n');
  expect(lines[0]).toMatch(/^xref$/);
  const count = Number(lines[1].split(' ')[1]);
  return lines.slice(2, 2 + count);
}

describe('invoice PDF writer', () => {
  it('produces a structurally valid PDF (header, xref offsets, EOF)', () => {
    const pdf = buildInvoicePdf(SAMPLE);
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);

    const entries = xrefEntries(pdf);
    // entry 0 is the free list: '0000000000 65535 f '
    expect(entries[0]).toMatch(/^0000000000 65535 f $/);
    // every object offset points at "N 0 obj"
    for (let i = 1; i < entries.length; i++) {
      const off = Number(entries[i].slice(0, 10));
      expect(pdf.slice(off, off + String(i).length + 6)).toBe(`${i} 0 obj`);
    }
    // startxref points at the xref table
    const sxTail = pdf.slice(pdf.lastIndexOf('startxref') + 'startxref'.length);
    const startxref = Number(sxTail.trim().split(/\s+/)[0]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('contains the invoice essentials', () => {
    const pdf = buildInvoicePdf(SAMPLE);
    expect(pdf).toContain('INV-2026-0007');
    expect(pdf).toContain('Jane Smith');
    expect(pdf).toContain('$1397.00');
    expect(pdf).toContain('Smith Electrical');
    expect(pdf).toContain('ABN 12 345 678 901');
    expect(pdf).toContain('Switchboard upgrade');
  });

  it('stays pure ASCII (byte offsets = string offsets)', () => {
    const pdf = buildInvoicePdf({
      ...SAMPLE,
      customerName: 'José Muñoz — "Café" ✓',
      lineItems: [{ desc: 'wärme° (prüfen)', qty: 1, unit_price: 1, amount: 1 }],
    });
    for (let i = 0; i < pdf.length; i++) {
      const c = pdf.charCodeAt(i);
      // only LF plus printable ASCII — one byte per char in UTF-8 and latin1
      expect(c === 0x0a || (c >= 0x20 && c <= 0x7e)).toBe(true);
    }
  });

  it('escapes PDF string metacharacters', () => {
    const pdf = buildInvoicePdf({
      ...SAMPLE,
      customerName: 'Test (with) parens \\ and more',
    });
    expect(pdf).toContain('Test \\(with\\) parens \\\\ and more');
    // no unescaped lone parens inside the BT/ET content
    expect(pdf).not.toContain('(Test (with)');
  });

  it('paginates many line items into multiple pages', () => {
    const many = Array.from({ length: 90 }, (_, i) => ({
      desc: `Item ${i}`,
      qty: 1,
      unit_price: 10,
      amount: 10,
    }));
    const pdf = buildInvoicePdf({ ...SAMPLE, lineItems: many, subtotal: 900, tax: 90, total: 990 });
    expect(pdf).toContain('/Count 3');
    expect(pdf).toContain('Page 3 of 3');
  });
});
