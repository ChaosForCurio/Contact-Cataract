const { stackServerApp } = require('../stack/server');

/**
 * Authentication middleware for Stack Auth.
 * Enforces a sign-in wall for all routes it's applied to.
 */
async function authMiddleware(req, res, next) {
  try {
    // 1. Prepare a 'RequestLike' object for stackServerApp.getUser
    // Express req.get() and req.headers are slightly different from Fetch API Request
    const user = await stackServerApp.getUser({
      tokenStore: {
        headers: {
          get: (name) => req.header(name) || null
        }
      }
    });

    // Always inject URLs into res.locals for EJS templates
    res.locals.stackUrls = stackServerApp.urls;

    if (!user) {
      // User is not authenticated
      res.locals.user = null;
      
      // 1. If it's an HTMX request or expects JSON, return 401
      if (req.headers['hx-request'] || req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).send(`
          <div class="p-4 bg-red-900/20 border border-red-500 rounded text-red-200 text-xs text-center">
            Session expired. Please <a href="${stackServerApp.urls.signIn}" class="underline font-bold">Sign In</a> to continue.
          </div>
        `);
      }

      // 2. If it's the root landing page or an auth handler path, let it load
      // This prevents redirect loops and allows the client-side SDK to process tokens
      const exemptPaths = ['/', '/sign-in', '/sign-out'];
      if (exemptPaths.includes(req.path) || req.path.startsWith('/handler')) {
        return next();
      }

      // 3. Otherwise, redirect to the sign-in page
      // We send them to the custom local SSO page
      const returnUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const signInUrl = `/sign-in?returnTo=${encodeURIComponent(returnUrl)}`;
      return res.redirect(signInUrl);
    }

    // 3. User is authenticated
    req.user = user;
    res.locals.user = user;

    next();
  } catch (error) {
    console.error('Auth Middleware Error:', error);
    next(error);
  }
}

module.exports = authMiddleware;
