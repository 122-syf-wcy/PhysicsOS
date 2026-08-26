import { describe, expect, it } from 'vitest'

import {
  EXPERIMENT_SELF_CHECKS,
  GOLDEN_QUESTIONS,
  KNOWLEDGE_NODES,
  QUESTION_KNOWLEDGE,
  QUESTION_SELF_CHECKS,
  experimentSelfChecksOfTopic,
  knowledgeNodesOfQuestion,
  selfChecksOfQuestion,
} from '../src/index.ts'

describe('knowledge graph', () => {
  it('declares a unique id and a valid parent for every node', () => {
    const ids = new Set<string>()
    for (const node of KNOWLEDGE_NODES) {
      expect(ids.has(node.id), node.id).toBe(false)
      ids.add(node.id)
      if (node.parentId !== undefined) {
        expect(ids.has(node.parentId), `${node.id} → ${node.parentId}`).toBe(true)
      }
    }
  })

  it('maps every golden question to at least one declared node', () => {
    const nodeIds = new Set(KNOWLEDGE_NODES.map((node) => node.id))
    for (const question of GOLDEN_QUESTIONS) {
      const mapped = QUESTION_KNOWLEDGE[question.id]
      expect(mapped, question.id).toBeDefined()
      expect(mapped!.length, question.id).toBeGreaterThan(0)
      for (const nodeId of mapped!) {
        expect(nodeIds.has(nodeId), `${question.id} → ${nodeId}`).toBe(true)
      }
    }
  })

  it('has no mapping entry for a question that does not exist', () => {
    const questionIds = new Set(GOLDEN_QUESTIONS.map((question) => question.id))
    for (const mappedId of Object.keys(QUESTION_KNOWLEDGE)) {
      expect(questionIds.has(mappedId), mappedId).toBe(true)
    }
  })

  it('resolves nodes in table order and drops nothing', () => {
    const nodes = knowledgeNodesOfQuestion('comp-01-selector-balance')
    expect(nodes.map((node) => node.id)).toEqual([
      'em-velocity-selector',
      'em-crossed-fields',
      'em-lorentz',
    ])
    expect(knowledgeNodesOfQuestion('no-such-question')).toEqual([])
  })
})

describe('self-check bank', () => {
  it('gives every golden question at least one self-check', () => {
    for (const question of GOLDEN_QUESTIONS) {
      expect(selfChecksOfQuestion(question.id).length, question.id).toBeGreaterThan(0)
    }
  })

  it('has no self-check entry for a question that does not exist', () => {
    const questionIds = new Set(GOLDEN_QUESTIONS.map((question) => question.id))
    for (const mappedId of Object.keys(QUESTION_SELF_CHECKS)) {
      expect(questionIds.has(mappedId), mappedId).toBe(true)
    }
  })

  it('marks exactly one correct option and classifies every wrong one', () => {
    for (const question of GOLDEN_QUESTIONS) {
      for (const item of selfChecksOfQuestion(question.id)) {
        expect(item.options.length, item.id).toBeGreaterThanOrEqual(2)
        const correct = item.options.filter((option) => option.correct === true)
        expect(correct.length, `${question.id}:${item.id}`).toBe(1)
        for (const option of item.options) {
          if (option.correct === true) {
            expect(option.mistake, `${item.id}:${option.id}`).toBeUndefined()
            continue
          }
          /* Every wrong option is a classified mistake with a readable
             explanation and at least one review pointer. */
          expect(option.mistake, `${item.id}:${option.id}`).toBeDefined()
          expect(['concept', 'direction', 'modeling']).toContain(option.mistake!.type)
          expect(option.mistake!.explanation.length).toBeGreaterThan(10)
          expect(option.mistake!.review.length).toBeGreaterThan(0)
        }
        expect(item.takeaway.length, item.id).toBeGreaterThan(10)
      }
    }
  })

  it('keeps option ids unique inside each item', () => {
    for (const question of GOLDEN_QUESTIONS) {
      for (const item of selfChecksOfQuestion(question.id)) {
        const ids = item.options.map((option) => option.id)
        expect(new Set(ids).size, item.id).toBe(ids.length)
      }
    }
  })
})

describe('experiment self-check bank', () => {
  const sets = Object.values(EXPERIMENT_SELF_CHECKS)

  it('keys every set by its own id and resolves through the lookup', () => {
    for (const [key, set] of Object.entries(EXPERIMENT_SELF_CHECKS)) {
      expect(set.id, key).toBe(key)
      expect(experimentSelfChecksOfTopic(key)).toBe(set)
    }
    expect(experimentSelfChecksOfTopic('no-such-topic')).toBeUndefined()
  })

  it('references only declared knowledge nodes and carries content', () => {
    const nodeIds = new Set(KNOWLEDGE_NODES.map((node) => node.id))
    for (const set of sets) {
      expect(set.topic.length, set.id).toBeGreaterThan(1)
      expect(set.knowledge.length, set.id).toBeGreaterThan(0)
      for (const nodeId of set.knowledge) {
        expect(nodeIds.has(nodeId), `${set.id} → ${nodeId}`).toBe(true)
      }
      expect(set.items.length, set.id).toBeGreaterThan(0)
    }
  })

  it('covers every circuit knowledge node with at least one set', () => {
    const exercised = new Set(sets.flatMap((set) => set.knowledge))
    for (const node of KNOWLEDGE_NODES) {
      if (node.domain !== 'circuit' || node.parentId === undefined) continue
      expect(exercised.has(node.id), node.id).toBe(true)
    }
  })

  it('covers every optics knowledge node with at least one set', () => {
    const exercised = new Set(sets.flatMap((set) => set.knowledge))
    for (const node of KNOWLEDGE_NODES) {
      if (node.domain !== 'optics' || node.parentId === undefined) continue
      expect(exercised.has(node.id), node.id).toBe(true)
    }
  })

  it('follows the same option rules as the question bank', () => {
    for (const set of sets) {
      for (const item of set.items) {
        expect(item.options.length, item.id).toBeGreaterThanOrEqual(2)
        const correct = item.options.filter((option) => option.correct === true)
        expect(correct.length, `${set.id}:${item.id}`).toBe(1)
        for (const option of item.options) {
          if (option.correct === true) {
            expect(option.mistake, `${item.id}:${option.id}`).toBeUndefined()
            continue
          }
          expect(option.mistake, `${item.id}:${option.id}`).toBeDefined()
          expect(['concept', 'direction', 'modeling']).toContain(option.mistake!.type)
          expect(option.mistake!.explanation.length).toBeGreaterThan(10)
          expect(option.mistake!.review.length).toBeGreaterThan(0)
        }
        expect(item.takeaway.length, item.id).toBeGreaterThan(10)
        const ids = item.options.map((option) => option.id)
        expect(new Set(ids).size, item.id).toBe(ids.length)
      }
    }
  })
})
