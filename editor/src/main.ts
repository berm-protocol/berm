/**
 * XOnly editor — prototype.
 *
 * Write once. Publish to three places. Own the canonical copy.
 */

import type { Doc, Block, Inline, TextBlock, ListBlock, ImageBlock, EmbedBlock, TableBlock, ArtBlock } from './model.js';
import { emptyDoc, bid, slugify, readingMinutes, wordCount, docSummary, firstImage,
         newTable, newArt, isTable, isArt } from './model.js';
import { renderTablePng, renderArtPng, dataUrlToBlob, DARK } from './render/block-png.js';
import { buildXExport, copyBody, copyTitle, type XExport, type RenderedMap } from './targets/x-export.js';
import { TEMPLATES, templateById } from './templates.js';
import { parseInline, inlineToDom, isTextBlock, isListBlock, convertBlock, shortcutFor, newParagraph } from './editor/blocks.js';
import { docToNip23, docToMarkdown, articleCoordinate } from './targets/nostr-30023.js';
import { docToNodePage, cardMeta } from './targets/node-page.js';
import { docToDraftJs, buildDraftPayload, publishXArticle, X_API } from './targets/x-article.js';
import { cardToDataUrl } from './og/card-image.js';
import { createLocalSigner } from './sdk/local-signer.js';
import { UserDeclinedError } from './sdk/types.js';
import type { XnsbSdk, Session, SignedEvent } from './sdk/types.js';

const $ = (id: string) => {
  const el = document.getElementById(id);
  // A missing element used to throw mid-boot and silently abandon every
  // listener registered after it. Fail loudly, keep going.
  if (!el) { console.error(`[xonly] missing element #${id}`); return document.createElement('div'); }
  return el;
};
const DOMAIN = 'xonly.ai';

/* ══════════════════════════════════════════════════════════════════════
   State
   ══════════════════════════════════════════════════════════════════════ */

let doc: Doc = emptyDoc();
let sdk: XnsbSdk;
let session: Session | null = null;
let activeBlockId: string | null = null;
let lastPublished: { event?: SignedEvent; coordinate?: string; nodeHtml?: string } = {};
let lastXExport: XExport | null = null;

const relayParam = new URLSearchParams(location.search).get('relays');
const RELAYS = relayParam
  ? relayParam.split(',').map((s) => s.trim()).filter((s) => /^wss?:\/\//.test(s))
  : undefined;

/* ══════════════════════════════════════════════════════════════════════
   Approval dialog — the remote signer will do this for real
   ══════════════════════════════════════════════════════════════════════ */

function requestApproval(summary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = $('approval');
    $('approval-what').textContent = summary;
    modal.classList.remove('hidden');

    const done = (ok: boolean) => {
      modal.classList.add('hidden');
      $('approve-yes').onclick = null;
      $('approve-no').onclick = null;
      resolve(ok);
    };
    $('approve-yes').onclick = () => done(true);
    $('approve-no').onclick = () => done(false);
  });
}

/* ══════════════════════════════════════════════════════════════════════
   Editor rendering
   ══════════════════════════════════════════════════════════════════════ */

const PLACEHOLDER: Record<string, string> = {
  h1: 'Heading', h2: 'Section', h3: 'Subsection',
  p: "Write, or press '/' for blocks…",
  quote: 'Quote', code: 'Code',
};

function makeRow(b: Block): HTMLElement {
  const row = document.createElement('div');
  row.className = 'blockrow';
  row.dataset.id = b.id;

  const handle = document.createElement('button');
  handle.className = 'handle';
  handle.title = 'Change block type';
  handle.textContent = '⋮⋮';
  handle.onclick = (e) => { e.preventDefault(); openBlockMenu(b.id, handle); };
  row.appendChild(handle);
  row.appendChild(renderBlockBody(b));
  return row;
}

function renderBlocks(): void {
  const host = $('blocks');
  host.innerHTML = '';
  doc.blocks.forEach((b) => host.appendChild(makeRow(b)));
  refreshStats();
}

/**
 * Replace ONE block's DOM in place.
 *
 * Rebuilding the whole document on every keystroke-triggered change destroys
 * the caret, and the async refocus that papers over it loses characters typed
 * in the gap — which a fast typist hits constantly. Surgical updates plus
 * synchronous focus is the only version that survives real typing speed.
 */
function rerenderBlock(id: string): HTMLElement | null {
  const row = document.querySelector<HTMLElement>(`.blockrow[data-id="${id}"]`);
  const b = doc.blocks.find((x) => x.id === id);
  if (!row || !b) return null;
  const fresh = makeRow(b);
  row.replaceWith(fresh);
  refreshStats();
  return fresh;
}

function insertRowAfter(afterId: string, block: Block): void {
  const row = document.querySelector<HTMLElement>(`.blockrow[data-id="${afterId}"]`);
  const fresh = makeRow(block);
  if (row) row.after(fresh);
  else $('blocks').appendChild(fresh);
  refreshStats();
}

function removeRow(id: string): void {
  document.querySelector(`.blockrow[data-id="${id}"]`)?.remove();
  refreshStats();
}

function renderBlockBody(b: Block): HTMLElement {
  if (b.type === 'hr') {
    const d = document.createElement('div');
    d.className = 'blk hr';
    d.innerHTML = '<hr>';
    return d;
  }

  if (b.type === 'img') {
    const wrap = document.createElement('div');
    wrap.className = 'blk media';
    wrap.innerHTML = b.src
      ? `<img src="${b.src}" alt=""><input class="cap" placeholder="Caption (optional)" value="${b.caption ?? ''}">`
      : `<input class="url" placeholder="Paste an image URL and press Enter">`;
    const url = wrap.querySelector<HTMLInputElement>('.url');
    if (url) {
      url.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (b as ImageBlock).src = url.value.trim();
          renderBlocks(); refreshAll();
        }
      };
    }
    const cap = wrap.querySelector<HTMLInputElement>('.cap');
    if (cap) cap.oninput = () => { (b as ImageBlock).caption = cap.value; refreshAll(); };
    return wrap;
  }

  if (b.type === 'embed') {
    const wrap = document.createElement('div');
    wrap.className = 'blk media';
    wrap.innerHTML = b.url
      ? `<div class="embedcard"><span class="dim">Embedded X post</span><code>${b.url}</code></div>`
      : `<input class="url" placeholder="Paste an X post URL and press Enter">`;
    const url = wrap.querySelector<HTMLInputElement>('.url');
    if (url) {
      url.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (b as EmbedBlock).url = url.value.trim();
          renderBlocks(); refreshAll();
        }
      };
    }
    return wrap;
  }

  if (isTable(b)) return renderTableBody(b);
  if (isArt(b)) return renderArtBody(b);

  if (isListBlock(b)) {
    const list = document.createElement(b.type === 'ul' ? 'ul' : 'ol');
    list.className = 'blk list';
    b.items.forEach((item, idx) => {
      const li = document.createElement('li');
      li.contentEditable = 'true';
      li.innerHTML = inlineToDom(item);
      li.dataset.idx = String(idx);
      wireEditable(li, b, idx);
      list.appendChild(li);
    });
    return list;
  }

  const tag = b.type === 'h1' ? 'h1' : b.type === 'h2' ? 'h2' : b.type === 'h3' ? 'h3'
            : b.type === 'quote' ? 'blockquote' : b.type === 'code' ? 'pre' : 'p';
  const el = document.createElement(tag);
  el.className = `blk ${b.type}`;
  el.contentEditable = 'true';
  el.dataset.placeholder = PLACEHOLDER[b.type] ?? '';
  el.innerHTML = inlineToDom((b as TextBlock).content);
  wireEditable(el, b);
  return el;
}

function wireEditable(el: HTMLElement, b: Block, itemIdx?: number): void {
  el.addEventListener('focus', () => { activeBlockId = b.id; });

  el.addEventListener('input', () => {
    const runs = parseInline(el);

    // Markdown shortcut. Only fires on a plain paragraph whose entire content
    // is still just the trigger — so "1. " at the start converts, but typing
    // "- " mid-sentence never does.
    // contenteditable silently rewrites a trailing space to U+00A0, which makes
    // every "^## " style regex fail. Normalise before matching.
    const plain = (el.textContent ?? '').replace(/ /g, ' ');
    if (itemIdx === undefined && isTextBlock(b) && b.type === 'p') {
      const sc = shortcutFor(plain);
      if (sc && plain.length === sc.strip) {
        const idx = doc.blocks.findIndex((x) => x.id === b.id);
        doc.blocks[idx] = convertBlock({ ...(b as TextBlock), content: [] } as Block, sc.type);
        const fresh = rerenderBlock(b.id);
        // Synchronous focus — anything async here drops the next keystrokes.
        // For a list the editable node is the <li>, NOT the <ul class="blk">
        // wrapping it, so look for the item first.
        const target =
          fresh?.querySelector<HTMLElement>('li') ??
          fresh?.querySelector<HTMLElement>('.blk');
        if (target?.isContentEditable) { target.focus(); placeCaretAtEnd(target); }
        refreshAll();
        return;
      }
    }

    if (itemIdx !== undefined && isListBlock(b)) b.items[itemIdx] = runs;
    else if (isTextBlock(b)) b.content = runs;

    refreshAll();
  });

  el.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;

    if (ke.key === 'Enter' && !ke.shiftKey) {
      ke.preventDefault();

      if (itemIdx !== undefined && isListBlock(b)) {
        // Enter on an empty list item exits the list, the way every editor does.
        if ((el.textContent ?? '') === '' && b.items.length > 1) {
          b.items.splice(itemIdx, 1);
          const idx = doc.blocks.findIndex((x) => x.id === b.id);
          const para = newParagraph();
          doc.blocks.splice(idx + 1, 0, para);
          rerenderBlock(b.id);
          insertRowAfter(b.id, para);
          focusRow(para.id);
          refreshAll();
          return;
        }
        b.items.splice(itemIdx + 1, 0, []);
        rerenderBlock(b.id);
        focusRow(b.id, itemIdx + 1);
        refreshAll();
        return;
      }

      const idx = doc.blocks.findIndex((x) => x.id === b.id);
      const para = newParagraph();
      doc.blocks.splice(idx + 1, 0, para);
      insertRowAfter(b.id, para);
      focusRow(para.id);
      refreshAll();
      return;
    }

    if (ke.key === 'Backspace' && (el.textContent ?? '') === '') {
      const idx = doc.blocks.findIndex((x) => x.id === b.id);

      if (itemIdx !== undefined && isListBlock(b)) {
        ke.preventDefault();
        if (b.items.length > 1) {
          b.items.splice(itemIdx, 1);
          rerenderBlock(b.id);
          focusRow(b.id, Math.max(0, itemIdx - 1));
        } else {
          doc.blocks[idx] = convertBlock(b, 'p');
          rerenderBlock(b.id);
          focusRow(b.id);
        }
        refreshAll();
        return;
      }

      // Backspace in an empty non-paragraph first demotes to a paragraph,
      // so one keystroke undoes an accidental shortcut instead of deleting.
      if (isTextBlock(b) && b.type !== 'p') {
        ke.preventDefault();
        doc.blocks[idx] = convertBlock(b, 'p');
        rerenderBlock(b.id);
        focusRow(b.id);
        refreshAll();
        return;
      }

      if (doc.blocks.length > 1) {
        ke.preventDefault();
        const prevId = doc.blocks[Math.max(0, idx - 1)]!.id;
        doc.blocks.splice(idx, 1);
        removeRow(b.id);
        focusRow(prevId, undefined, true);
        refreshAll();
      }
      return;
    }

    // Inline formatting
    const mod = ke.metaKey || ke.ctrlKey;
    if (mod && ['b', 'i', 'u'].includes(ke.key.toLowerCase())) {
      ke.preventDefault();
      const cmd = ke.key.toLowerCase() === 'b' ? 'bold' : ke.key.toLowerCase() === 'i' ? 'italic' : 'strikeThrough';
      document.execCommand(cmd);
      el.dispatchEvent(new Event('input'));
      return;
    }
    if (mod && ke.key.toLowerCase() === 'k') {
      ke.preventDefault();
      const url = prompt('Link URL');
      if (url) { document.execCommand('createLink', false, url); el.dispatchEvent(new Event('input')); }
      return;
    }
  });

  // Strip formatting on paste — pasted markup is the fastest way to poison a
  // clean model, and users almost never want the source styling anyway.
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  });
}

/**
 * Focus a block synchronously.
 *
 * Synchronous is not a style preference: the browser delivers subsequent
 * keystrokes to whatever has focus *now*, so deferring by even one frame drops
 * characters when someone types quickly.
 */
function focusRow(id: string, itemIdx?: number, atEnd = true): void {
  const sel = itemIdx === undefined
    ? `.blockrow[data-id="${id}"] .blk`
    : `.blockrow[data-id="${id}"] li[data-idx="${itemIdx}"]`;
  const el = document.querySelector<HTMLElement>(sel);
  if (!el || !el.isContentEditable) return;
  el.focus();
  if (atEnd) placeCaretAtEnd(el);
}

/** Deferred variant, for use after a full re-render. */
function focusBlock(id: string, atEnd = false): void {
  requestAnimationFrame(() => focusRow(id, undefined, atEnd));
}

function placeCaretAtEnd(el: HTMLElement): void {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}

/* ══════════════════════════════════════════════════════════════════════
   Table and diagram blocks — the image escape hatch
   ══════════════════════════════════════════════════════════════════════ */

function renderTableBody(b: TableBlock): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'blk tablewrap';

  const tbl = document.createElement('table');
  tbl.className = 'edtable';
  b.rows.forEach((row, r) => {
    const tr = document.createElement('tr');
    if (b.header && r === 0) tr.className = 'head';
    row.forEach((cell, c) => {
      const td = document.createElement(b.header && r === 0 ? 'th' : 'td');
      td.contentEditable = 'true';
      td.innerHTML = inlineToDom(cell);
      td.addEventListener('input', () => { b.rows[r]![c] = parseInline(td); refreshAll(); });
      td.addEventListener('keydown', (e) => {
        // Tab walks the grid, which is the only navigation that makes a table
        // feel like a table rather than a pile of boxes.
        if ((e as KeyboardEvent).key === 'Tab') {
          e.preventDefault();
          const cells = [...wrap.querySelectorAll<HTMLElement>('th,td')];
          const i = cells.indexOf(td);
          const next = cells[i + ((e as KeyboardEvent).shiftKey ? -1 : 1)];
          if (next) { next.focus(); placeCaretAtEnd(next); }
        }
      });
      tr.appendChild(td);
    });
    tbl.appendChild(tr);
  });
  wrap.appendChild(tbl);

  const bar = document.createElement('div');
  bar.className = 'tablebar';
  const btn = (label: string, fn: () => void) => {
    const x = document.createElement('button');
    x.className = 'mini';
    x.textContent = label;
    x.onclick = (e) => { e.preventDefault(); fn(); rerenderBlock(b.id); refreshAll(); };
    bar.appendChild(x);
  };
  btn('+ row', () => b.rows.push(b.rows[0]!.map(() => [])));
  btn('+ column', () => b.rows.forEach((r) => r.push([])));
  btn('− row', () => { if (b.rows.length > 1) b.rows.pop(); });
  btn('− column', () => { if ((b.rows[0]?.length ?? 0) > 1) b.rows.forEach((r) => r.pop()); });
  btn(b.header ? 'no header' : 'header', () => { b.header = !b.header; });
  wrap.appendChild(bar);

  const cap = document.createElement('input');
  cap.className = 'cap';
  cap.placeholder = 'Caption (optional)';
  cap.value = b.caption ?? '';
  cap.oninput = () => { b.caption = cap.value; refreshAll(); };
  wrap.appendChild(cap);

  return wrap;
}

function renderArtBody(b: ArtBlock): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'blk artwrap';

  const ta = document.createElement('textarea');
  ta.className = 'artinput';
  ta.spellcheck = false;
  ta.value = b.text;
  ta.placeholder =
    'Paste or draw character art — box drawings, arrows, a cat.\n' +
    'Monospace here, and an image on X, because X renders proportional and would shear every row.';
  ta.rows = Math.max(4, b.text.split('\n').length + 1);
  ta.addEventListener('input', () => {
    b.text = ta.value;
    ta.rows = Math.max(4, ta.value.split('\n').length + 1);
    refreshAll();
  });
  // Tab inserts spaces; losing focus mid-drawing is maddening.
  ta.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart;
      ta.value = ta.value.slice(0, start) + '    ' + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = start + 4;
      ta.dispatchEvent(new Event('input'));
    }
  });
  wrap.appendChild(ta);

  const cap = document.createElement('input');
  cap.className = 'cap';
  cap.placeholder = 'Caption (optional)';
  cap.value = b.caption ?? '';
  cap.oninput = () => { b.caption = cap.value; refreshAll(); };
  wrap.appendChild(cap);

  return wrap;
}

/** PNGs for blocks X cannot express. Regenerated on demand, not cached across
 *  edits — a stale table image is worse than a slow one. */
function renderImagesForX(): RenderedMap {
  const out: RenderedMap = {};
  for (const b of doc.blocks) {
    try {
      if (isTable(b)) {
        const img = renderTablePng(b, DARK);
        out[b.id] = { dataUrl: img.dataUrl, alt: img.alt };
      } else if (isArt(b) && b.text.trim()) {
        const img = renderArtPng(b, DARK);
        out[b.id] = { dataUrl: img.dataUrl, alt: img.alt };
      }
    } catch { /* a single bad block must not break the export */ }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════
   Block type menu
   ══════════════════════════════════════════════════════════════════════ */

const MENU: [Block['type'], string, string][] = [
  ['h1', 'Heading 1', 'H1'], ['h2', 'Heading 2', 'H2'], ['h3', 'Heading 3', 'H3'],
  ['p', 'Text', '¶'], ['ul', 'Bulleted list', '•'], ['ol', 'Numbered list', '1.'],
  ['quote', 'Quote', '❝'], ['code', 'Code', '{}'], ['img', 'Image', '▣'],
  ['table', 'Table', '▦'], ['art', 'Diagram', '◈'],
  ['embed', 'X post', '↗'], ['hr', 'Divider', '—'],
];

function openBlockMenu(blockId: string, anchor: HTMLElement): void {
  closeBlockMenu();
  const idx = doc.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return;

  const menu = document.createElement('div');
  menu.className = 'blockmenu';
  menu.id = 'blockmenu';

  MENU.forEach(([type, label, icon]) => {
    const item = document.createElement('button');
    item.innerHTML = `<span class="ic">${icon}</span>${label}`;
    item.onclick = () => {
      doc.blocks[idx] = convertBlock(doc.blocks[idx]!, type);
      closeBlockMenu(); renderBlocks(); focusBlock(blockId, true); refreshAll();
    };
    menu.appendChild(item);
  });

  const sep = document.createElement('div');
  sep.className = 'sep';
  menu.appendChild(sep);

  const del = document.createElement('button');
  del.className = 'danger';
  del.innerHTML = '<span class="ic">✕</span>Delete block';
  del.onclick = () => {
    if (doc.blocks.length > 1) doc.blocks.splice(idx, 1);
    else doc.blocks[0] = newParagraph();
    closeBlockMenu(); renderBlocks(); refreshAll();
  };
  menu.appendChild(del);

  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + window.scrollY + 6}px`;
  menu.style.left = `${r.left + window.scrollX}px`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
}

function onDocClick(e: MouseEvent): void {
  if (!(e.target as HTMLElement).closest('#blockmenu')) closeBlockMenu();
}
function closeBlockMenu(): void {
  document.getElementById('blockmenu')?.remove();
  document.removeEventListener('click', onDocClick);
}

/* ══════════════════════════════════════════════════════════════════════
   Live outputs
   ══════════════════════════════════════════════════════════════════════ */

function refreshStats(): void {
  $('stat-words').textContent = String(wordCount(doc));
  $('stat-mins').textContent = `${readingMinutes(doc)} min`;
  $('stat-blocks').textContent = String(doc.blocks.length);
}

function canonicalUrl(): string {
  return `https://${DOMAIN}/@${session?.binding.handle ?? 'you'}/${slugify(doc.title)}`;
}

function refreshCard(): void {
  const dataUrl = cardToDataUrl({
    title: doc.title || 'Untitled',
    subtitle: doc.subtitle,
    authorName: session?.displayName ?? 'You',
    handle: session?.binding.handle,
    readingMinutes: readingMinutes(doc),
    npubShort: session ? `${session.npub.slice(0, 12)}…${session.npub.slice(-6)}` : undefined,
    domain: DOMAIN,
  });
  ($('card-img') as HTMLImageElement).src = dataUrl;
  $('card-title').textContent = doc.title || 'Untitled';
  $('card-desc').textContent = docSummary(doc, 110) || 'Published with XOnly.';
  $('card-domain').textContent = DOMAIN;
  return;
}

function refreshXExport(): void {
  const rendered = renderImagesForX();
  const x = buildXExport(doc, rendered);
  lastXExport = x;

  const warn = $('x-warnings');
  warn.innerHTML = x.warnings.map((w) => `<li>${w}</li>`).join('');

  const list = $('x-images');
  if (!x.images.length) {
    list.innerHTML = '<p class="hint" style="margin:0">No images in this document.</p>';
  } else {
    list.innerHTML = '';
    x.images.forEach((img) => {
      const row = document.createElement('div');
      row.className = 'ximg';
      const marker = img.index === 0 ? 'COVER' : `#${img.index}`;
      row.innerHTML =
        `<div class="thumb">${img.src ? `<img src="${img.src}" alt="">` : '<span class="dim">—</span>'}</div>` +
        `<div class="meta"><div class="lbl"><span class="mk">${marker}</span> ${img.label}</div>` +
        `<div class="kind dim">${img.kind}</div></div>`;
      const dl = document.createElement('button');
      dl.className = 'mini';
      dl.textContent = img.src.startsWith('data:') ? 'download' : 'open';
      dl.onclick = () => {
        if (img.src.startsWith('data:')) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(dataUrlToBlob(img.src));
          a.download = `${slugify(doc.title)}-${img.kind}-${img.index}.png`;
          a.click();
        } else {
          window.open(img.src, '_blank');
        }
      };
      row.appendChild(dl);
      list.appendChild(row);
    });
  }

  $('x-body-preview').textContent = x.bodyHtml || '(empty)';
}

function refreshOutputs(): void {
  $('out-md').textContent = docToMarkdown(doc) || '(empty)';

  const ev = docToNip23(doc, { canonicalUrl: canonicalUrl() });
  $('out-nostr').textContent = JSON.stringify(ev, null, 2);

  $('out-draftjs').textContent = JSON.stringify(buildDraftPayload(doc), null, 2);

  $('out-meta').textContent = cardMeta(doc, {
    canonicalUrl: canonicalUrl(),
    authorName: session?.displayName ?? 'You',
    authorHandle: session?.binding.handle,
    npub: session?.npub ?? 'npub1…',
    ogImageUrl: `https://${DOMAIN}/og/${slugify(doc.title)}.png`,
    nostrCoordinate: session ? articleCoordinate(session.pubkeyHex, slugify(doc.title)) : undefined,
  });
}

let refreshTimer: number | undefined;
function refreshAll(): void {
  refreshStats();
  window.clearTimeout(refreshTimer);
  // Card rendering and JSON serialization are cheap but not free; debounce so
  // typing stays at 60fps on a slow machine.
  refreshTimer = window.setTimeout(() => { refreshCard(); refreshOutputs(); refreshXExport(); }, 140);
}

/* ══════════════════════════════════════════════════════════════════════
   Publish
   ══════════════════════════════════════════════════════════════════════ */

function setTarget(id: string, state: 'idle' | 'busy' | 'ok' | 'fail' | 'skip', detail: string): void {
  const row = $(`t-${id}`);
  row.className = `target ${state}`;
  $(`t-${id}-detail`).innerHTML = detail;
}

async function publishAll(): Promise<void> {
  if (!session) { await connect(); if (!session) return; }
  if (!doc.title.trim()) { flash('Give it a title first.'); return; }

  const btn = $('publish') as HTMLButtonElement;
  btn.disabled = true;
  $('publish-panel').classList.remove('hidden');

  const identifier = slugify(doc.title);
  const url = canonicalUrl();

  /* --- 1. Nostr (kind 30023) --------------------------------------- */
  setTarget('nostr', 'busy', 'Requesting signature…');
  let signed: SignedEvent | null = null;
  try {
    signed = await sdk.signEvent(docToNip23(doc, { identifier, canonicalUrl: url }));
  } catch (e) {
    setTarget('nostr', 'fail',
      e instanceof UserDeclinedError
        ? 'You declined the signature. Nothing was published.'
        : `Signing failed: ${(e as Error).message}`);
    btn.disabled = false;
    return;
  }

  setTarget('nostr', 'busy', `Signed <code>${signed.id.slice(0, 16)}…</code> — sending to relays…`);
  const receipt = await sdk.publish(signed, RELAYS);
  lastPublished.event = signed;
  lastPublished.coordinate = articleCoordinate(signed.pubkey, identifier);

  if (receipt.success) {
    const list = receipt.accepted.map((r) => `<code>${r}</code>`).join(', ');
    setTarget('nostr', 'ok',
      `Accepted by ${receipt.accepted.length} relays (${list}). ` +
      `Any Nostr client can now resolve <code>${lastPublished.coordinate}</code>.`);
  } else {
    setTarget('nostr', 'fail',
      `Only ${receipt.accepted.length} relay accepted — the ≥2 rule means this does not count as published. ` +
      receipt.failed.map((f) => `${f.relay}: ${f.reason}`).join(' · '));
  }

  /* --- 2. Node page ------------------------------------------------- */
  setTarget('node', 'busy', 'Rendering…');
  const html = docToNodePage(doc, {
    canonicalUrl: url,
    authorName: session.displayName,
    authorHandle: session.binding.handle,
    npub: session.npub,
    ogImageUrl: `https://${DOMAIN}/og/${identifier}.png`,
    nostrCoordinate: lastPublished.coordinate,
    publishedAt: signed.created_at,
  });
  lastPublished.nodeHtml = html;
  $('open-node').classList.remove('hidden');
  setTarget('node', 'ok',
    `Rendered ${(html.length / 1024).toFixed(1)} KB with card metadata at <code>${url}</code>. ` +
    `In production the node writes this file and serves the card image.`);

  /* --- 3. X Article -------------------------------------------------- */
  const token = ($('x-token') as HTMLInputElement).value.trim() || null;
  setTarget('x', 'busy', 'Creating draft…');
  const res = await publishXArticle(doc, token);

  if (res.ok) {
    setTarget('x', 'ok', `Published as a native X Article: <a href="${res.url}" target="_blank" rel="noopener">${res.url}</a>`);
  } else if (!token) {
    setTarget('x', 'skip',
      `No X access token yet — nothing was sent. The exact request is built and shown below, ` +
      `so the moment your developer access clears this path works unchanged. ` +
      `Needs scopes <code>${X_API.scopes.join('</code> <code>')}</code>.`);
  } else {
    setTarget('x', 'fail', escapeText(res.error ?? 'unknown error'));
  }

  $('req-preview').textContent = JSON.stringify(res.request, null, 2);
  btn.disabled = false;
}

function escapeText(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function flash(msg: string): void {
  const el = $('flash');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

/* ══════════════════════════════════════════════════════════════════════
   Session
   ══════════════════════════════════════════════════════════════════════ */

async function connect(): Promise<void> {
  const btn = $('connect') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    session = await sdk.connect({ preferred: 1 });
    $('who').classList.remove('hidden');
    $('who-name').textContent = session.displayName;
    $('who-npub').textContent = `${session.npub.slice(0, 16)}…${session.npub.slice(-8)}`;
    btn.classList.add('hidden');
    ($('handle') as HTMLInputElement).value = session.binding.handle ?? '';
    renderBadge();
    refreshAll();
  } catch (e) {
    flash(`Could not connect: ${(e as Error).message}`);
    btn.disabled = false;
    btn.textContent = 'Connect identity';
  }
}

function renderBadge(): void {
  if (!session) return;
  const el = $('badge');
  const s = session.binding.state;
  el.className = `badge ${s}`;
  el.textContent = s;
  $('badge-note').textContent =
    s === 'verified' ? 'X handle confirmed live this session.'
    : s === 'claimed' ? 'Handle claimed but not yet confirmed against X. Shown as claimed, never as verified.'
    : 'No X handle linked.';
}

/* ══════════════════════════════════════════════════════════════════════
   Boot
   ══════════════════════════════════════════════════════════════════════ */

function boot(): void {
  sdk = createLocalSigner({
    relays: RELAYS,
    approve: requestApproval,
    displayName: 'You',
    handle: localStorage.getItem('berm_dev_handle') ?? undefined,
  });
  (window as any).berm = sdk;

  const title = $('title') as HTMLTextAreaElement;
  const subtitle = $('subtitle') as HTMLTextAreaElement;

  const autoGrow = (t: HTMLTextAreaElement) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; };

  title.addEventListener('input', () => { doc.title = title.value; autoGrow(title); refreshAll(); });
  subtitle.addEventListener('input', () => { doc.subtitle = subtitle.value; autoGrow(subtitle); refreshAll(); });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); subtitle.focus(); }
  });
  subtitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); focusBlock(doc.blocks[0]!.id); }
  });

  ($('cover') as HTMLInputElement).addEventListener('input', (e) => {
    doc.cover = (e.target as HTMLInputElement).value.trim();
    refreshAll();
  });

  ($('handle') as HTMLInputElement).addEventListener('input', (e) => {
    const h = (e.target as HTMLInputElement).value.trim().replace(/^@/, '');
    localStorage.setItem('berm_dev_handle', h);
    if (session) {
      session.binding = h ? { state: 'claimed', handle: h } : { state: 'unlinked' };
      renderBadge();
    }
    refreshAll();
  });

  $('connect').addEventListener('click', connect);
  $('publish').addEventListener('click', publishAll);

  $('open-node').addEventListener('click', () => {
    if (!lastPublished.nodeHtml) return;
    const blob = new Blob([lastPublished.nodeHtml], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  });

  $('download-card').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = ($('card-img') as HTMLImageElement).src;
    a.download = `${slugify(doc.title)}-card.png`;
    a.click();
  });

  document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
      document.querySelectorAll('.pane').forEach((p) => p.classList.remove('on'));
      tab.classList.add('on');
      $(`pane-${tab.dataset.pane}`).classList.add('on');
    });
  });

  $('sample').addEventListener('click', loadSample);

  const tsel = $('template-select') as HTMLSelectElement;
  TEMPLATES.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = t.name;
    tsel.appendChild(o);
  });
  tsel.addEventListener('change', () => {
    const t = templateById(tsel.value);
    if (!t) return;
    if (wordCount(doc) > 12 && !confirm('Replace the current document with this template?')) {
      tsel.value = ''; return;
    }
    doc = t.build();
    syncHeaderFields();
    renderBlocks();
    refreshAll();
    tsel.value = '';
  });

  $('copy-x-title').addEventListener('click', async () => {
    if (!lastXExport) return;
    await copyTitle(lastXExport);
    flash('Title copied — paste it into X’s title field');
  });
  $('copy-x-body').addEventListener('click', async () => {
    if (!lastXExport) return;
    try {
      await copyBody(lastXExport);
      flash('Body copied as rich text — paste into the X Article body');
    } catch {
      flash('Clipboard blocked — check browser permissions');
    }
  });

  renderBlocks();
  refreshAll();
}

function syncHeaderFields(): void {
  const t = $('title') as HTMLTextAreaElement;
  const st = $('subtitle') as HTMLTextAreaElement;
  const cv = $('cover') as HTMLInputElement;
  t.value = doc.title; st.value = doc.subtitle; cv.value = doc.cover;
  [t, st].forEach((x) => { x.style.height = 'auto'; x.style.height = `${x.scrollHeight}px`; });
}

function loadSample(): void {
  doc = {
    title: 'Your identity should outlive the platform',
    subtitle: 'A short argument for writing things you actually own — and a demonstration that it already works.',
    cover: '',
    blocks: [
      { id: bid(), type: 'p', content: [
        { text: 'Every platform you have ever written on made you the same offer: ' },
        { text: 'we host it, you make it', marks: ['i'] },
        { text: '. The deal was fine until the day it was not.' },
      ]},
      { id: bid(), type: 'h2', content: [{ text: 'The part nobody reads' }] },
      { id: bid(), type: 'p', content: [
        { text: 'When a service shuts down, your writing does not move somewhere else. It stops existing. ' },
        { text: 'That is not a policy failure — it is an architecture', marks: ['b'] },
        { text: ', and architecture is fixable.' },
      ]},
      { id: bid(), type: 'quote', content: [{ text: 'A page you cannot move is a page you are renting.' }] },
      { id: bid(), type: 'h2', content: [{ text: 'What changes here' }] },
      { id: bid(), type: 'ul', items: [
        [{ text: 'You sign in with X. No account, no password, no seed phrase.' }],
        [{ text: 'This article is signed by you and stored on an open network.' }],
        [{ text: 'It renders on this page, in other readers, and natively on X.' }],
        [{ text: 'Delete any one of those and the other two still work.' }],
      ]},
      { id: bid(), type: 'p', content: [
        { text: 'Nothing here asks you to trust the people who built it. ' },
        { text: 'Check it yourself', href: 'https://xonly.ai' },
        { text: ' — that is the point.' },
      ]},
    ],
  };

  syncHeaderFields();
  renderBlocks();
  refreshAll();
}

document.addEventListener('DOMContentLoaded', boot);
