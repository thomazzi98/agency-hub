import { networkLabel, publicationStatusLabel, strings } from '../lib/strings';
import { publicationTone, toneClasses } from '../lib/tones';
import { NETWORKS, type Publication, type PublicationNetwork } from '../modules/publications/api';

/**
 * The publication state of every network for one content item, always showing all four
 * so "not registered" is as visible as "published" — the spec asks for it to be
 * unambiguous which networks are done and which are still pending
 * (03-functional-requirements.md#multi-network-publication-log).
 */
export function NetworkChips({
  publications,
  onSelect,
}: {
  publications: Publication[];
  onSelect?: (network: PublicationNetwork, existing: Publication | undefined) => void;
}) {
  const byNetwork = new Map(publications.map((row) => [row.network, row]));
  const published = publications.filter((row) => row.status === 'published').length;

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-wrap gap-1" aria-label={strings.publications.heading}>
        {NETWORKS.map((network) => {
          const existing = byNetwork.get(network);
          const status = existing?.status ?? null;
          const label = `${networkLabel(network)}: ${
            status ? publicationStatusLabel(status) : strings.publications.notTracked
          }`;
          const chip = `inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${toneClasses[publicationTone(status)]}`;

          return (
            <li key={network}>
              {onSelect ? (
                <button
                  type="button"
                  aria-label={label}
                  title={label}
                  onClick={() => onSelect(network, existing)}
                  className={`${chip} transition hover:ring-2`}
                >
                  {networkLabel(network)}
                </button>
              ) : (
                <span className={chip} aria-label={label} title={label}>
                  {networkLabel(network)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-slate-500">
        {strings.publications.doneCount(published, NETWORKS.length)}
      </p>
    </div>
  );
}
