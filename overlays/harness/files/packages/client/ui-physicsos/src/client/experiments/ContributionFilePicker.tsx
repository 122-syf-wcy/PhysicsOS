import { useId, useRef } from 'react'
import css from './ContributionPanel.module.css'

interface FilePickerProps {
  kind: 'zip' | 'avatar'
  experimentName?: string
  file: File | undefined
  disabled: boolean
  onChange: (file: File | undefined) => void
}

/** Keep the native chooser; give its trigger and selected file a readable, shared material. */
export function ContributionFilePicker({ kind, file, disabled, onChange, experimentName = '凸透镜成像规律' }: FilePickerProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const zip = kind === 'zip'
  const label = zip ? '实验文件 ZIP' : '作者头像（可选）'
  const action = file ? (zip ? '更换实验文件' : '更换头像') : zip ? '选择 ZIP 文件' : '选择头像'
  const size =
    file === undefined
      ? ''
      : file.size >= 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MiB`
        : `${Math.ceil(file.size / 1024)} KiB`
  return (
    <div className={css.fileField}>
      <label htmlFor={id}>{label}</label>
      <div className={css.filePicker} data-selected={file !== undefined}>
        <input
          id={id}
          ref={input}
          className={css.fileInput}
          type="file"
          accept={zip ? '.zip,application/zip' : 'image/png,image/jpeg,image/webp'}
          tabIndex={-1}
          aria-hidden="true"
          aria-describedby={`${id}-hint`}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.files?.[0])
          }}
        />
        <span className={css.fileGlyph} aria-hidden="true">
          {zip ? (
            'ZIP'
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
            </svg>
          )}
        </span>
        <div className={css.fileDetails} aria-live="polite">
          <strong title={file?.name}>
            {file?.name ?? (zip ? '添加你的实验文件' : '添加作者头像')}
          </strong>
          <span>
            {file ? size : zip ? 'ZIP 文件 · 最大 20 MiB' : 'PNG / JPG / WebP · 最大 256 KiB'}
          </span>
        </div>
        <div className={css.fileActions}>
          <button
            ref={trigger}
            type="button"
            className={css.fileButton}
            aria-label={action}
            aria-describedby={`${id}-hint`}
            disabled={disabled}
            onClick={() => {
              input.current?.click()
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 15V4m-4 4 4-4 4 4M5 15v5h14v-5" />
            </svg>
            {file ? '更换文件' : zip ? '选择 ZIP 文件' : '选择头像'}
          </button>
          {file ? (
            <button
              type="button"
              className={css.removeFile}
              aria-label={zip ? '移除实验文件' : '移除头像'}
              disabled={disabled}
              onClick={() => {
                if (input.current) input.current.value = ''
                onChange(undefined)
                trigger.current?.focus()
              }}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      <small id={`${id}-hint`}>
        {zip
          ? `上传模板构建后 release 目录中的 ZIP，适用于${experimentName}。`
          : '填写 GitHub 主页时优先显示 GitHub 头像。'}
      </small>
    </div>
  )
}
