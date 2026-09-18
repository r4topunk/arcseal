'use client';

import { chain } from '@/lib/config';
import { formatUsdc, nativeFeeToUsdcUnits } from '@/lib/format';
import { useI18n } from './i18n';
import { type FeeRequest, useFeeEstimate } from './queries';

/**
 * "est. network fee ≈ 0.001381 USDC". estimateGas x gasPrice is in 18-decimal native units; it is converted to the
 * 6-decimal USDC view so every amount on the page uses one scale. Renders nothing when the call would revert.
 */
export function FeeEstimate({ request }: { request: FeeRequest | null }) {
  const { t } = useI18n();
  const { data } = useFeeEstimate(request);
  if (data === undefined || data === null) return null;
  return (
    <p className="text-muted text-xs" data-testid="fee-estimate">
      {t('fee.label')}{' '}
      <span className="tnum font-mono text-foreground">
        {t('fee.value', {
          amount: formatUsdc(nativeFeeToUsdcUnits(data)),
          symbol: chain.nativeCurrency.symbol,
        })}
      </span>
    </p>
  );
}
