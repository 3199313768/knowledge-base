import {
  Button as OxygenButton,
  type ButtonProps as OxygenButtonProps,
} from '@oxygen-design/ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends Omit<OxygenButtonProps, 'variant'> {
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
  const oxygenVariant =
    variant === 'primary' ? 'default' : variant === 'nav' ? 'ghost' : variant;

  return (
    <OxygenButton
      className={cn('button', `button--${variant}`, className)}
      type={type}
      variant={oxygenVariant}
      {...props}
    >
      {children}
    </OxygenButton>
  );
}
