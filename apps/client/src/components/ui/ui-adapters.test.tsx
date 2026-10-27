import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { TextInput } from './TextInput';

describe('Oxygen-backed UI adapters', () => {
  it('keeps local button variants while rendering the Oxygen control', () => {
    render(
      <Button disabled variant="primary">
        保存
      </Button>,
    );

    const button = screen.getByRole('button', { name: '保存' });
    expect(button).toBeDisabled();
    expect(button).toHaveClass('oxygen-button', 'oxygen-button--default');
    expect(button).toHaveClass('button', 'button--primary');
  });

  it('renders card, status badge, and text input through Oxygen primitives', () => {
    render(
      <Card variant="muted">
        <Badge tone="ready">已就绪</Badge>
        <TextInput aria-label="文件名" defaultValue="方案.pdf" />
      </Card>,
    );

    expect(screen.getByText('已就绪')).toHaveClass(
      'oxygen-badge',
      'oxygen-badge--success',
    );
    expect(screen.getByLabelText('文件名')).toHaveClass('oxygen-input');
    expect(screen.getByText('已就绪').closest('.oxygen-card')).toHaveClass(
      'ui-card',
      'ui-card--muted',
    );
  });
});
