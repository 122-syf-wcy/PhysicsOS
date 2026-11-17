/** Narrow typed surface used by the static courseware importer; no runtime parser implementation. */
declare module 'css-tree' {
  export interface CssNode { readonly type: string; readonly name?: string; readonly value?: string; readonly property?: string }
  export interface ParseOptions { readonly context?: 'stylesheet' | 'declarationList'; readonly parseCustomProperty?: boolean; readonly positions?: boolean; readonly onParseError?: (error: Error) => void }
  export function parse(source: string, options?: ParseOptions): CssNode
  export function walk(node: CssNode, visitor: (node: CssNode) => void): void
}
