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

/** Gaussian elimination with partial pivoting. Throws on a singular system. */
const solveLinearSystem = (matrix: number[][], rhs: number[]): number[] => {
  const n = rhs.length
  const a = matrix.map((row, index) => [...row, rhs[index] ?? 0])

  for (let column = 0; column < n; column += 1) {
    let pivotRow = column
    let pivotValue = Math.abs(a[column]?.[column] ?? 0)
    for (let row = column + 1; row < n; row += 1) {
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
    for (let row = column + 1; row < n; row += 1) {
      const target = a[row] as number[]
      const factor = (target[column] ?? 0) / (pivot[column] as number)
      if (factor === 0) continue
      for (let k = column; k <= n; k += 1) {
        target[k] = (target[k] ?? 0) - factor * (pivot[k] ?? 0)
      }
    }
  }

  const solution = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row -= 1) {
    const current = a[row] as number[]
    let sum = current[n] ?? 0
    for (let column = row + 1; column < n; column += 1) {
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

export const solveCircuit = (model: ResolvedCircuitModel): CircuitSolution => {
  /* Internal source nodes may not be in nodeIds order yet; branchNodes is the
     source of truth for which nodes exist. */
  const nodeIds = [...model.nodeIds]
  for (const branch of model.branches) {
    for (const node of branchNodes(branch)) {
      if (!nodeIds.includes(node)) nodeIds.push(node)
    }
  }

  const islands = islandsOf(nodeIds, model.branches)
  const grounds = new Set<string>()
  for (const island of islands) {
    /* Deterministic reference per island; islands are electrically independent,
       so each holds its own zero. */
    grounds.add([...island].sort()[0] as string)
  }

  const unknownNodes = nodeIds.filter((node) => !grounds.has(node))
  const nodeIndex = new Map<string, number>()
  unknownNodes.forEach((node, index) => nodeIndex.set(node, index))

  const sourceBranches = model.branches.filter(
    (branch): branch is SourceBranch => branch.kind === 'source',
  )
  const size = unknownNodes.length + sourceBranches.length
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
