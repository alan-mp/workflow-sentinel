import type { Deps, Env } from './env';
import { retryBriefings } from './insights';
import { deliverDue } from './integrations';
import { logError } from './log';
import { applyDueChanges } from './org';
import { runSla } from './requests';

/**
 * The cron trigger's work. Due structure changes go first so that SLA escalation uses the latest
 * structure; webhook delivery does not depend on either and runs even when they fail. Failures are
 * logged and rethrown together, so the cron run is still reported as failed.
 */
export async function runCron(db: D1Database, deps: Deps, now: Date, env?: Env): Promise<void> {
  const failures: unknown[] = [];
  try {
    await applyDueChanges(db, deps, now);
    await runSla(db, deps, now);
  } catch (e) {
    logError('cron: applying org changes or SLA failed', e);
    failures.push(e);
  }
  try {
    await deliverDue(db, deps, now);
  } catch (e) {
    logError('cron: webhook delivery failed', e);
    failures.push(e);
  }
  if (env) {
    try {
      await retryBriefings(db, env, deps, now);
    } catch (e) {
      logError('cron: retrying AI briefings failed', e);
      failures.push(e);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Scheduled run failed');
}
