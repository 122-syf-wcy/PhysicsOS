export const name = 'student-tools-fixture'
export const inject = ['tools']
export function apply(ctx) {
  for (const name of ['physics_solve_question', 'ask_user_question', 'delegate_task', 'read_file']) {
    ctx.tools.register({ name, description: name, parameters: { type: 'object', properties: {} }, output: { schema: { type: 'object' }, render: () => [] }, execute: async () => ({}) })
  }
}
