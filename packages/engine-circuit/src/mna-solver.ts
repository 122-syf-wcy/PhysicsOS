import { PhysicsOSError } from '@physicsos/shared'

import type { CircuitBranch, ResolvedCircuitModel, SourceBranch } from './circuit-model.ts'

/**
 * Modified nodal analysis for the resolved DC model.
 *
 * Unknowns are the non-ground node potentials plus one current per source
 * branch (ideal EMF, closed switch, ideal ammeter). Each connected island of
 * the branch graph gets its own ground so an opened switch never leaves a
 * floating sub-circuit without a reference.
 */

export interface BranchSolution {
  readonly componentId: string
  /** Signed current through the branch, amperes. */
  readonly current: number
  /** Signed potential drop across the branch, volts. */
  readonly voltage: number
}

export interface CircuitSolution {
  /** Node potential per node id, volts (each island referenced to its own 0). */
  readonly potentials: ReadonlyMap<string, number>
  /**
   * Signed branch current per branch component id. Conductance branches:
   * current flowing nodeA→nodeB. Source branches: current flowing
   * nodePositive→nodeNegative INSIDE the branch (a discharging battery is
   * negative here).
   */
  readonly branchCurrents: ReadonlyMap<string, number>
  /** Largest |Σ currents| over all nodes, amperes — the KCL residual. */
  readonly kclResidual: number
  /** Σ E·I over battery branches (delivered power, watts). */
  readonly totalSourcePower: number
  /** Σ I²·R over conductance branches (dissipated power, watts). */
  readonly totalDissipatedPower: number
}

/** Loop limits shared by Gaussian elimination and its computation-free budget. */
const gaussianColumnWorkOf = (size: number, column: number) => ({
  followingRowCount: size - column - 1,
  eliminationEntryCount: size - column + 1,
})

const linearSystemIterationCountBoundOf = (size: number): number => {
  // Forward pivot stages and back-substitution rows each run `size` times.
  let iterations = 2 * size
  for (let column = 0; column < size; column += 1) {
    const { followingRowCount, eliminationEntryCount } = gaussianColumnWorkOf(size, column)
    // Pivot search, elimination rows, and back-substitution entries; zero factors
    // can skip elimination entries, so counting every entry is an upper bound.
    iterations += followingRowCount * (3 + eliminationEntryCount)
  }
  return iterations
}

/** Gaussian elimination with partial pivoting. Throws on a singular system. */
const solveLinearSystem = (matrix: number[][], rhs: number[]): number[] => {
  const n = rhs.length
  const a = matrix.map((row, index) => [...row, rhs[index] ?? 0])

  for (let column = 0; column < n; column += 1) {
    const { followingRowCount, eliminationEntryCount } = gaussianColumnWorkOf(n, column)
    let pivotRow = column
    let pivotValue = Math.abs(a[column]?.[column] ?? 0)
    for (let offset = 0; offset < followingRowCount; offset += 1) {
      const row = column + 1 + offset
      const candidate = Math.abs(a[row]?.[column] ?? 0)
      if (candidate > pivotValue) {
        pivotRow = row
        pivotValue = candidate
      }
    }
    if (!(pivotValue > 1e-30)) {
      throw new PhysicsOSError(
        'CIRCUIT_SOLVER_SINGULAR',
        'The circuit equations are singular; the topology does not determine a unique DC state.',
      )
    }
    if (pivotRow !== column) {
      const swap = a[column]
      a[column] = a[pivotRow] as number[]
      a[pivotRow] = swap as number[]
    }
    const pivot = a[column] as number[]
    for (let offset = 0; offset < followingRowCount; offset += 1) {
      const row = column + 1 + offset
      const target = a[row] as number[]
      const factor = (target[column] ?? 0) / (pivot[column] as number)
      if (factor === 0) continue
      for (let entry = 0; entry < eliminationEntryCount; entry += 1) {
        const k = column + entry
        target[k] = (target[k] ?? 0) - factor * (pivot[k] ?? 0)
      }
    }
  }

  const solution = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row -= 1) {
    const { followingRowCount } = gaussianColumnWorkOf(n, row)
    const current = a[row] as number[]
    let sum = current[n] ?? 0
    for (let offset = 0; offset < followingRowCount; offset += 1) {
      const column = row + 1 + offset
      sum -= (current[column] ?? 0) * (solution[column] ?? 0)
    }
    solution[row] = sum / (current[row] as number)
  }
  return solution
}

/** All node ids a branch touches. */
const branchNodes = (branch: CircuitBranch): readonly [string, string] =>
  branch.kind === 'conductance'
    ? [branch.nodeA, branch.nodeB]
    : [branch.nodePositive, branch.nodeNegative]

/** Partition nodes into connected islands over the stamped branches. */
const islandsOf = (nodeIds: readonly string[], branches: readonly CircuitBranch[]): string[][] => {
  const adjacency = new Map<string, Set<string>>()
  for (const node of nodeIds) adjacency.set(node, new Set())
  for (const branch of branches) {
    const [a, b] = branchNodes(branch)
    adjacency.get(a)?.add(b)
    adjacency.get(b)?.add(a)
  }
  const seen = new Set<string>()
  const islands: string[][] = []
  for (const start of nodeIds) {
    if (seen.has(start)) continue
    const island: string[] = []
    const queue = [start]
    seen.add(start)
    while (queue.length > 0) {
      const node = queue.pop() as string
      island.push(node)
      for (const next of adjacency.get(node) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    islands.push(island)
  }
  return islands
}

const linearSystemLayoutOf = (model: ResolvedCircuitModel) => {
  /* Internal source nodes may not be in nodeIds order yet; branchNodes is the
     source of truth for which nodes exist. */
  const nodeIds = [...model.nodeIds]
  const knownNodes = new Set(nodeIds)
  for (const branch of model.branches) {
    for (const node of branchNodes(branch)) {
      if (!knownNodes.has(node)) {
        knownNodes.add(node)
        nodeIds.push(node)
      }
    }
  }

  const islands = islandsOf(nodeIds, model.branches)
  const grounds = new Set<string>()
  for (const island of islands) {
    /* `<` compares UTF-16 strings just like the former default sort, but a
       minimum scan is linear and leaves the unknown-node order unchanged. */
    let ground = island[0] as string
    for (const node of island) if (node < ground) ground = node
    grounds.add(ground)
  }

  const unknownNodes = nodeIds.filter((node) => !grounds.has(node))
  const nodeIndex = new Map<string, number>()
  unknownNodes.forEach((node, index) => nodeIndex.set(node, index))

  const sourceBranches = model.branches.filter(
    (branch): branch is SourceBranch => branch.kind === 'source',
  )
  const size = unknownNodes.length + sourceBranches.length
  return { nodeIds, unknownNodes, nodeIndex, sourceBranches, size }
}

/** Pure topology/layout accounting; no matrix allocation or MNA solving. */
export const circuitNumericalIterationCountBoundOf = (model: ResolvedCircuitModel): number =>
  linearSystemIterationCountBoundOf(linearSystemLayoutOf(model).size)

/** The same actual layout supplies both Gaussian and graph/matrix processing bounds. */
export const circuitSolverWorkBoundOf = (model: ResolvedCircuitModel) => {
  const { nodeIds, unknownNodes, sourceBranches, size } = linearSystemLayoutOf(model)
  const nodes = nodeIds.length
  const branches = model.branches.length
  const sources = sourceBranches.length
  // Layout: copy+set, branch/endpoints, adjacency+DFS (each edge at most twice),
  // island grounds, node filter/index, source filter. Each nested loop is included.
  const layoutIterations = 2 * model.nodeIds.length + 7 * branches + 6 * nodes + unknownNodes.length
  // Zeroed matrix/rhs, augmented copies and solved values; stamping/current passes
  // visit each branch/source and each node/current-sum at most once per pass.
  const matrixIterations = 2 * size * size + 5 * size
  const solutionIterations = 2 * branches + 2 * sources + 2 * nodes
  return {
    gaussianIterationCountBound: linearSystemIterationCountBoundOf(size),
    processingIterationCountBound: layoutIterations + matrixIterations + solutionIterations,
  }
}

export const solveCircuit = (model: ResolvedCircuitModel): CircuitSolution => {
  const { nodeIds, unknownNodes, nodeIndex, sourceBranches, size } = linearSystemLayoutOf(model)
  const matrix: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const rhs = new Array<number>(size).fill(0)

  const stampConductance = (nodeA: string, nodeB: string, conductance: number): void => {
    const indexA = nodeIndex.get(nodeA)
    const indexB = nodeIndex.get(nodeB)
    if (indexA !== undefined) {
      ;(matrix[indexA] as number[])[indexA] =
        ((matrix[indexA] as number[])[indexA] ?? 0) + conductance
    }
    if (indexB !== undefined) {
      ;(matrix[indexB] as number[])[indexB] =
        ((matrix[indexB] as number[])[indexB] ?? 0) + conductance
    }
    if (indexA !== undefined && indexB !== undefined) {
      ;(matrix[indexA] as number[])[indexB] =
        ((matrix[indexA] as number[])[indexB] ?? 0) - conductance
      ;(matrix[indexB] as number[])[indexA] =
        ((matrix[indexB] as number[])[indexA] ?? 0) - conductance
    }
  }

  for (const branch of model.branches) {
    if (branch.kind === 'conductance') {
      stampConductance(branch.nodeA, branch.nodeB, 1 / branch.resistance)
    }
  }
  sourceBranches.forEach((branch, order) => {
    const currentIndex = unknownNodes.length + order
    const positiveIndex = nodeIndex.get(branch.nodePositive)
    const negativeIndex = nodeIndex.get(branch.nodeNegative)
    if (positiveIndex !== undefined) {
      ;(matrix[positiveIndex] as number[])[currentIndex] = 1
      ;(matrix[currentIndex] as number[])[positiveIndex] = 1
    }
    if (negativeIndex !== undefined) {
      ;(matrix[negativeIndex] as number[])[currentIndex] = -1
      ;(matrix[currentIndex] as number[])[negativeIndex] = -1
    }
    rhs[currentIndex] = branch.emf
  })

  const solved = size === 0 ? [] : solveLinearSystem(matrix, rhs)

  const potentials = new Map<string, number>()
  for (const node of nodeIds) {
    const index = nodeIndex.get(node)
    potentials.set(node, index === undefined ? 0 : (solved[index] ?? 0))
  }

  const potentialOf = (node: string): number => potentials.get(node) ?? 0

  const branchCurrents = new Map<string, number>()
  const nodeCurrentSums = new Map<string, number>()
  const addNodeCurrent = (node: string, value: number): void => {
    nodeCurrentSums.set(node, (nodeCurrentSums.get(node) ?? 0) + value)
  }

  let totalSourcePower = 0
  let totalDissipatedPower = 0

  for (const branch of model.branches) {
    if (branch.kind === 'conductance') {
      const drop = potentialOf(branch.nodeA) - potentialOf(branch.nodeB)
      const current = drop / branch.resistance
      branchCurrents.set(branch.componentId, current)
      addNodeCurrent(branch.nodeA, -current)
      addNodeCurrent(branch.nodeB, current)
      totalDissipatedPower += current * current * branch.resistance
    }
  }
  sourceBranches.forEach((branch, order) => {
    const current = solved[unknownNodes.length + order] ?? 0
    branchCurrents.set(branch.componentId, current)
    addNodeCurrent(branch.nodePositive, -current)
    addNodeCurrent(branch.nodeNegative, current)
    if (branch.role === 'battery') {
      /* MNA's unknown flows positive→negative inside the source, so a
         discharging battery reports a negative value; delivered power is
         E·(−i). */
      totalSourcePower += branch.emf * -current
    }
  })

  let kclResidual = 0
  for (const sum of nodeCurrentSums.values()) {
    kclResidual = Math.max(kclResidual, Math.abs(sum))
  }

  return {
    potentials,
    branchCurrents,
    kclResidual,
    totalSourcePower,
    totalDissipatedPower,
  }
}
