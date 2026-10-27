import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Button, Eye, EyeOff, Input } from '@oxygen-design/ui';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ disabled, ...props }, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <div className="password-input">
        <Input
          {...props}
          disabled={disabled}
          ref={ref}
          type={visible ? 'text' : 'password'}
        />
        <Button
          aria-label={visible ? '隐藏密码' : '显示密码'}
          aria-pressed={visible}
          className="password-input__toggle"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
          size="icon"
          type="button"
          variant="link"
        >
          {visible ? <EyeOff aria-hidden="true" className="password-input__icon" /> : <Eye aria-hidden="true" className="password-input__icon" />}
        </Button>
      </div>
    );
  }
);
