/**
 * Target 2 — a native X Article.
 *
 * X exposes Articles endpoints that create a draft and then publish it:
 *   POST /2/articles/draft
 *   POST /2/articles/{article_id}/publish
 * OAuth 2.0 PKCE, scopes: tweet.read, tweet.write, users.read.
 * Content is DraftJS ContentState — blocks plus an entity map.
 *
 * COMPLIANCE NOTE. This is the one place XOnly writes to X, and the boundary
 * matters: publishing here is ALWAYS initiated by a human pressing Publish in
 * an editor they are looking at, with their own OAuth consent. That is what the
 * endpoint is for. What remains prohibited is unattended, bulk, or scheduled
 * posting with no human in the loop, and anything resembling paid engagement.
 * The distinction is human-in-the-loop, not "never touch the write endpoint".
 */

import type { Doc, Inline, Block, Mark } from '../model.js';

/* ------------------------------------------------------------------ */
/* DraftJS ContentState                                                */
/* ------------------------------------------------------------------ */

export interface DraftInlineStyleRange {
  offset: number;
  length: number;
  style: 'BOLD' | 'ITALIC' | 'STRIKETHROUGH' | 'CODE';
}

export interface DraftEntityRange {
  offset: number;
  length: number;
  key: number;
}

export interface DraftBlock {
  key: string;
  text: string;
  type: string;
  depth: number;
  inlineStyleRanges: DraftInlineStyleRange[];
  entityRanges: DraftEntityRange[];
  data: Record<string, unknown>;
}

export interface DraftEntity {
  type: 'LINK' | 'IMAGE' | 'EMBED';
  mutability: 'MUTABLE' | 'IMMUTABLE' | 'SEGMENTED';
  data: Record<string, unknown>;
}

export interface DraftContentState {
  blocks: DraftBlock[];
  entityMap: Record<string, DraftEntity>;
}

const STYLE_FOR: Record<Mark, DraftInlineStyleRange['style']> = {
  b: 'BOLD',
  i: 'ITALIC',
  s: 'STRIKETHROUGH',
  code: 'CODE',
};

const DRAFT_TYPE: Record<string, string> = {
  h1: 'header-one',
  h2: 'header-two',
  h3: 'header-three',
  p: 'unstyled',
  quote: 'blockquote',
  code: 'code-block',
};

let keySeq = 0;
/** DraftJS block keys are arbitrary but must be unique within the document. */
function draftKey(): string {
  keySeq += 1;
  return keySeq.toString(36).padStart(5, 'a');
}

/** Reset between documents so output is deterministic and diffable in tests. */
export function resetKeys(): void {
  keySeq = 0;
}

/**
 * Flatten inline runs into DraftJS's (text, ranges) representation.
 * DraftJS stores plain text plus offset/length ranges, so overlapping marks
 * become separate ranges over the same span rather than nested nodes.
 */
function flattenInline(
  items: Inline[],
  entityMap: Record<string, DraftEntity>,
  nextEntityKey: { n: number },
): { text: string; styles: DraftInlineStyleRange[]; entities: DraftEntityRange[] } {
  let text = '';
  const styles: DraftInlineStyleRange[] = [];
  const entities: DraftEntityRange[] = [];

  for (const run of items) {
    if (!run.text) continue;
    const offset = text.length;
    const length = run.text.length;
    text += run.text;

    for (const m of run.marks ?? []) {
      styles.push({ offset, length, style: STYLE_FOR[m] });
    }

    if (run.href) {
      const key = nextEntityKey.n++;
      entityMap[String(key)] = {
        type: 'LINK',
        mutability: 'MUTABLE',
        data: { url: run.href },
      };
      entities.push({ offset, length, key });
    }
  }

  return { text, styles, entities };
}

export function docToDraftJs(doc: Doc): DraftContentState {
  resetKeys();
  const blocks: DraftBlock[] = [];
  const entityMap: Record<string, DraftEntity> = {};
  const nextEntityKey = { n: 0 };

  const push = (
    type: string,
    text: string,
    styles: DraftInlineStyleRange[] = [],
    entities: DraftEntityRange[] = [],
    data: Record<string, unknown> = {},
    depth = 0,
  ) => {
    blocks.push({
      key: draftKey(),
      text,
      type,
      depth,
      inlineStyleRanges: styles,
      entityRanges: entities,
      data,
    });
  };

  for (const b of doc.blocks) {
    switch (b.type) {
      case 'h1': case 'h2': case 'h3': case 'p': case 'quote': case 'code': {
        const { text, styles, entities } = flattenInline(b.content, entityMap, nextEntityKey);
        // Skip genuinely empty paragraphs; keep intentional spacing elsewhere.
        if (b.type === 'p' && !text.trim()) break;
        push(DRAFT_TYPE[b.type]!, text, styles, entities);
        break;
      }
      case 'ul': case 'ol': {
        const listType = b.type === 'ul' ? 'unordered-list-item' : 'ordered-list-item';
        for (const item of b.items) {
          const { text, styles, entities } = flattenInline(item, entityMap, nextEntityKey);
          if (!text.trim()) continue;
          push(listType, text, styles, entities);
        }
        break;
      }
      case 'img': {
        const key = nextEntityKey.n++;
        entityMap[String(key)] = {
          type: 'IMAGE',
          mutability: 'IMMUTABLE',
          data: { src: b.src, alt: b.alt ?? '', caption: b.caption ?? '' },
        };
        // DraftJS convention: atomic blocks carry a single placeholder char.
        push('atomic', ' ', [], [{ offset: 0, length: 1, key }]);
        break;
      }
      case 'embed': {
        const key = nextEntityKey.n++;
        entityMap[String(key)] = {
          type: 'EMBED',
          mutability: 'IMMUTABLE',
          data: { url: b.url },
        };
        push('atomic', ' ', [], [{ offset: 0, length: 1, key }]);
        break;
      }
      // X has no table and no monospace. Both leave as atomic image blocks —
      // the caller supplies the rendered PNG, because generating it needs a
      // canvas and this module stays pure.
      case 'table': case 'art': {
        const key = nextEntityKey.n++;
        entityMap[String(key)] = {
          type: 'IMAGE',
          mutability: 'IMMUTABLE',
          data: {
            src: '',
            alt: b.type === 'table' ? 'Table' : (b.caption ?? 'Diagram'),
            caption: b.caption ?? '',
            xonlyRenderedFrom: b.type,
            xonlyBlockId: b.id,
          },
        };
        push('atomic', ' ', [], [{ offset: 0, length: 1, key }]);
        break;
      }

      case 'hr': {
        // DraftJS has no rule primitive; an empty unstyled block is the
        // conventional stand-in and survives round-tripping.
        push('unstyled', '');
        break;
      }
    }
  }

  if (blocks.length === 0) push('unstyled', '');
  return { blocks, entityMap };
}

/* ------------------------------------------------------------------ */
/* API payloads                                                        */
/* ------------------------------------------------------------------ */

export interface XArticleDraftPayload {
  title: string;
  content_state: DraftContentState;
  cover_media_id?: string;
}

export function buildDraftPayload(doc: Doc, coverMediaId?: string): XArticleDraftPayload {
  const payload: XArticleDraftPayload = {
    title: doc.title.trim() || 'Untitled',
    content_state: docToDraftJs(doc),
  };
  if (coverMediaId) payload.cover_media_id = coverMediaId;
  return payload;
}

export const X_API = {
  draft: 'https://api.x.com/2/articles/draft',
  publish: (id: string) => `https://api.x.com/2/articles/${id}/publish`,
  scopes: ['tweet.read', 'tweet.write', 'users.read'] as const,
};

export interface XPublishResult {
  ok: boolean;
  articleId?: string;
  url?: string;
  error?: string;
  /** The exact request that was or would be sent. Always populated, so the
   *  payload is inspectable even when credentials are absent. */
  request: { url: string; method: string; body: unknown };
}

/**
 * Create a draft Article and publish it.
 *
 * The bearer token is a USER access token obtained via OAuth 2.0 PKCE with the
 * scopes above. It is supplied by the node's server side and never persisted in
 * the browser beyond the request.
 */
export async function publishXArticle(
  doc: Doc,
  accessToken: string | null,
  coverMediaId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<XPublishResult> {
  const body = buildDraftPayload(doc, coverMediaId);
  const request = { url: X_API.draft, method: 'POST', body };

  if (!accessToken) {
    return {
      ok: false,
      error: 'No X access token configured. Connect an X account with tweet.write to publish.',
      request,
    };
  }

  try {
    const draftRes = await fetchImpl(X_API.draft, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!draftRes.ok) {
      return { ok: false, error: `draft failed: ${draftRes.status} ${await safeText(draftRes)}`, request };
    }

    const draft = await draftRes.json();
    const articleId: string | undefined = draft?.data?.id ?? draft?.id;
    if (!articleId) return { ok: false, error: 'draft response contained no article id', request };

    const pubRes = await fetchImpl(X_API.publish(articleId), {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    if (!pubRes.ok) {
      return { ok: false, articleId, error: `publish failed: ${pubRes.status} ${await safeText(pubRes)}`, request };
    }

    const published = await pubRes.json();
    return {
      ok: true,
      articleId,
      url: published?.data?.url ?? `https://x.com/i/article/${articleId}`,
      request,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e), request };
  }
}

async function safeText(r: Response): Promise<string> {
  try { return (await r.text()).slice(0, 200); } catch { return ''; }
}
