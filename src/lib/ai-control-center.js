// Phase 12.7 — unified, read-only AI operations snapshot.
import { AI_MODEL_ID, AI_SERVICE_VERSION, isAiConfigured } from './ai-service.js';
import { getSettings } from './settings.js';
import { getRecentActivity } from './activity-log.js';

const AI_ACTIONS = Object.freeze({
  ai_smoke_test: 'Foundation smoke test',
  ai_job_intelligence: 'Job Intelligence',
  user_job_matching: 'User matching',
  user_career_assistant: 'Career Assistant',
  admin_career_assistant: 'Admin Assistant',
  admin_content_intelligence: 'Content Intelligence',
});

function safeMeta(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : (value || {}); } catch (e) { return {}; }
}

export async function getAiControlSnapshot(env) {
  const [settings, activity] = await Promise.all([getSettings(env), getRecentActivity(env, 100)]);
  const totals = Object.fromEntries(Object.keys(AI_ACTIONS).map(action => [action, { attempts: 0, successes: 0, failures: 0, rate_limited: 0 }]));
  for (const row of activity || []) {
    if (!totals[row.action]) continue;
    const meta = safeMeta(row.meta);
    totals[row.action].attempts += 1;
    if (meta.status === 'success') totals[row.action].successes += 1;
    if (meta.status === 'failed' || meta.status === 'error') totals[row.action].failures += 1;
    if (meta.status === 'rate_limited') totals[row.action].rate_limited += 1;
  }
  return {
    model: AI_MODEL_ID,
    service_version: AI_SERVICE_VERSION,
    enabled: settings.ai_enabled !== '0',
    configured: isAiConfigured(env),
    features: Object.entries(AI_ACTIONS).map(([action, label]) => ({ action, label, ...totals[action] })),
    recent_operations: (activity || []).filter(row => AI_ACTIONS[row.action]).slice(0, 12).map(row => ({ action: row.action, label: AI_ACTIONS[row.action], created_at: String(row.created_at || '').slice(0, 40), status: ['success', 'failed', 'error', 'rate_limited'].includes(safeMeta(row.meta).status) ? safeMeta(row.meta).status : 'recorded' })),
  };
}
