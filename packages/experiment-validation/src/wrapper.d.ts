export interface ValidationWrapper {
    readonly bytes: Buffer;
    readonly csp: string;
}
/** Build the wrapper for `raw` (absolute same-origin URL of the candidate's entry). */
export declare function validationWrapper(raw: URL): ValidationWrapper;
//# sourceMappingURL=wrapper.d.ts.map