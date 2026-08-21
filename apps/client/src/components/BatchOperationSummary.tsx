import type { BatchResult } from '../uploads/useBatchUpload';
export function BatchOperationSummary({ result }: { result: BatchResult | null }) {
  if (!result) return null;
  return <section aria-label="批量操作结果" className="batch-summary" role="status">
    <p>成功：{result.succeeded} 个　失败：{result.failed} 个　跳过：{result.skipped} 个</p>
    {result.failed ? <ul>{result.results.filter(x => x.status === 'failed').map(x => <li key={x.name}>{x.name}：{x.message}</li>)}</ul> : null}
  </section>;
}
