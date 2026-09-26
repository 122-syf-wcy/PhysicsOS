/**
 * The class surface, split by role at render time.
 *
 * The hook is called HERE rather than in the workspace dispatcher so a
 * stripped test composition that never opens the class surface does not need a
 * working auth hook, and the teacher/student split stays one decision.
 */
import { isTeachingRole, type AuthState } from './auth-store.ts'
import type { ClassApi } from './class-api.ts'
import { StudentClassWorkspace } from './StudentClassWorkspace.tsx'
import { TeacherClassWorkspace } from './TeacherClassWorkspace.tsx'

export interface ClassSurfaceProps {
  readonly api: ClassApi
  readonly useAuth: <T>(selector: (state: AuthState) => T) => T
}

export function ClassSurface({ api, useAuth }: ClassSurfaceProps) {
  const role = useAuth(state => state.user?.role)
  return isTeachingRole(role)
    ? <TeacherClassWorkspace api={api} />
    : <StudentClassWorkspace api={api} />
}
