export interface ExperimentInfo {
  id: string
  title: string
  subtitle: string
  domain: string
  stage: 'junior' | 'senior'
  tags: string[]
}
export interface ExperimentCatalog { version: 1; experiments: ExperimentInfo[] }
export interface ChapterRef { stage: 'junior' | 'senior'; volume: string; chapter: string }
export interface LibraryBase {
  id: string; title: string; description: string; markdown: string
  sourceRef: 'physicsos-shared' | 'smartedu'
  access: 'local' | 'external'; offline: boolean; url?: string
}
export interface LibraryQuestion extends LibraryBase {
  text: string; domain: string; stage?: 'junior' | 'senior'
  knowledgeIds: string[]; chapters: ChapterRef[]; validation: string
  answer?: string; explanation?: string; templateId?: string
  options?: { id: string; text: string; explanation?: string }[]
}
export interface LibraryKnowledge extends LibraryBase {
  domain: string; parentId?: string; stage?: 'junior' | 'senior'
  chapter?: ChapterRef; questionIds: string[]
}
export interface LibraryResource extends LibraryBase {
  stage: 'junior' | 'senior'; volume: string; chapter: string; kind: string; url: string
}
export interface LibraryCourse extends LibraryBase {
  stage: 'junior' | 'senior'
  chapters: { id: string; title: string; topics: string[]; questionIds: string[]; resourceIds: string[] }[]
}
export interface LibraryCatalog {
  version: 1
  courses: LibraryCourse[]
  knowledge: LibraryKnowledge[]
  questions: LibraryQuestion[]
  resources: LibraryResource[]
  sources: { id: 'physicsos-shared' | 'smartedu'; title: string; description: string; access: 'local' | 'external'; offline: boolean; url?: string; snapshotDate?: string }[]
}
