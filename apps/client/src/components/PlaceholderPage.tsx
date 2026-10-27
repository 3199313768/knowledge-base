import { EmptyState, PageHeader } from '@oxygen-design/ui';

interface PlaceholderPageProps {
  description: string;
  title: string;
}

export function PlaceholderPage({ description, title }: PlaceholderPageProps) {
  return (
    <section className="content-pane" aria-label={title}>
      <header className="workbench-header">
        <PageHeader title={title} />
      </header>
      <div className="empty-state">
        <EmptyState description={description} title={title} />
      </div>
    </section>
  );
}
