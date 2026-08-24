const { createRequire } = require('module');
const base = 'C:/Users/kindr/.dsh/profiles/web/';
const req = createRequire(base);
for (const spec of ['dsh-timeline', 'dsh-usage-stats', '@deepseek-ai/dsh-client-runtime']) {
  try { console.log(spec, '->', req.resolve(spec + '/package.json')); }
  catch (e) { console.log(spec, '-> FAIL:', e.code || e.message.slice(0, 80)); }
}