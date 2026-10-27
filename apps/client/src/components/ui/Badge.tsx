import { Badge as OxygenBadge } from '@oxygen-design/ui';
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
  const oxygenVariant =
    tone === 'processing' ? 'warning' : tone === 'ready' ? 'success' : tone === 'failed' ? 'error' : 'default';

  return (
    <OxygenBadge
      className={cn('badge', `badge--${tone}`, className)}
      variant={oxygenVariant}
      {...props}
    >
      {children}
    </OxygenBadge>
  );
}
