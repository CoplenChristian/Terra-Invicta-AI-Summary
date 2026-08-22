// server/http/routes/shell.js
//
// Purpose: serve the Mission Control (v2) shell at the site root and /v2,
//   through a root-relative path so the checkout's own location cannot 404 it.
//
// ---------------------------------------------------------------------------
// WHY THE PATH IS ROOT-RELATIVE AND NOT ABSOLUTE
// ---------------------------------------------------------------------------
//
// This route used to sit inline in server/index.js as
//
//     res.sendFile(path.join(__dirname, '../public/v2/index.html'))
//
// and `send` 1.2.0 defaults `dotfiles` to 'ignore'. With no `root` option send
// explodes the WHOLE ABSOLUTE PATH into segments (send/index.js: `parts =
// normalize(path).split(sep)`) and 404s if any segment is a dotfile. So every
// checkout living under a path segment that starts with a dot -- an agent
// worktree in `.claude/worktrees/`, for instance -- got a 404 at `/` and `/v2`
// while every API route and `express.static` kept working, because both of
// those DO set `root` and therefore only ever test the request-relative path.
//
// It presented as a blank dashboard rather than an error, cost several agents a
// misread baseline, and was nearly diagnosed as a CSS regression.
//
// Passing `{ root: publicDir }` fixes it the way the guard was designed to be
// used: the dotfiles decision is made over the request-relative path
// ('v2/index.html'), which is where a dot segment would actually mean
// something, and the machine's directory layout stops being an input to it.
//
// `dotfiles: 'allow'` would also work and is a smaller edit, but it switches
// the guard OFF. Nothing today would notice -- this route serves one constant
// relative path under one constant root and reads nothing from the request, so
// there is no reachability difference between the two spellings on the code as
// written. The difference is under a future edit: if anyone ever lets a request
// parameter reach this path, 'allow' would silently serve `.env` or
// `.git/config` while `{ root }` keeps refusing them. `express.static` is
// untouched and keeps its own default, so a request for a dotfile under
// `public/` still 404s.
//
// ---------------------------------------------------------------------------
//
// `publicDir` is injectable for one reason: a test can point it at a directory
// that DOES contain a dot segment and prove the shell is still served. Without
// that seam the regression could only be caught on a checkout that happens to
// live under a dot-directory, which is precisely how it survived this long.

const path = require('path');

/** `public/`, three levels up from server/http/routes/. */
const DEFAULT_PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'public');

/** Relative to `publicDir`. Never joined into an absolute path -- see above. */
const SHELL_RELATIVE_PATH = 'v2/index.html';

/**
 * Both paths render the same live UI, so `/v2` links keep working without a
 * redirect. Registration ORDER is load-bearing and lives in server/index.js:
 * this must stay ahead of `express.static`, or directory-index behaviour over
 * `public/` surfaces the legacy v1 shell at `/`. tests/serverRoutes.test.js
 * pins the whole table.
 */
const SHELL_ROUTES = ['/', '/v2'];

function register(app, { publicDir = DEFAULT_PUBLIC_DIR } = {}) {
  app.get(SHELL_ROUTES, (req, res) => {
    // No callback: express's own default error handling (next(err) for
    // everything but ECONNABORTED and write errors, next() for EISDIR) is what
    // this route had before and what tests/serverRoutes.test.js was captured
    // against.
    res.sendFile(SHELL_RELATIVE_PATH, { root: publicDir });
  });
}

module.exports = {
  register,
  DEFAULT_PUBLIC_DIR,
  SHELL_RELATIVE_PATH,
  SHELL_ROUTES
};
