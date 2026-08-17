import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: 'default' | 'processing' | 'ready' | 'failed';
}

export function Badge({
  children,
  className,
  tone = 'default',
  ...props
}: BadgeProps) {
  return (
    <span className={cn('badge', `badge--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}
