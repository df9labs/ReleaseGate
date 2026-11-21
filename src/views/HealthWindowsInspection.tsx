import React from 'react';
import { AppWindowIcon, LoaderCircleIcon } from 'lucide-react';
import type { DesktopInspection } from '../api';
import { isNetlifyClient } from '../netlify-jobs';
import { formatDate } from './presentation';

export function DesktopInventory({ inspection }: { inspection: DesktopInspection }) {
  return (
    <div className="space-y-2 text-xs text-[#B9C7D5]">
      <p className="break-words font-bold text-white">{inspection.application}</p>
      {inspection.captured_at && <p className="text-[#93A4B8]">Inspection received {formatDate(inspection.captured_at, { year: true })}</p>}
      <details className="rounded-xl border border-white/10 p-3">
        <summary className="cursor-pointer font-bold text-[#FF9B5C]">
          Buttons found ({inspection.buttons.length})
        </summary>
        {inspection.buttons.length ? (
          <ul aria-label="Desktop button inventory" className="mt-2 max-h-64 divide-y divide-white/10 overflow-y-auto">
            {inspection.buttons.map((button, index) => (
              <li key={index} className="flex items-baseline justify-between gap-2 py-2">
                <span className="min-w-0 break-words">{button.name || 'Unnamed button'}</span>
                <span className="shrink-0 text-[#93A4B8]">{button.enabled ? 'Enabled' : 'Disabled'}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2">Windows exposed no visible buttons in the inspected window.</p>}
      </details>
    </div>
  );
}

export function HealthWindowsInspection({ authorised, pending, cancelled, error, inspection, choose }: {
  authorised: boolean;
  pending: boolean;
  cancelled: boolean;
  error: Error | null;
  inspection?: DesktopInspection;
  choose: () => void;
}) {
  if (isNetlifyClient) return (
    <p className="rounded-xl border border-white/10 p-3.5 text-xs leading-5 text-[#B9C7D5] sm:col-span-2">
      Open the local Windows installation of ReleaseGate on the PC running your application to choose its .exe.
    </p>
  );
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-white/10 p-3.5 sm:col-span-2">
      <h3 className="text-sm font-bold text-white">Inspect a running application</h3>
      <p className="text-xs leading-5 text-[#B9C7D5]">
        Open your app on the Windows PC running ReleaseGate, then choose its .exe.
        The inspector lists buttons in the app window. To test a button, choose it in
        the inspector, enter what should appear and confirm the action.
      </p>
      <button type="button" disabled={!authorised || pending} className="shipsure-button-secondary disabled:opacity-50" onClick={choose}>
        {pending ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <AppWindowIcon className="h-4 w-4" />}
        {pending ? 'Waiting for Windows inspector…' : 'Choose .exe on this PC'}
      </button>
      {pending && <p role="status" className="text-xs text-[#93A4B8]">Complete or cancel the inspection in the Windows dialogue.</p>}
      {cancelled && <p role="status" className="text-xs text-[#93A4B8]">Windows inspection cancelled.</p>}
      {error && <p role="alert" className="text-xs text-[#FFA0AD]">{error.message}</p>}
      {inspection && (
        <>
          <DesktopInventory inspection={inspection} />
          <p role="status" className="text-xs text-[#CCD9E7]">
            {inspection.checks.length === 0 ? 'Inventory only. No button action was tested.' :
              `${inspection.checks.length} button ${inspection.checks.length === 1 ? 'check' : 'checks'} recorded.`}
          </p>
          {inspection.checks.length > 0 && (
            <ul aria-label="Desktop action checks" className="space-y-2 text-xs text-[#CCD9E7]">
              {inspection.checks.map((check, index) => (
                <li key={index} className="break-words">
                  <strong>{check.button}</strong> → {check.expected} · {check.outcome}
                  {check.detail && <p className="mt-0.5 text-[#93A4B8]">{check.detail}</p>}
                </li>
              ))}
            </ul>
          )}
          {inspection.limitations.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-[#93A4B8]">
              {inspection.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
