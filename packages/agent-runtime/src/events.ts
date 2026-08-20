import type { RunId, SceneId, ToolCallId } from '@physicsos/shared'

export interface AgentTextDelta {
  type: 'text_delta'
  text: string
}

export interface AgentStatusChanged {
  type: 'status_changed'
  status:
    | 'understanding_question'
    | 'creating_scene'
    | 'computing'
    | 'verifying'
    | 'adjusting_visualization'
    | 'organizing_explanation'
    | 'compacting_context'
}

export interface ToolCallStarted {
  type: 'tool_started'
  toolCallId: ToolCallId
  name: string
}

export interface ToolCallCompleted {
  type: 'tool_completed'
  toolCallId: ToolCallId
  name: string
  ok: boolean
}

export interface SceneRevisionChanged {
  type: 'scene_changed'
  sceneId: SceneId
  revision: number
}

export interface ObservationChanged {
  type: 'observation_changed'
  observableIds: string[]
}

export interface VerificationCompleted {
  type: 'verification_completed'
  passed: boolean
}

export interface AgentRunCompleted {
  type: 'run_completed'
  runId: RunId
}

export interface AgentRunFailed {
  type: 'run_failed'
  runId: RunId
  code: string
  message: string
}

export type AgentClientEvent =
  | AgentTextDelta
  | AgentStatusChanged
  | ToolCallStarted
  | ToolCallCompleted
  | SceneRevisionChanged
  | ObservationChanged
  | VerificationCompleted
  | AgentRunCompleted
  | AgentRunFailed
