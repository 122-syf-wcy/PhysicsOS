/** Published student library and assignment targets over the existing PaperService. */
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { findExperiment } from '@physicsos/agent-tools'
import { documentHash } from '@physicsos/question-paper'
import type { IdentityActor } from './identity.ts'
import { PaperError, type PaperService } from './service.ts'
import { canReadPaperRecord } from './scope.ts'
import { studentSource, studentAnnotation, studentBankItem } from './student-projection.ts'

export const MOBILE_PAPER_SERVICE = 'physicsosMobilePaper'
/** Class-host checks exact membership, tenant, publication and the caller's actual review receipt. */
export interface StudentAssignmentReader {
  assignmentForStudent(actor: IdentityActor, classId: string, assignmentId: string): {
    assignment: {
      id: string; classId: string; schoolId: string; title: string; dueAt: string; instructions?: string | undefined;
      target: { kind: 'paper' | 'experiment'; id: string };
    }
    answerPolicy: { mode: 'never' | 'after-due' | 'after-review'; released: boolean }
  }
}
const student = (actor: IdentityActor): void => {
  if (actor.role !== 'STUDENT') throw new PaperError(403, 'STUDENT_REQUIRED', '移动学生入口不提供教师试卷任务')
}

export function createMobilePaper(service: PaperService, classes: () => StudentAssignmentReader | undefined, exportDir: string) {
  const grant = (actor: IdentityActor, classId: string, assignmentId: string) => {
    student(actor)
    const reader = classes()
    if (reader === undefined) throw new PaperError(503, 'CLASS_UNAVAILABLE', '班级服务未挂载，不能验证作业权限')
    const result = reader.assignmentForStudent(actor, classId, assignmentId)
    if (result.assignment.classId !== classId || result.assignment.id !== assignmentId || result.assignment.schoolId !== actor.schoolId) throw new PaperError(404, 'NOT_FOUND', '作业不存在')
    return result
  }
  const paper = (actor: IdentityActor, classId: string, assignmentId: string) => {
    const authorization = grant(actor, classId, assignmentId)
    if (authorization.assignment.target.kind !== 'paper') throw new PaperError(404, 'NOT_FOUND', '作业目标不是试卷')
    const job = service.getJob(authorization.assignment.target.id)
    if (job.schoolId !== actor.schoolId && job.schoolId !== null) throw new PaperError(404, 'NOT_FOUND', '试卷不存在')
    if (job.status !== 'approved' && job.status !== 'exported') throw new PaperError(409, 'TARGET_UNPUBLISHED', '试卷尚未审核发布')
    const { document } = service.requireApprovedDocument(job.id)
    const currentHash = documentHash(document)
    if (job.checkedVersionHash !== currentHash || job.approval?.versionHash !== currentHash || job.findings.some(value => value.severity === 'error')) throw new PaperError(409, 'TARGET_UNPUBLISHED', '试卷当前版本未通过发布校验')
    return { ...authorization, job, document }
  }
  const assignmentView = (assignment: ReturnType<typeof grant>['assignment']) => ({
    id: assignment.id, classId: assignment.classId, title: assignment.title, dueAt: assignment.dueAt,
    target: assignment.target, ...(assignment.instructions === undefined ? {} : { instructions: assignment.instructions }),
  })
  return {
    listSources(actor: IdentityActor) { student(actor); return service.listSources().filter(row => canReadPaperRecord(actor, row)).map(studentSource) },
    listAnnotations(actor: IdentityActor, sourceId?: string) {
      student(actor)
      const sources = new Set(service.listSources().filter(row => canReadPaperRecord(actor, row)).map(row => row.id))
      return service.listAnnotations(sourceId).filter(row => sources.has(row.sourcePaperId) && canReadPaperRecord(actor, row)).map(studentAnnotation)
    },
    listQuestions(actor: IdentityActor) {
      student(actor)
      const sources = new Map(service.listSources().map(row => [row.id, row]))
      return service.listBankItems({ status: 'verified' }, actor.schoolId)
        .filter(row => canReadPaperRecord(actor, row) && (row.sourcePaperId === undefined || (sources.get(row.sourcePaperId) !== undefined && canReadPaperRecord(actor, sources.get(row.sourcePaperId)!))))
        .map(studentBankItem)
    },
    target(actor: IdentityActor, classId: string, assignmentId: string) {
      const authorization = grant(actor, classId, assignmentId)
      if (authorization.assignment.target.kind === 'experiment') {
        const experiment = findExperiment(authorization.assignment.target.id)
        if (experiment === undefined) throw new PaperError(404, 'TARGET_NOT_FOUND', '实验模板不存在')
        return { assignment: assignmentView(authorization.assignment), kind: 'experiment' as const,
          experiment: { id: experiment.id, title: experiment.title, domain: experiment.domain, stage: experiment.stage,
            scene: experiment.build(experiment.id, experiment.title) } }
      }
      const { assignment, answerPolicy, document, job } = paper(actor, classId, assignmentId)
      return { assignment: assignmentView(assignment), kind: 'paper' as const, answerPolicy,
        paper: { id: document.id, title: document.title, header: document.header,
          version: job.versions.at(-1)?.version, versionHash: job.approval?.versionHash,
          sections: document.sections.map(section => ({ title: section.title, note: section.note,
            items: section.items.map(question => ({ number: question.number, subject: question.subject, kind: question.kind,
              score: question.score, stem: question.stem, options: question.options, subQuestions: question.subQuestions,
              ...(question.figure === undefined ? {} : { figure: { kind: question.figure.kind, ref: question.figure.ref, caption: question.figure.caption,
                url: `/physicsos/mobile/v1/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(assignmentId)}/target/figures/${encodeURIComponent(question.figure.ref)}` } }),
              ...(answerPolicy.released && question.answer !== undefined ? { answer: question.answer } : {}),
            })),
          })),
        },
      }
    },
    async figure(actor: IdentityActor, classId: string, assignmentId: string, ref: string): Promise<Uint8Array> {
      const { job, document } = paper(actor, classId, assignmentId)
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(ref) || !/^[A-Za-z0-9._-]{1,128}$/.test(job.id) || !document.sections.some(section => section.items.some(question => question.figure?.ref === ref))) throw new PaperError(404, 'NOT_FOUND', '题图不存在')
      const root = resolve(exportDir)
      for (const path of [root, join(root, job.id)]) {
        const stat = await lstat(path).catch(() => { throw new PaperError(404, 'NOT_FOUND', '题图尚未生成') })
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PaperError(503, 'UNSAFE_STORAGE', '题图目录不可用')
      }
      const file = await open(join(root, job.id, `fig-${ref}.png`), constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => { throw new PaperError(404, 'NOT_FOUND', '题图尚未生成') })
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new PaperError(413, 'FIGURE_TOO_LARGE', '题图超过 4 MiB')
        const bytes = await file.readFile()
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new PaperError(503, 'FIGURE_INVALID', '题图不是有效 PNG')
        return bytes
      } finally { await file.close() }
    },
  }
}
export type MobilePaperFacade = ReturnType<typeof createMobilePaper>
