import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'link' | 'nav';
}

export function Button({
  children,
  className,
  type = 'button',
  variant = 'ghost',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn('button', `button--${variant}`, className)}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
