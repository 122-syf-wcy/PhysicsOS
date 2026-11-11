import { IconPlusOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkbenchAction.module.css'

/** A header action, so adding an experiment never covers its apparatus or data. */
export function WorkbenchAction({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return <button type="button" className={css.action} aria-label={label} title={label} onClick={onClick}>
    <IconPlusOutlineMedium size={15} />
    <span className={css.label}>{label}</span>
  </button>
}
