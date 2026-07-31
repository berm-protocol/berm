/** Types for the plain-JS renderer. It stays JS because the node ships it as-is,
 *  and a build step between the server and its own renderer is a place for the
 *  two to drift apart. */
export declare function renderArticle(
  article: { address: string; title: string; html: string; author: string },
  reactions: { address: string; events: unknown[]; fetched_at: number },
): string;
export declare function renderHash(article: unknown, reactions: unknown): string;
