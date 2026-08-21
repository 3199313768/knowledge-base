import { Card } from './ui/Card';

interface PlaceholderPageProps {
  description: string;
  title: string;
}

export function PlaceholderPage({ description, title }: PlaceholderPageProps) {
  return (
    <section className="content-pane" aria-label={title}>
      <header className="workbench-header">
        <h2>{title}</h2>
      </header>
      <Card className="empty-state" variant="dashed">
        <h2>{title}</h2>
        <p>{description}</p>
      </Card>
    </section>
  );
}
