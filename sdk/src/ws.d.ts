/** `ws` ships no types and we only need the constructor shape. Adding
 *  @types/ws would pull the whole Node http surface into a browser package. */
declare module 'ws';
