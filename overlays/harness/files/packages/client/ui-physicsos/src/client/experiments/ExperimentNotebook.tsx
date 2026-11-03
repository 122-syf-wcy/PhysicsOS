import type { ExperimentSession } from './experiment-session.ts'
import { NOTEBOOK_LIMIT, notebookTable } from './experiment-notebook.ts'
import { exportTableCsv } from '../physics/export-csv.ts'
import css from './ExperimentPage.module.css'

export function ExperimentNotebook({ session }: { session: ExperimentSession }) {
  const entries = session.getNotebook()
  const table = notebookTable(entries)
  return (
    <section className={css.notebook} aria-label="实验记录区">
      <div className={css.sectionHeading}>
        <div>
          <span className={css.eyebrow}>OBSERVATIONS</span>
          <h2>
            我的实验记录 <small>{entries.length} 组</small>
          </h2>
        </div>
        <div className={css.actions}>
          <button
            type="button"
            className={css.subtleButton}
            disabled={entries.length === 0}
            onClick={() => {
              exportTableCsv('凸透镜成像规律', table)
            }}
          >
            导出 CSV
          </button>
          <button
            type="button"
            className={css.primaryButton}
            disabled={
              session.isPreviewing() ||
              entries.length >= NOTEBOOK_LIMIT ||
              session.getSnapshot().status === 'failed'
            }
            onClick={session.recordObservation}
          >
            记录本次
          </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <div className={css.emptyNotebook}>
          <span className={css.notebookIcon}>＋</span>
          <div>
            <strong>让观察成为证据</strong>
            <p>调节物距与光屏，记录不同条件下的像，再比较它们的规律。</p>
          </div>
        </div>
      ) : (
        <div className={css.tableScroll}>
          <table aria-label="实验记录">
            <thead>
              <tr>
                {table.columns.map(column => (
                  <th key={column}>{column}</th>
                ))}
                <th>
                  <span className={css.srOnly}>操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => {
                const entry = entries[index]
                if (entry === undefined) return null
                return (
                  <tr key={entry.id}>
                    {row.values.map((value, cell) => (
                      <td key={cell}>{value}</td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className={css.deleteRow}
                        aria-label={`删除第 ${index + 1} 组记录`}
                        onClick={() => {
                          session.removeObservation(entry.id)
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {entries.length >= NOTEBOOK_LIMIT ? (
        <p role="status">已记录 100 组；请先导出或删除不需要的记录。</p>
      ) : null}
    </section>
  )
}
