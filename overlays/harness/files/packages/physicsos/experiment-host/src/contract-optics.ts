/** Host-owned optics; archive inputs never supply an evaluator. */
import { thinLensOutcome } from '@physicsos/engine-optics'
import { evaluateCaseWithOptics, type CaseInput, type CaseExpected } from './contract-v2.ts'
/** Evaluate a reference case with the platform engine.
 * @param input Case distances and object height in centimetres.
 * @returns Signed image facts in centimetres.
 */
export const evaluateCase = (input: CaseInput): CaseExpected =>
  evaluateCaseWithOptics(input, thinLensOutcome)
