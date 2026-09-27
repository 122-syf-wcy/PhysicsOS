import type {
  ElementType,
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
} from 'react'
import clsx from 'clsx'

import css from './AdminWorkspace.module.css'

type AdminDataAttributes = {
  readonly [key: `data-${string}`]: string | number | boolean | undefined
}

export interface AdminPageTab<T extends string = string> {
  readonly id: T
  readonly label: ReactNode
}

export interface AdminPageProps<T extends string = string> {
  readonly title: ReactNode
  readonly tabs: readonly AdminPageTab<T>[]
  readonly activeTab: T
  readonly onTabChange: (id: T) => void
  readonly children: ReactNode
}

/**
 * The one page-level container for the administrator surface. Tabs render
 * content only; the header, tab strip, width, and vertical rhythm live here.
 */
export function AdminPage<T extends string>({
  title,
  tabs,
  activeTab,
  onTabChange,
  children,
}: AdminPageProps<T>): ReactNode {
  return (
    <div className={css.page} data-admin-page="">
      <header className={css.pageHeader} data-admin-page-header="">
        <h1 className={css.pageTitle}>{title}</h1>
        <nav className={css.pageTabs} role="tablist">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={clsx(css.pageTab, activeTab === tab.id && css.pageTabActive)}
              onClick={() => { onTabChange(tab.id) }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <div className={css.pageContent} data-admin-page-content="">
        {children}
      </div>
    </div>
  )
}

export function AdminToolbar({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & AdminDataAttributes): ReactNode {
  return (
    <div className={clsx(css.toolbar, className)} data-admin-toolbar="" {...rest}>
      {children}
    </div>
  )
}

export interface AdminStatItem {
  readonly key: string
  readonly value: ReactNode
  readonly label: ReactNode
  readonly dataStat?: string
  readonly warn?: boolean
}

export function AdminStats({
  items,
  className,
}: {
  readonly items: readonly AdminStatItem[]
  readonly className?: string
}): ReactNode {
  return (
    <div className={clsx(css.stats, className)} data-admin-stats="">
      {items.map(item => (
        <span
          key={item.key}
          className={clsx(css.stat, item.warn === true && css.statWarn)}
          data-stat={item.dataStat ?? item.key}
        >
          <strong>{item.value}</strong>
          {' '}
          {item.label}
        </span>
      ))}
    </div>
  )
}

export function AdminCard({
  className,
  children,
  testId,
  ...rest
}: HTMLAttributes<HTMLElement> & AdminDataAttributes & {
  readonly testId?: string
}): ReactNode {
  return (
    <section
      className={clsx(css.card, className)}
      data-testid={testId}
      {...rest}
    >
      {children}
    </section>
  )
}

export function AdminCardHead({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & AdminDataAttributes): ReactNode {
  return <div className={clsx(css.cardHead, className)} {...rest}>{children}</div>
}

export function AdminCardTitle({
  as: Tag = 'h3',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  readonly as?: ElementType
}): ReactNode {
  return <Tag className={clsx(css.cardTitle, className)} {...rest}>{children}</Tag>
}

export function AdminCardMeta({
  as: Tag = 'p',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  readonly as?: ElementType
}): ReactNode {
  return <Tag className={clsx(css.cardMeta, className)} {...rest}>{children}</Tag>
}

export function AdminCardActions({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={clsx(css.actions, className)} {...rest}>{children}</div>
}

export function AdminEmpty({
  as: Tag = 'div',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  readonly as?: ElementType
}): ReactNode {
  return (
    <Tag className={clsx(css.empty, className)} data-admin-empty="" {...rest}>
      {children}
    </Tag>
  )
}

export function AdminTable({
  className,
  style,
  minWidth,
  testId,
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & AdminDataAttributes & {
  readonly minWidth?: number
  readonly testId?: string
}): ReactNode {
  return (
    <div className={css.tableWrap} data-admin-table-wrap="">
      <table
        className={clsx(css.table, className)}
        style={minWidth === undefined ? style : { ...style, minWidth }}
        data-testid={testId}
        {...rest}
      >
        {children}
      </table>
    </div>
  )
}
