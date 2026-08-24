// dsh-usage-stats host half
//
// Mounted as a profile-bundle row only so the client-modules scanner sees the
// package's `dsh.client` declaration; everything functional lives in the
// browser half (lib/client.js).

/**
 * Host plugin apply (no-op)
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {}

export { apply as default };
