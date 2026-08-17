import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className, ...props }: TextInputProps) {
  return <input className={cn('text-input', className)} {...props} />;
}
