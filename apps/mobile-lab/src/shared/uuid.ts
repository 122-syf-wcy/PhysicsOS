/** Browser Web Crypto replacement for the host-only UUID utility. No physics or data semantics are changed. */
export const randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => crypto.randomUUID()
