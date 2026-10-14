// src/lib/affiliate/placement.js
// One call for every public page: "give me the affiliate HTML for this placement".
// Never throws and never blocks a page — any failure simply yields ''.
import { getPlacementOffers } from './affiliate.js';
import { affiliateBlockHtml } from '../../components/affiliate-block.js';

export async function affiliateHtmlFor(env, settings, placement, { categoryKey = '', skills = [], heading } = {}) {
  try {
    const offers = await getPlacementOffers(env, settings, placement, { categoryKey, skills });
    return affiliateBlockHtml(offers, { placement, disclosure: settings.affiliate_disclosure || '', heading });
  } catch (e) { return ''; }
}
