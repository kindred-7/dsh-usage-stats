const base = 'file:///C:/Users/kindr/.dsh/profiles/web/node_modules/';
import(base + 'dsh-usage-stats/lib/index.js').then(m => console.log('usage OK:', Object.keys(m).join(','))).catch(e => console.log('usage FAIL:', e.message));
import(base + 'dsh-timeline/lib/index.js').then(m => console.log('timeline OK:', Object.keys(m).join(','))).catch(e => console.log('timeline FAIL:', e.message));