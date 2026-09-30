import { useAuthStore } from '../../store/authStore';
import { formatDateTime, formatMoney, titleCase } from '../../utils/format';

/**
 * Printable receipt (80 mm thermal) and invoice (A4) rendered as HTML for the
 * browser print dialog. Inline styles keep them independent of the app theme.
 * The same documents are available as PDFs from the server.
 */
const SYSTEM_NAME = 'ZOLA STYLISH MANAGEMENT SYSTEM';

function useBusiness() {
  const settings = useAuthStore.getState().settings || {};
  return { ...(settings.business || {}), financial: settings.financial || {} };
}

const row = { display: 'flex', justifyContent: 'space-between', gap: 8 };

export function ThermalReceipt({ sale }) {
  const b = useBusiness();
  const taxLabel = b.financial.tax_label || 'Tax';
  const dashed = { borderTop: '1px dashed #000', margin: '6px 0' };
  return (
    <div style={{ width: '72mm', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 11, color: '#000', lineHeight: 1.35 }}>
      <div style={{ textAlign: 'center' }}>
        {b.logo ? <img src={b.logo} alt="" style={{ width: 48, height: 48, objectFit: 'contain', margin: '0 auto 4px' }} /> : null}
        <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1 }}>{SYSTEM_NAME}</div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{b.salon_name}</div>
        <div>{sale.branchName}</div>
        {b.address ? <div>{b.address}</div> : null}
        {b.phone ? <div>{b.phone}</div> : null}
        {b.tax_number ? <div>TIN: {b.tax_number}{b.vat_number ? `  VRN: ${b.vat_number}` : ''}</div> : null}
      </div>
      <div style={dashed} />
      <div style={row}><span>Receipt</span><span>{sale.receiptNumber}</span></div>
      <div style={row}><span>Invoice</span><span>{sale.invoiceNumber}</span></div>
      <div style={row}><span>Date</span><span>{formatDateTime(sale.soldAt)}</span></div>
      <div style={row}><span>Customer</span><span>{sale.customerName || 'Walk-in'}</span></div>
      <div style={row}><span>Cashier</span><span>{sale.cashierName}</span></div>
      <div style={dashed} />
      {sale.items.map((item) => (
        <div key={item.id} style={{ marginBottom: 4 }}>
          <div style={{ fontWeight: 700 }}>{item.description}</div>
          <div style={row}>
            <span>{item.quantity} × {formatMoney(item.unitPrice)}{item.staff?.length ? ` (${item.staff.map((m) => m.fullName.split(' ')[0]).join(' & ')})` : item.employeeName ? ` (${item.employeeName.split(' ')[0]})` : ''}</span>
            <span>{formatMoney(item.lineTotal)}</span>
          </div>
        </div>
      ))}
      <div style={dashed} />
      <div style={row}><span>Subtotal</span><span>{formatMoney(sale.subtotal)}</span></div>
      {sale.discountAmount > 0 ? <div style={row}><span>Discount</span><span>-{formatMoney(sale.discountAmount)}</span></div> : null}
      {sale.loyaltyDiscount > 0 ? <div style={row}><span>Loyalty ({sale.loyaltyPointsRedeemed} pts)</span><span>-{formatMoney(sale.loyaltyDiscount)}</span></div> : null}
      {sale.taxMode !== 'none' && sale.taxRate > 0 ? <div style={row}><span>{taxLabel} {sale.taxRate}%{sale.taxMode === 'inclusive' ? ' incl.' : ''}</span><span>{formatMoney(sale.taxAmount)}</span></div> : null}
      <div style={{ ...row, fontSize: 14, fontWeight: 700, marginTop: 2 }}><span>TOTAL</span><span>{formatMoney(sale.total)}</span></div>
      {sale.payments.filter((p) => p.type === 'payment').map((p) => (
        <div key={p.id} style={row}><span>{titleCase(p.method)}</span><span>{formatMoney(p.amount)}</span></div>
      ))}
      {sale.changeDue > 0 ? (
        <>
          <div style={row}><span>Tendered</span><span>{formatMoney(sale.amountPaid + sale.changeDue)}</span></div>
          <div style={row}><span>Change</span><span>{formatMoney(sale.changeDue)}</span></div>
        </>
      ) : null}
      {sale.balanceDue > 0 ? <div style={{ ...row, fontWeight: 700 }}><span>Balance due</span><span>{formatMoney(sale.balanceDue)}</span></div> : null}
      {sale.loyaltyPointsEarned ? <div style={row}><span>Points earned</span><span>{sale.loyaltyPointsEarned}</span></div> : null}
      {sale.status === 'refunded' ? <div style={{ textAlign: 'center', fontWeight: 700, marginTop: 6 }}>*** REFUNDED ***</div> : null}
      <div style={dashed} />
      {b.financial.receipt_footer ? <div style={{ textAlign: 'center' }}>{b.financial.receipt_footer}</div> : null}
      <div style={{ textAlign: 'center', fontSize: 8, marginTop: 6, color: '#444' }}>Powered by {SYSTEM_NAME}</div>
    </div>
  );
}

export function A4Invoice({ sale }) {
  const b = useBusiness();
  const taxLabel = b.financial.tax_label || 'Tax';
  const th = { textAlign: 'left', padding: '8px 6px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, background: '#FCEFF4' };
  const td = { padding: '8px 6px', borderBottom: '1px solid #eee', fontSize: 12 };
  return (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', color: '#111', padding: '4mm', maxWidth: '190mm' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {b.logo ? <img src={b.logo} alt="" style={{ width: 60, height: 60, objectFit: 'contain' }} /> : null}
          <div>
            <div style={{ fontSize: 9, letterSpacing: 2, fontWeight: 700, color: '#C20E57' }}>{SYSTEM_NAME}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{b.salon_name}</div>
            <div style={{ fontSize: 11, color: '#555' }}>{[sale.branchName, b.address, b.phone, b.email].filter(Boolean).join(' · ')}</div>
            {b.tax_number ? <div style={{ fontSize: 11, color: '#555' }}>TIN: {b.tax_number}{b.vat_number ? ` · VRN: ${b.vat_number}` : ''}</div> : null}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{sale.status === 'refunded' ? 'REFUNDED' : 'INVOICE'}</div>
          <div style={{ fontSize: 11, color: '#555' }}>Invoice no. {sale.invoiceNumber}</div>
          <div style={{ fontSize: 11, color: '#555' }}>Receipt no. {sale.receiptNumber}</div>
          <div style={{ fontSize: 11, color: '#555' }}>{formatDateTime(sale.soldAt)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 40, margin: '24px 0', borderTop: '1px solid #ddd', paddingTop: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: '#777', fontWeight: 700 }}>BILLED TO</div>
          <div style={{ fontSize: 13 }}>{sale.customerName || 'Walk-in customer'}</div>
          {sale.customerPhone ? <div style={{ fontSize: 11, color: '#555' }}>{sale.customerPhone}</div> : null}
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#777', fontWeight: 700 }}>SERVED BY</div>
          <div style={{ fontSize: 13 }}>{sale.cashierName}</div>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr><th style={th}>Item</th><th style={th}>Staff</th><th style={{ ...th, textAlign: 'right' }}>Qty</th><th style={{ ...th, textAlign: 'right' }}>Price</th><th style={{ ...th, textAlign: 'right' }}>Amount</th></tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id}>
              <td style={td}>{item.description}</td>
              <td style={{ ...td, color: '#666' }}>{item.employeeName || '—'}</td>
              <td style={{ ...td, textAlign: 'right' }}>{item.quantity}</td>
              <td style={{ ...td, textAlign: 'right' }}>{formatMoney(item.unitPrice)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{formatMoney(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
        <div style={{ fontSize: 11, color: '#555', maxWidth: '50%' }}>
          Payment: {sale.payments.filter((p) => p.type === 'payment').map((p) => `${titleCase(p.method)} ${formatMoney(p.amount)}`).join(', ') || '—'}
        </div>
        <div style={{ width: 260, fontSize: 12 }}>
          <div style={row}><span>Subtotal</span><span>{formatMoney(sale.subtotal)}</span></div>
          {sale.discountAmount > 0 ? <div style={row}><span>Discount</span><span>-{formatMoney(sale.discountAmount)}</span></div> : null}
          {sale.loyaltyDiscount > 0 ? <div style={row}><span>Loyalty</span><span>-{formatMoney(sale.loyaltyDiscount)}</span></div> : null}
          {sale.taxMode !== 'none' && sale.taxRate > 0 ? <div style={row}><span>{taxLabel} {sale.taxRate}%</span><span>{formatMoney(sale.taxAmount)}</span></div> : null}
          <div style={{ ...row, background: '#141A2E', color: '#fff', padding: '8px 10px', margin: '6px 0', fontWeight: 700, fontSize: 14 }}>
            <span>TOTAL</span><span style={{ color: '#FF6FA8' }}>{formatMoney(sale.total)}</span>
          </div>
          <div style={row}><span>Amount paid</span><span>{formatMoney(sale.amountPaid)}</span></div>
          {sale.changeDue > 0 ? (
            <>
              <div style={row}><span>Tendered</span><span>{formatMoney(sale.amountPaid + sale.changeDue)}</span></div>
              <div style={row}><span>Change</span><span>{formatMoney(sale.changeDue)}</span></div>
            </>
          ) : null}
          <div style={row}><span>Balance due</span><span>{formatMoney(sale.balanceDue)}</span></div>
        </div>
      </div>
      <div style={{ marginTop: 40, borderTop: '1px solid #ddd', paddingTop: 10, textAlign: 'center', fontSize: 11 }}>
        {b.financial.receipt_footer}
        <div style={{ fontSize: 9, letterSpacing: 1.5, color: '#C20E57', fontWeight: 700, marginTop: 6 }}>{SYSTEM_NAME}</div>
      </div>
    </div>
  );
}
