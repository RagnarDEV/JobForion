// src/routes/api.router.js
// JSON API dispatcher. Each concern lives in its own module under
// src/routes/api/ and returns a Response or null; the first non-null wins.
// Order matters only for cost: cheap/hot endpoints (analytics beacons) first.

import { handleAnalyticsApi } from './api/analytics.api.js';
import { handleMonetizationApi } from './api/monetization.api.js';
import { handleUserApi } from './api/user.api.js';
import { handleFormsApi } from './api/forms.api.js';
import { handleJobsApi } from './api/jobs.api.js';
import { handleSystemApi } from './api/system.api.js';

const API_MODULES = [handleAnalyticsApi, handleMonetizationApi, handleUserApi, handleFormsApi, handleJobsApi, handleSystemApi];

export async function handleApiRoute(url, request, env, ctx) {
  for (const handle of API_MODULES) {
    const response = await handle(url, request, env, ctx);
    if (response) return response;
  }
  return null;
}
