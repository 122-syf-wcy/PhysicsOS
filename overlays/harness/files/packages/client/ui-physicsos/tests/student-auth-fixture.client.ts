import type { PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import type { AuthState } from '../src/client/auth-store.ts'

const studentAuth: AuthState = {
  status: 'authed',
  user: {
    id: 'test-student',
    schoolId: 'test-school',
    schoolName: 'Test School',
    username: 'student',
    displayName: 'Test Student',
    role: 'STUDENT',
  },
}

/** The Lab reads the same signed-in principal supplied by the real connection. */
export const useStudentAuth: PhysicsSurfaceProps['useAuth'] = selector => selector(studentAuth)
