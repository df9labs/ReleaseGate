import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircleIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { api, type DiscoveredButton } from '../api';

interface Props {
  targetUrl: string;
  sampleSite: boolean;
  authorised: boolean;
  chosen: string[];
  canAdd: boolean;
  onChoose: (name: string) => void;
}

function buttonNote(button: DiscoveredButton) {
  if (!button.name.trim()) return 'No accessible name';
  if (button.ambiguous) return 'Several controls share this name';
  if (button.disabled) return 'Disabled on the starting page';
  if (!button.selectable && button.name.length >= 160) return 'Name exceeds 160 characters';
  if (!button.selectable) return 'Unavailable for a named check';
  return button.automatic ? 'Eligible for an automatic interaction check' : '';
}

export function HealthButtonDiscovery({ targetUrl, sampleSite, authorised, chosen, canAdd, onChoose }: Props) {
  const active = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => active.current?.abort(), []);
  const discovery = useMutation({
    mutationFn: () => {
      active.current?.abort();
      active.current = new AbortController();
      return api.discoverHealthButtons({
        target_url: sampleSite ? '' : targetUrl.trim(),
        sample_site: sampleSite,
        authorization_attested: authorised,
      }, active.current.signal);
    },
  });
  return (
    <div className="space-y-2">
      <button type="button" disabled={!authorised || discovery.isPending} onClick={() => discovery.mutate()}
        className="shipsure-button-secondary text-xs disabled:opacity-50">
        {discovery.isPending ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
        {discovery.isPending ? 'Finding buttons…' : 'Find buttons'}
      </button>
      {discovery.isError && <p role="alert" className="text-xs text-[#FFA0AD]">{discovery.error.message}</p>}
      {discovery.data && (
        <div className="space-y-2">
          <p role="status" className="text-xs font-bold text-[#CCD9E7]">
            {discovery.data.total
              ? `${discovery.data.total} visible ${discovery.data.total === 1 ? 'button' : 'buttons'} found on the starting page.`
              : 'Discovery returned no visible buttons.'}
          </p>
          {discovery.data.buttons.length > 0 && (
            <ul aria-label="Discovered buttons" className="max-h-64 divide-y divide-white/10 overflow-y-auto rounded-lg border border-white/10">
              {discovery.data.buttons.map((item, index) => {
                const selected = chosen.includes(item.name.trim());
                const available = item.selectable && !item.disabled && !item.ambiguous && item.name.trim() && item.name.length <= 160;
                const note = selected ? 'Added to checks' : buttonNote(item);
                return (
                  <li key={index} className="flex min-w-0 items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <span className="block break-words font-semibold text-white">{item.name || 'Unnamed button'}</span>
                      {note && <span className="mt-1 block text-[#93A4B8]">{note}</span>}
                    </div>
                    {available && !selected && (
                      <button type="button" aria-label={`Add check for ${item.name}`} disabled={!canAdd}
                        className="shipsure-button-secondary shrink-0 text-xs disabled:opacity-50" onClick={() => onChoose(item.name)}>
                        <PlusIcon className="h-3.5 w-3.5" /> Add check
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {discovery.data.limitations.length > 0 && (
            <ul aria-label="Discovery limitations" className="list-disc space-y-1 pl-4 text-xs leading-5 text-[#93A4B8]">
              {discovery.data.limitations.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
