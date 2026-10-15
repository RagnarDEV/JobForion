// src/lib/admin-i18n/ar/index.js — merges the Arabic dictionaries.
// Add new admin text to the matching file:
//   common.js   short labels / buttons / headings
//   messages.js sentences, help text, empty states, flash messages
//   patterns.js strings that contain numbers or names ({a}, {b} = captured parts)
// Anything missing simply stays English. Find gaps with:  node scripts/harvest-admin-strings.mjs
import { COMMON } from './common.js';
import { MESSAGES } from './messages.js';
import { PATTERNS } from './patterns.js';

export const AR_EXACT = { ...COMMON, ...MESSAGES };
export const AR_PATTERNS = { ...PATTERNS };
