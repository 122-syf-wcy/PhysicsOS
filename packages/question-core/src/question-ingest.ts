import type { QuestionSource } from './question-document.ts'

export type IngestProviderStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'WAITING_PROVIDER'

export interface QuestionIngestProvider {
  readonly id: string
  readonly status: IngestProviderStatus
  canHandle(source: QuestionSource): boolean
  ingest(data: string | ArrayBuffer): Promise<{ text: string; confidence: number } | null>
}

export class TextIngestProvider implements QuestionIngestProvider {
  readonly id = 'text-ingest'
  readonly status: IngestProviderStatus = 'AVAILABLE'

  canHandle(source: QuestionSource): boolean {
    return source === 'text'
  }

  async ingest(data: string | ArrayBuffer): Promise<{ text: string; confidence: number } | null> {
    if (typeof data === 'string') return { text: data, confidence: 1 }
    return null
  }
}

export class StubImageIngestProvider implements QuestionIngestProvider {
  readonly id = 'image-ingest-stub'
  readonly status: IngestProviderStatus = 'UNAVAILABLE'

  canHandle(source: QuestionSource): boolean {
    return source === 'image'
  }

  async ingest(): Promise<{ text: string; confidence: number } | null> {
    return null
  }
}

export class StubPdfIngestProvider implements QuestionIngestProvider {
  readonly id = 'pdf-ingest-stub'
  readonly status: IngestProviderStatus = 'UNAVAILABLE'

  canHandle(source: QuestionSource): boolean {
    return source === 'pdf'
  }

  async ingest(): Promise<{ text: string; confidence: number } | null> {
    return null
  }
}

export const DEFAULT_INGEST_PROVIDERS: QuestionIngestProvider[] = [
  new TextIngestProvider(),
  new StubImageIngestProvider(),
  new StubPdfIngestProvider(),
]
