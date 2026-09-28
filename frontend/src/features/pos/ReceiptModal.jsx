import { CheckCircle2, Download, FileText, Printer, ShoppingBag } from 'lucide-react';
import { Button, Modal } from '../../components/ui';
import { usePrint } from '../../components/print/usePrint';
import { downloadFile } from '../../api/client';
import { formatMoney } from '../../utils/format';
import { useSettings } from '../../hooks';
import { A4Invoice, ThermalReceipt } from './Documents';

/** Shown after a completed sale: print or download the receipt / invoice. */
export function ReceiptModal({ sale, onClose, onNewSale }) {
  const { print, portal } = usePrint();
  const settings = useSettings();
  const preferThermal = (settings.financial?.receipt_format || 'thermal') === 'thermal';
  if (!sale) return null;

  const printThermal = () => print(<ThermalReceipt sale={sale} />, { format: 'thermal' });
  const printA4 = () => print(<A4Invoice sale={sale} />, { format: 'a4' });

  return (
    <>
      <Modal
        open={Boolean(sale)}
        onClose={onClose}
        size="sm"
        footer={<Button className="w-full" size="lg" icon={ShoppingBag} onClick={onNewSale} data-autofocus>New sale</Button>}
      >
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-14 text-success" aria-hidden />
          <h2 className="mt-3 font-display text-2xl font-semibold">Sale complete</h2>
          <p className="text-sm text-muted">{sale.invoiceNumber} · {sale.receiptNumber}</p>
          <p className="mt-4 text-3xl font-semibold text-accent">{formatMoney(sale.total)}</p>
          {sale.changeDue > 0 ? <p className="mt-2 rounded-xl bg-green-500/10 py-2 text-lg font-semibold text-success">Change: {formatMoney(sale.changeDue)}</p> : null}
          {sale.balanceDue > 0 ? <p className="mt-2 rounded-xl bg-amber-500/10 py-2 text-sm font-medium text-warning">Balance due: {formatMoney(sale.balanceDue)}</p> : null}
          {sale.loyaltyPointsEarned ? <p className="mt-2 text-sm text-muted">{sale.customerName} earned {sale.loyaltyPointsEarned} loyalty points</p> : null}
        </div>
        <div className="mt-6 grid gap-2">
          <Button variant={preferThermal ? 'primary' : 'secondary'} icon={Printer} onClick={printThermal}>Print receipt (80 mm)</Button>
          <Button variant={preferThermal ? 'secondary' : 'primary'} icon={FileText} onClick={printA4}>Print invoice (A4)</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" size="sm" icon={Download} onClick={() => downloadFile(`/sales/${sale.id}/document`, { format: 'thermal', download: true }, `receipt-${sale.receiptNumber}.pdf`)}>Receipt PDF</Button>
            <Button variant="ghost" size="sm" icon={Download} onClick={() => downloadFile(`/sales/${sale.id}/document`, { format: 'a4', download: true }, `invoice-${sale.invoiceNumber}.pdf`)}>Invoice PDF</Button>
          </div>
        </div>
      </Modal>
      {portal}
    </>
  );
}
