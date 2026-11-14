import { type AddressLookup } from './safety.ts';
import { type PageReader } from './types.ts';
export interface SafeReaderOptions {
    /** Injected in tests; the default resolves every address and rejects any private answer. */
    readonly lookup?: AddressLookup;
    /**
     * Address admission. Defaults to rejecting loopback/private/link-local
     * addresses. Only tests pass a different policy (to reach a local HTTP
     * fixture); production construction must leave this unset.
     */
    readonly addressPolicy?: (address: string) => boolean;
    readonly maxBytes?: number;
    readonly timeoutMs?: number;
    readonly maxRedirects?: number;
    readonly userAgent?: string;
}
/** Extract visible text from HTML without executing anything. */
export declare function htmlToText(html: string): {
    title: string;
    text: string;
};
export interface SafeReader extends PageReader {
    /** Exposed for tests and callers that need to resolve a redirect hop manually. */
    readonly resolve: AddressLookup;
}
/**
 * The only component allowed to fetch arbitrary public pages.
 *
 * Every hop (initial URL and each redirect) is parsed, screened, resolved and
 * connected to a checked address. No cookies, no scripts, no credential
 * headers, no POST bodies. The extracted text is untrusted data for the model.
 */
export declare function createSafeReader(options?: SafeReaderOptions): SafeReader;
//# sourceMappingURL=reader.d.ts.map