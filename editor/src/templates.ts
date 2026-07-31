/**
 * Document templates.
 *
 * X has no template system, so for anyone publishing regularly this is the
 * difference between twenty minutes and two. Each one is a skeleton the author
 * overwrites, not a wizard — the fastest way to a good page is a good page with
 * the wrong words in it.
 */

import type { Doc, Block } from './model.js';
import { bid } from './model.js';

const p = (text: string): Block => ({ id: bid(), type: 'p', content: text ? [{ text }] : [] });
const h2 = (text: string): Block => ({ id: bid(), type: 'h2', content: [{ text }] });
const h3 = (text: string): Block => ({ id: bid(), type: 'h3', content: [{ text }] });
const quote = (text: string): Block => ({ id: bid(), type: 'quote', content: [{ text }] });
const ul = (items: string[]): Block => ({ id: bid(), type: 'ul', items: items.map((t) => [{ text: t }]) });
const hr = (): Block => ({ id: bid(), type: 'hr' });
const table = (rows: string[][], header = true): Block => ({
  id: bid(),
  type: 'table',
  header,
  rows: rows.map((r) => r.map((c) => (c ? [{ text: c }] : []))),
});
const art = (text: string, caption?: string): Block => ({ id: bid(), type: 'art', text, caption });

export interface Template {
  id: string;
  name: string;
  blurb: string;
  build(): Doc;
}

export const TEMPLATES: Template[] = [
  {
    id: 'essay',
    name: 'Essay',
    blurb: 'Clean long-form. Nothing between the reader and the argument.',
    build: () => ({
      title: 'The thing you believe that most people do not',
      subtitle: 'One sentence that makes a stranger want the next paragraph.',
      cover: '',
      blocks: [
        p('Open with the concrete situation, not the abstraction. A reader will follow you anywhere once they can picture where they are standing.'),
        h2('The turn'),
        p('Say the thing that complicates the opening. This is where an essay earns its length.'),
        quote('A line worth pulling out, because someone will screenshot it.'),
        h2('What follows from it'),
        p('Land the consequence. If you cannot say what changes, the piece is not finished.'),
      ],
    }),
  },

  {
    id: 'launch',
    name: 'Product launch',
    blurb: 'Hero, three points, comparison table, call to action.',
    build: () => ({
      title: 'Introducing [product]',
      subtitle: 'What it does, in one line a stranger understands.',
      cover: '',
      blocks: [
        p('The problem, stated as the reader experiences it — not as your architecture diagram sees it.'),
        h2('What it does'),
        ul([
          'The first thing, phrased as an outcome',
          'The second thing',
          'The third thing — three is the limit before people stop reading',
        ]),
        h2('How it compares'),
        table([
          ['', 'Before', 'With [product]'],
          ['Setup', 'Hours', 'One click'],
          ['Cost', '$X / month', 'Free'],
          ['You own it', 'No', 'Yes'],
        ]),
        h2('How it works'),
        art(
          '   you  ─────►  [ editor ]  ─────►  your site\n' +
          '                     │\n' +
          '                     ├──────────►  the open network\n' +
          '                     │\n' +
          '                     └──────────►  X',
          'One thing you write, three places it lands.',
        ),
        hr(),
        p('Close with the single action you want them to take. One, not three.'),
      ],
    }),
  },

  {
    id: 'announcement',
    name: 'Announcement',
    blurb: 'Short body, oversized card. The card does the work in-feed.',
    build: () => ({
      title: 'Something happened and here is what it means',
      subtitle: 'The whole announcement, compressed into one readable line.',
      cover: '',
      blocks: [
        p('What happened. Two sentences at most — anyone who needs detail will follow the link.'),
        p('Why it matters to the person reading, stated in their terms rather than yours.'),
        hr(),
        p('Where to go next.'),
      ],
    }),
  },

  {
    id: 'hub',
    name: 'Link hub',
    blurb: 'A landing page of linked pieces. Publish the spokes first.',
    build: () => ({
      title: 'Everything about [topic], in order',
      subtitle: 'Start at the top. Each part stands alone.',
      cover: '',
      blocks: [
        p('One paragraph on who this is for and what they will know by the end.'),
        h2('Start here'),
        ul([
          'Part one — the problem →  /@you/part-one',
          'Part two — the mechanism →  /@you/part-two',
          'Part three — what to do →  /@you/part-three',
        ]),
        h2('Reference'),
        table([
          ['Piece', 'Length', 'For'],
          ['Part one', '5 min', 'Anyone'],
          ['Part two', '12 min', 'Builders'],
          ['Part three', '3 min', 'Deciders'],
        ]),
        hr(),
        p('Links point at your node pages, not at X Articles — those URLs exist before you publish, so the hub never ships with dead links.'),
      ],
    }),
  },

  {
    id: 'howto',
    name: 'How-to',
    blurb: 'Numbered steps, a diagram, and a table of what can go wrong.',
    build: () => ({
      title: 'How to [do the thing]',
      subtitle: 'The short version, then the detail.',
      cover: '',
      blocks: [
        p('What you will end up with, and roughly how long it takes.'),
        h2('Before you start'),
        ul(['The first prerequisite', 'The second']),
        h2('Steps'),
        { id: bid(), type: 'ol', items: [
          [{ text: 'Do the first thing.' }],
          [{ text: 'Do the second thing.' }],
          [{ text: 'Confirm it worked.' }],
        ] },
        h2('If it goes wrong'),
        table([
          ['Symptom', 'Cause', 'Fix'],
          ['Nothing happens', 'Step 1 was skipped', 'Go back and check'],
          ['Error message', 'Wrong credentials', 'Regenerate and retry'],
        ]),
        h3('A note on the tricky part'),
        p('The one thing everybody gets wrong, called out where they will hit it.'),
      ],
    }),
  },
];

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
