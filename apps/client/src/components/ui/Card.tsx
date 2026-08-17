import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  variant?: 'default' | 'muted' | 'dashed';
}

export function Card({
  children,
  className,
  variant = 'default',
  ...props
}: CardProps) {
  return (
    <section className={cn('ui-card', `ui-card--${variant}`, className)} {...props}>
      {children}
    </section>
  );
}
