/** True for addresses the reader must never connect to. Malformed input is treated as private. */
export declare function isBlockedAddress(address: string): boolean;
/** Parse and screen a URL before DNS. Throws a stable, model-safe error. */
export declare function assertPublicUrl(value: string | URL): URL;
export type AddressLookup = (hostname: string) => Promise<readonly string[]>;
/** Default resolver: every address must be public. A failure to resolve is a normal unavailable error. */
export declare const resolvePublicAddresses: AddressLookup;
//# sourceMappingURL=safety.d.ts.map