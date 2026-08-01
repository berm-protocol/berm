/**
 * The dispute screen.
 *
 * Every string it renders comes from `adjudicate()`. Nothing is written into the
 * page that the model did not compute — otherwise the screen becomes a place
 * where claims get stronger on their way to the reader, which is the failure
 * this whole package is about.
 *
 * The scenarios are FIXTURES and say so. Real artifacts replace them the moment
 * a real npub and a real Wayback capture exist; until then a demo that looked
 * live would be the same overstatement in a nicer font.
 */

import { adjudicate, type Claimant, type DisputeResult } from './dispute.js';
import type { IdentityBinding } from './continuity.js';

const DAY = 86_400;
const MAR_2024 = 1_710_000_000;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const anchored = (over: Partial<IdentityBinding> = {}): IdentityBinding => ({
  npub: 'npub1creator0000000000000000000000000000000000000000000000',
  provider: 'twitter', username: 'alice', state: 'verified',
  proofUrl: 'https://x.com/alice/status/1766000000000000000',
  archiveUrl: 'https://web.archive.org/web/20240309/https://x.com/alice/status/1766000000000000000',
  archivedAt: MAR_2024, accountId: '1234567890',
  ...over,
});

interface Scenario { id: string; label: string; bps: number; claimants: Claimant[] }

const SCENARIOS: Scenario[] = [
  {
    id: 'suspended',
    label: 'Account suspended, handle re-registered',
    bps: 2500,
    claimants: [
      { label: 'Whoever holds @alice now', binding: null, holdsNow: true, heldFrom: MAR_2024 + 660 * DAY },
      { label: 'The original creator', binding: anchored(), holdsNow: false, heldFrom: MAR_2024 },
    ],
  },
  {
    id: 'claim-only',
    label: 'Creator verified but never archived',
    bps: 2500,
    claimants: [
      { label: 'Whoever holds @alice now', binding: null, holdsNow: true, heldFrom: MAR_2024 + 660 * DAY },
      {
        label: 'The original creator',
        binding: anchored({ archiveUrl: undefined, archivedAt: undefined }),
        holdsNow: false, heldFrom: MAR_2024,
      },
    ],
  },
  {
    id: 'forged',
    label: 'A challenger archives the page today',
    bps: 2500,
    claimants: [
      {
        label: 'Challenger',
        binding: anchored({ npub: 'npub1challenger', archivedAt: MAR_2024 + 700 * DAY }),
        holdsNow: true, heldFrom: MAR_2024 + 660 * DAY,
      },
      { label: 'The original creator', binding: anchored(), holdsNow: false, heldFrom: MAR_2024 },
    ],
  },
  {
    id: 'neither',
    label: 'Neither side archived anything',
    bps: 3000,
    claimants: [
      { label: 'Whoever holds @alice now', binding: null, holdsNow: true },
      { label: 'The original creator', binding: null, holdsNow: false },
    ],
  },
];

const STATE_WORD: Record<DisputeResult['verdict'], string> = {
  demonstrable: 'One side can demonstrate it',
  contested: 'Contested',
  unresolved: 'Nothing to go on',
};

const WITH_BERM: Record<DisputeResult['verdict'], string> = {
  demonstrable:
    'A third party timestamped the binding before anyone was arguing about it. An operator can ' +
    'check that archive themselves, without trusting either claimant or us.',
  contested:
    'Both sides produced neutrally-timestamped evidence. That is a real conflict — the record ' +
    'narrows it and refuses to close it.',
  unresolved:
    'The record is honest that it adds nothing here. No archive, no timestamp, no improvement on ' +
    'what the platform already had.',
};

function tagsFor(s: DisputeResult['sides'][number]): string {
  const t: string[] = [];
  if (s.neutralEvidence) t.push('<span class="tag neutral">neutral archive</span>');
  if (s.holdsNow) t.push('<span class="tag holds">holds the handle</span>');
  if (!s.neutralEvidence && s.strength === 'none') t.push('<span class="tag nothing">nothing checkable</span>');
  else if (!s.neutralEvidence) t.push(`<span class="tag">${s.strength}</span>`);
  return t.join(' ');
}

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function render(sc: Scenario): void {
  const r = adjudicate('alice', 'twitter', sc.bps, sc.claimants);

  el('s-handle').textContent = `@${r.handle}`;
  el('s-bps').textContent = `${(r.bps / 100).toFixed(0)}%`;
  el('s-count').textContent = String(r.sides.length);

  el('without').textContent = r.withoutBerm;
  el('with').textContent = WITH_BERM[r.verdict];

  el('sides').innerHTML = r.sides.map((s, i) => `
    <div class="side${i === 0 && r.verdict === 'demonstrable' ? ' lead' : ''}">
      <div class="top">
        <span class="name">${escape(s.label)}</span>
        ${tagsFor(s)}
      </div>
      <p class="shows">${escape(s.shows)}</p>
      <dl>
        <dt>proven since</dt>
        <dd>${s.provenSince
          ? new Date(s.provenSince * 1000).toISOString().slice(0, 10) + ' &nbsp;<span style="color:var(--faint)">third-party capture</span>'
          : '<span style="color:var(--faint)">nothing a third party timestamped</span>'}</dd>
        <dt>continuity</dt>
        <dd>${s.strength}</dd>
      </dl>
    </div>`).join('');

  const v = el('verdict');
  v.setAttribute('data-verdict', r.verdict);
  el('v-state').textContent = STATE_WORD[r.verdict];
  el('v-summary').textContent = r.summary;

  // Array.from rather than for-of: NodeListOf is only iterable with the
  // DOM.Iterable lib, and adding a lib to satisfy a loop is the tail wagging.
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#scenarios button'))) {
    b.setAttribute('aria-pressed', String(b.dataset.id === sc.id));
  }
}

el('scenarios').innerHTML = SCENARIOS.map(
  (s) => `<button data-id="${s.id}" aria-pressed="false">${escape(s.label)}</button>`,
).join('');

for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#scenarios button'))) {
  b.onclick = () => {
    const found = SCENARIOS.find((s) => s.id === b.dataset.id);
    if (found) render(found);
  };
}

const first = SCENARIOS[0];
if (first) render(first);
