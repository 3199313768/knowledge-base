import { Input } from '@oxygen-design/ui';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ className, ...props }, ref) {
    return <Input className={cn('text-input', className)} ref={ref} {...props} />;
  }
);
