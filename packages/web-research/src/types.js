/**
 * Public web research contract.
 *
 * The tool level (`physics_search_web`) stays a thin model-facing surface; the
 * retrieval logic lives here and owns no harness types. Every failure has a
 * stable code so the UI and the model can tell "no results" from "the network
 * is down" instead of receiving one generic sentence.
 */
export class ResearchError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ResearchError';
    }
}
//# sourceMappingURL=types.js.map