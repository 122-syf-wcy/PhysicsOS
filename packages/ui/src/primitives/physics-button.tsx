import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export type PhysicsButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type PhysicsButtonSize = 'sm' | 'md' | 'lg'

export interface PhysicsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PhysicsButtonVariant
  size?: PhysicsButtonSize
  icon?: ReactNode
}

const variantClass: Record<PhysicsButtonVariant, string> = {
  primary: 'bg-[var(--primary-500)] text-white hover:bg-[var(--primary-600)]',
  secondary:
    'bg-white text-[var(--primary-600)] border border-[var(--primary-300)] hover:bg-[var(--primary-50)]',
  ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
  danger: 'bg-[var(--danger-500)] text-white hover:opacity-90',
  success: 'bg-[var(--success-500)] text-white hover:bg-[var(--success-600)]',
}

const sizeClass: Record<PhysicsButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-[var(--radius-md)]',
  md: 'h-9 px-3.5 text-sm rounded-[var(--radius-md)]',
  lg: 'h-11 px-5 text-[15px] rounded-[var(--radius-md)]',
}

export function PhysicsButton({
  variant = 'primary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...props
}: PhysicsButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
