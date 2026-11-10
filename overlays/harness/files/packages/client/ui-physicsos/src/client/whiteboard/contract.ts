import type { FactoryComponentPropsOf, InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WhiteboardController } from './controller.ts'

export interface WhiteboardInjected {
  readonly hooks: { readonly whiteboardState: Pick<WhiteboardController, 'subscribe' | 'getSnapshot'> }
  readonly whiteboardController: WhiteboardController
  readonly openWhiteboardView: (id?: string) => void
  readonly returnToExperiments: () => void
  readonly whiteboardTheme?: 'light' | 'dark'
  readonly whiteboardLanguage?: string
}
export type WhiteboardSurfaceProps = PropsRuntime<'main'> & PropsRenderFactories & PropsLocale<'physicsos'> & InjectFace<WhiteboardInjected> & { readonly whiteboardId?: string }
export type WhiteboardFactoryProps = FactoryComponentPropsOf<'physicsos.whiteboard.workspace'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    'physicsos.whiteboard.workspace': {
      scope: 'root'
      props: { readonly whiteboardId: string }
      inject: WhiteboardInjected
      locale: 'physicsos'
    }
  }
}
