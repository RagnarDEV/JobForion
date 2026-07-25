// src/components/footer.js
import { BASE_URL } from '../config/constants.js';

export const renderFooter = () => {
  return `
    <footer class="footer">
      <div class="container">
        <div class="footer__grid">
          <div class="footer__brand">
            <strong>JobForion</strong><br>
            Discover remote job opportunities from top companies around the world.
          </div>
          <div>
            <h4 class="footer__title">Platform</h4>
            <ul class="footer__links">
              <li><a href="/search" class="footer__link">Browse Jobs</a></li>
              <li><a href="/companies" class="footer__link">Companies</a></li>
              <li><a href="/categories" class="footer__link">Categories</a></li>
            </ul>
          </div>
          <div>
            <h4 class="footer__title">Resources</h4>
            <ul class="footer__links">
              <li><a href="/blog" class="footer__link">Blog</a></li>
              <li><a href="/contact" class="footer__link">Contact</a></li>
              <li><a href="/post-job" class="footer__link">Post a Job</a></li>
            </ul>
          </div>
          <div>
            <h4 class="footer__title">Legal</h4>
            <ul class="footer__links">
              <li><a href="/privacy" class="footer__link">Privacy Policy</a></li>
              <li><a href="/terms" class="footer__link">Terms of Service</a></li>
              <li><a href="/disclaimer" class="footer__link">Disclaimer</a></li>
            </ul>
          </div>
        </div>
        <div class="footer__bottom">
          &copy; ${new Date().getFullYear()} JobForion. All rights reserved.
        </div>
      </div>
    </footer>
  `;
};
