import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

import assert from 'node:assert/strict';
import test from 'node:test';
import { Tooltip } from 'recharts';

import { MonthCompareBarChart } from '@/components/dashboard/month-compare-bar-chart';
import type { MonthlySnapshot } from '@/types/finance';

const history: MonthlySnapshot[] = [
  { month: '2026-10', income: 2614.87, expense: 2302.49, hasActivity: true },
  { month: '2026-11', income: 0, expense: 0, hasActivity: false },
];

function descendants(node: ReactNode): ReactElement[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    return [child, ...descendants((child.props as { children?: ReactNode }).children)];
  });
}

test('hover over month comparison keeps the plot background unchanged while tooltip remains enabled', () => {
  const chart = MonthCompareBarChart({ history });
  const tooltip = descendants(chart).find((child) => child.type === Tooltip);
  assert.ok(tooltip, 'A comparação deve continuar exibindo o tooltip de valores');
  assert.equal(
    (tooltip.props as { cursor?: boolean }).cursor,
    false,
    'O cursor padrão do Recharts não pode pintar um retângulo claro no hover',
  );
});
