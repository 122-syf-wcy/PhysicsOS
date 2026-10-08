declare module 'semver' {
  export function satisfies(version: string, range: string): boolean
  export function validRange(range: string): string | null
}
