import { brand, type Brand } from './brand.ts'

export type SceneId = Brand<string, 'SceneId'>
export type SnapshotId = Brand<string, 'SnapshotId'>
export type PhysicsEventId = Brand<string, 'PhysicsEventId'>
export type CommandId = Brand<string, 'CommandId'>
export type SimulationId = Brand<string, 'SimulationId'>
export type ParticleId = Brand<string, 'ParticleId'>
export type FieldId = Brand<string, 'FieldId'>
export type RegionId = Brand<string, 'RegionId'>
export type ObservableId = Brand<string, 'ObservableId'>
export type ComponentId = Brand<string, 'ComponentId'>
export type QuestionId = Brand<string, 'QuestionId'>
export type SessionId = Brand<string, 'SessionId'>
export type RunId = Brand<string, 'RunId'>
export type TurnId = Brand<string, 'TurnId'>
export type ToolCallId = Brand<string, 'ToolCallId'>
export type TraceId = Brand<string, 'TraceId'>
export type UserId = Brand<string, 'UserId'>

export const asSceneId = (value: string): SceneId => brand(value)
export const asSnapshotId = (value: string): SnapshotId => brand(value)
export const asPhysicsEventId = (value: string): PhysicsEventId => brand(value)
export const asCommandId = (value: string): CommandId => brand(value)
export const asSimulationId = (value: string): SimulationId => brand(value)
export const asParticleId = (value: string): ParticleId => brand(value)
export const asFieldId = (value: string): FieldId => brand(value)
export const asRegionId = (value: string): RegionId => brand(value)
export const asObservableId = (value: string): ObservableId => brand(value)
export const asComponentId = (value: string): ComponentId => brand(value)
export const asQuestionId = (value: string): QuestionId => brand(value)
export const asSessionId = (value: string): SessionId => brand(value)
export const asRunId = (value: string): RunId => brand(value)
export const asTurnId = (value: string): TurnId => brand(value)
export const asToolCallId = (value: string): ToolCallId => brand(value)
export const asTraceId = (value: string): TraceId => brand(value)
export const asUserId = (value: string): UserId => brand(value)
