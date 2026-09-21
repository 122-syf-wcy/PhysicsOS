import { asQuestionId } from '@physicsos/shared'
import type { QuestionDocument, QuestionSource } from './question-document.ts'

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

/* ------------------------------------------------- uploaded documents -- */

/**
 * Provenance a client-side upload carries into the document: the file name,
 * which pages produced the text (PDF text-layer extraction), and the provider
 * that produced it (`browser-pdfjs` today — vision extraction stays with the
 * agent through session attachments, not through this seam).
 */
export interface UploadedQuestionProvenance {
  readonly fileName?: string
  readonly pages?: readonly number[]
  readonly provider?: string
}

/**
 * A QuestionDocument whose text came out of an uploaded file rather than the
 * textarea. `extractedText` is what the pipeline reads; `rawText` mirrors it so
 * the stem block shows the same words the student just confirmed. The document
 * starts EXTRACTED, never READY — the deterministic pipeline still validates it.
 */
export function createUploadedQuestionDocument(input: {
  readonly source: Extract<QuestionSource, 'image' | 'pdf'>
  readonly extractedText: string
  readonly title?: string
  readonly provenance?: UploadedQuestionProvenance
  readonly now?: string
}): QuestionDocument {
  const ts = input.now ?? new Date().toISOString()
  const provenance = input.provenance
  return {
    id: asQuestionId(`upload-${Math.random().toString(36).slice(2, 10)}`),
    content: {
      source: input.source,
      rawText: input.extractedText,
      extractedText: input.extractedText,
      status: 'EXTRACTED',
      ...(input.source === 'pdf' && provenance?.pages !== undefined
        ? { pdfRefs: provenance.pages.map(page => `page-${page}`) }
        : {}),
      ...(input.source === 'image' && provenance?.fileName !== undefined
        ? { imageRefs: [provenance.fileName] }
        : {}),
    },
    metadata: {
      title: input.title ?? provenance?.fileName ?? '上传题目',
      source: provenance?.provider ?? 'upload',
    },
    createdAt: ts,
    updatedAt: ts,
  }
}
