import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Print a React element (receipt, invoice, appointment slip) without the app
 * chrome. The element is rendered into a print-only container, the browser
 * print dialog opens, and the container is removed afterwards.
 *
 *   const { print, portal } = usePrint();
 *   print(<Receipt sale={sale} />, { format: 'thermal' });
 *   return <>{...}{portal}</>;
 */
export function usePrint() {
  const [job, setJob] = useState(null);

  const print = useCallback((node, { format = 'a4' } = {}) => setJob({ node, format, id: Date.now() }), []);

  useEffect(() => {
    if (!job) return undefined;
    document.body.classList.add('has-print-area');
    document.body.classList.toggle('printing-thermal', job.format === 'thermal');
    const done = () => {
      document.body.classList.remove('has-print-area', 'printing-thermal');
      setJob(null);
    };
    window.addEventListener('afterprint', done, { once: true });
    // Let images (logo, QR code) load before opening the dialog.
    const timer = setTimeout(() => window.print(), 250);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', done);
    };
  }, [job]);

  const portal = job
    ? createPortal(<div className={`print-area print-${job.format}`}>{job.node}</div>, document.body)
    : null;

  return { print, portal };
}
