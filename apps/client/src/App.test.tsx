import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the phase zero marker', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'Knowledge Base 技术验证' })
    ).toBeInTheDocument();
  });
});
