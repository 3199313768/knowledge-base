import { Card as OxygenCard } from '@oxygen-design/ui';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  variant?: 'default' | 'muted' | 'dashed';
}

export function Card({
  children,
  className,
  role,
  variant = 'default',
  ...props
}: CardProps) {
  const accessibleRole = role ?? (props['aria-label'] ? 'region' : undefined);

  return (
    <OxygenCard
      className={cn('ui-card', `ui-card--${variant}`, className)}
      role={accessibleRole}
      {...props}
    >
      {children}
    </OxygenCard>
  );
}
