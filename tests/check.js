// 一次性验证脚本：用最小 DOM 桩跑 index.html 的真实逻辑（不产出交付物）
const fs = require('fs'), vm = require('vm');
const htmlPath = process.env.HTML || require('path').join(__dirname, '..', 'index.html');   // 相对脚本自身；HTML=... 可跑历史版本，验证用例真能抓 bug
const html = fs.readFileSync(htmlPath, 'utf8');
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];
const css = (html.match(/<style>([\s\S]*)<\/style>/) || ['', ''])[1];
const rule = sel => {
  const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'));
  return m ? m[1] : '';
};

const el = (id, attrs) => ({
  id, dataset: Object.assign({}, attrs), parent: null, children: [], _l: {},
  innerHTML: '', textContent: '', value: '', hidden: false, className: '', style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); },
  closest(sel) { let n = this; while (n) { if (sel === '[data-act]' && n.dataset && n.dataset.act != null) return n; n = n.parent; } return null; },
  querySelectorAll: () => [],
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
});
function makeEnv(search) {
  const nodes = {};
  const doc = {
    body: el('body'), hidden: false, _l: {},
    getElementById: id => (nodes[id] = nodes[id] || el(id)),
    addEventListener(t, fn) { (doc._l[t] = doc._l[t] || []).push(fn); },
    querySelectorAll: () => []
  };
  // 复刻 index.html 里静态存在的结构，点击按真实冒泡路径走（监听挂错节点就会暴露）
  const reg = e => (nodes[e.id] = e);
  const header = reg(doc.body.appendChild(el('header')));
  const restBar = reg(header.appendChild(el('restBar')));
  reg(restBar.appendChild(el('restTime')));
  reg(restBar.appendChild(el('restLabel')));
  const restPlus = reg(restBar.appendChild(el('restPlusBtn', { act: 'rest-plus' })));
  const restSkip = reg(restBar.appendChild(el('restSkipBtn', { act: 'rest-skip' })));
  reg(doc.body.appendChild(el('view')));
  reg(doc.body.appendChild(el('nav')));
  reg(doc.body.appendChild(el('title')));
  reg(doc.body.appendChild(el('toast')));
  const store = new Map(), sess = new Map();
  const sandbox = {
    document: doc,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v)
    },
    sessionStorage: {
      getItem: k => (sess.has(k) ? sess.get(k) : null),
      setItem: (k, v) => sess.set(k, v)
    },
    location: { search },
    navigator: {}, confirm: () => true, setInterval() {}, setTimeout: () => 0, clearTimeout() {},
    console
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const fire = (target, type) => {
    for (let n = target; n; n = n.parent || (n === doc ? null : doc))
      ((n._l && n._l[type]) || []).forEach(fn => fn({ target, preventDefault() {} }));
  };
  return { ctx, nodes, sandbox, fire, restPlus, restSkip, doc, store };
}

const env1 = makeEnv('');
const { ctx, nodes } = env1;
vm.runInContext(src + `
;globalThis.__t = {
  DB: () => DB, startWorkout, completeSet, finishWorkout, rest,
  KEY, render, parseBackup, mergeDB, importInto, backupName, migrate, defaultDB,
  setDB: v => { DB = v; }, readBackupFile, applyImport, pending: () => pendingBackup,
  renderSetTab: () => { tab = 'set'; render(); },
  renderTrainTab: () => { tab = 'train'; render(); },
  setActiveNull: () => { DB.active = null; },
  isPrimed, primeAudio, wakeOn, wakeOff, tick, dayKey,
  openPicker, closePicker, setExercise, pickState: () => pick
};`, ctx);

const t = ctx.__t;
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const spin = ms => { const s = Date.now(); while (Date.now() - s < ms); };   // 同步等待，模拟真实点击间隔

check('启动后 3 个训练日', t.DB().days.map(d => d.name).join('/') === '推/拉/腿');

t.startWorkout(0);
const act = t.DB().active;
check('开始训练生成目标组数的空组', act.name === '推' && act.items[0].sets.length === 4);

act.items[0].sets[0].w = '60'; act.items[0].sets[0].r = '10';
t.completeSet(0, 0);
check('点 ✓ 后自动开始组间歇', t.rest.active && t.rest.total === 90, 'total=' + t.rest.total);
check('组标记为完成', act.items[0].sets[0].done === true);

t.rest.start = Date.now() - 5000;               // 假装休息了 5 秒
act.items[0].sets[1].w = '60'; act.items[0].sets[1].r = '9';
spin(320);
t.completeSet(0, 1);
check('下一组开始时写入实际休息时长', act.items[0].sets[0].restSec === 5, 'restSec=' + act.items[0].sets[0].restSec);

const snapshot = JSON.stringify(act.items[0].sets[1]);
t.completeSet(0, 1);                            // 同一组 300ms 内再点：应被忽略
check('300ms 内重复点击同一组被忽略', act.items[0].sets[1].done === true && JSON.stringify(act.items[0].sets[1]) === snapshot);

spin(320);
t.completeSet(0, 1);                            // 过了防抖窗口：撤销
check('过了防抖窗口再点已完成的组可撤销', act.items[0].sets[1].done === false);
spin(320);
t.completeSet(0, 1);
check('撤销后可以重新完成', act.items[0].sets[1].done === true);

t.rest.start = Date.now() - 5000; t.rest.active = true; t.rest.fired = false;
t.tick();
check('计时器按时间戳重算剩余（不靠累加）', nodes.restTime.textContent === '1:25', '显示 ' + nodes.restTime.textContent);

const today = t.DB().active.date;
t.finishWorkout();
const h = t.DB().history[today];
check('完成训练写入历史', !!h && h.sets.length === 2, h ? h.sets.map(s => s.w + 'x' + s.r).join(',') : 'none');
check('循环指针推进到拉', t.DB().days[t.DB().cursor].name === '拉', 'cursor=' + t.DB().cursor);
check('历史落盘到 localStorage', JSON.parse(env1.store.get(t.KEY)).history[today].sets.length === 2);

t.startWorkout(2);                              // 越序练腿
t.DB().active.items[0].sets[0].w = '100'; t.DB().active.items[0].sets[0].r = '5';
t.completeSet(0, 0);
t.finishWorkout();
check('越序训练后指针跟着走', t.DB().days[t.DB().cursor].name === '推', 'cursor=' + t.DB().cursor);
check('同一天第二次训练不覆盖', t.DB().history[today].sets.length === 3);

// 任务 5：训练跨过 0 点
t.startWorkout(0);
t.DB().active.date = '2026-10-08';               // 假装 23:50 开始，结束已经是第二天
t.DB().active.items[0].sets[0].w = '80'; t.DB().active.items[0].sets[0].r = '5';
spin(320);
t.completeSet(0, 0);
t.finishWorkout();
check('跨 0 点的训练记在开始那天', !!t.DB().history['2026-10-08'] && t.DB().history['2026-10-08'].sets[0].w === 80);
check('跨天不写入第二天的记录', t.DB().history[t.dayKey()].sets.length === 3, t.DB().history[t.dayKey()].sets.length + ' 组');

// 问题 1：+15s（按钮在 header 里，必须能通过冒泡点到）
t.rest.active = true; t.rest.start = Date.now(); t.rest.total = 90; t.rest.fired = false;
t.tick();
check('间歇开始显示 1:30', nodes.restTime.textContent === '1:30', nodes.restTime.textContent);

env1.fire(env1.restPlus, 'click');
check('点 +15s 立刻变成 1:45（不等下一帧）', nodes.restTime.textContent === '1:45', nodes.restTime.textContent);
env1.fire(env1.restPlus, 'click');
check('连点两次累计 +30 秒', nodes.restTime.textContent === '2:00', nodes.restTime.textContent);

t.rest.start = Date.now() - 1000;                 // 又过了 1 秒，按时间戳重算
t.tick();
check('+15s 落在计时基准上，重算后依然有效', nodes.restTime.textContent === '1:59', nodes.restTime.textContent);

t.rest.total = 5; t.rest.start = Date.now() - 10000;   // 间歇早就结束了
t.tick();
const endedTotal = t.rest.total;
env1.fire(env1.restPlus, 'click');
check('已结束的间歇不会被 +15s 复活', t.rest.total === endedTotal && nodes.restTime.textContent === '0:00',
  'total=' + t.rest.total + ' 显示 ' + nodes.restTime.textContent);

t.rest.active = false; t.tick();
const idleTotal = t.rest.total;
env1.fire(env1.restPlus, 'click');
check('没有间歇在计时时 +15s 被忽略且给出提示', t.rest.active === false && t.rest.total === idleTotal && /间歇/.test(nodes.toast.textContent),
  'toast=' + nodes.toast.textContent);

// +15s 与实际休息回写的关系：回写的是真实经过时间，不因 +15 而虚增
t.setActiveNull(); t.startWorkout(0);
t.DB().active.items[0].sets[0].w = '60'; t.DB().active.items[0].sets[0].r = '8';
spin(320);
t.completeSet(0, 0);
t.rest.start = Date.now() - 30000;                // 真实已经休息了 30 秒
env1.fire(env1.restPlus, 'click');                // 再 +15s：只影响倒计时显示
spin(320);
t.DB().active.items[0].sets[1].w = '60'; t.DB().active.items[0].sets[1].r = '8';
t.completeSet(0, 1);
const back = t.DB().active.items[0].sets[0].restSec;
check('回写的是真实休息秒数，不被 +15s 污染', back >= 30 && back <= 31, 'restSec=' + back);
t.rest.active = false; t.setActiveNull();

// 任务 1：导出 / 导入
check('导出文件名带日期', /^fitness-backup-\d{4}-\d{2}-\d{2}\.json$/.test(t.backupName()), t.backupName());

const exported = JSON.stringify(t.DB());                        // 等价于 doExport 写出的文件内容
const empty = t.migrate(null);
const restored = t.importInto(empty, exported, 'overwrite').db;
check('导出的文件能原样还原', JSON.stringify(restored.history) === JSON.stringify(t.DB().history),
  Object.keys(restored.history).join(','));

const local = t.migrate(null);
local.history['2026-10-01'] = { name: '推', dayId: 'd0', sets: [{ ex: 'bench', w: 50, r: 8 }] };
const incoming = t.migrate(null);
incoming.history['2026-10-02'] = { name: '拉', dayId: 'd1', sets: [{ ex: 'row', w: 40, r: 10 }] };
incoming.history['2026-10-01'] = { name: '推', dayId: 'd0', sets: [{ ex: 'bench', w: 55, r: 8 }] };
const merged = t.importInto(local, JSON.stringify(incoming), 'merge').db;
check('合并保留本机已有的日期', merged.history['2026-10-01'].sets.length === 1 && merged.history['2026-10-01'].sets[0].w === 50);
check('合并追加导入的新日期', !!merged.history['2026-10-02']);
check('合并保留本机训练日不重复', merged.days.length === 3);
check('重复导入同一份备份不产生重复记录', JSON.stringify(t.importInto(t.DB(), exported, 'merge').db) === exported);

check('损坏 JSON 有明确提示', /JSON/.test(t.importInto(empty, '{oops', 'merge').error || ''), t.importInto(empty, '{oops', 'merge').error);
check('空对象被拒绝', !!t.importInto(empty, '{}', 'merge').error, t.importInto(empty, '{}', 'merge').error);
check('版本不匹配被拒绝', /版本/.test(t.importInto(empty, '{"v":9,"days":[1]}', 'merge').error || ''), t.importInto(empty, '{"v":9,"days":[1]}', 'merge').error);
check('缺字段被拒绝', /缺少/.test(t.importInto(empty, '{"v":1,"days":[1]}', 'merge').error || ''), t.importInto(empty, '{"v":1,"days":[1]}', 'merge').error);
check('非对象被拒绝', !!t.importInto(empty, '[1,2]', 'merge').error);

// 第二遍：跑页面内置的 ?selftest=1
env1.store.clear();
const env2 = makeEnv('?selftest=1');
vm.runInContext(src, env2.ctx);
const self = env2.nodes.view.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const m = self.match(/自检 (\d+)\/(\d+) 通过/);
check('页面内自检全绿', !!m && m[1] === m[2] && !self.includes('FAIL'), (m ? m[0] : 'no marker') + ' | ' + self.slice(0, 60));

// 第三遍：设置页的导入流程（读文件 → 待确认 → 落库）
(async () => {
  t.renderSetTab();
  const setHtml = nodes.view.innerHTML;
  check('设置页有导出/导入入口', setHtml.includes('导出数据') && setHtml.includes('导入数据') && setHtml.includes('importFile'));

  await t.readBackupFile({ name: 'fitness-backup-x.json', text: async () => '{"v":9}' });
  check('坏文件不进入待确认', t.pending() === null);

  await t.readBackupFile({ name: 'fitness-backup-x.json', text: async () => exported });
  check('好文件进入待确认并显示两个选项', !!t.pending() && /合并到现有数据/.test(nodes.view.innerHTML));

  const before = JSON.stringify(t.DB().history);
  t.applyImport('merge');
  check('取消/合并后清空待确认', t.pending() === null);
  check('合并后本机历史不被破坏', JSON.stringify(t.DB().history) === before);

  // 任务 3：Wake Lock + 提示音解锁
  const flush = () => new Promise(r => setTimeout(r, 0));
  const nav = env1.sandbox.navigator;

  t.setActiveNull(); t.renderTrainTab();
  t.startWorkout(0); await flush();
  check('没有 Wake Lock API 时训练照常开始', !!t.DB().active);
  check('训练页显示可关闭的提示音提示', /启用提示音/.test(nodes.view.innerHTML));

  env1.fire(nodes.view, 'pointerdown');           // 走真实的 pointerdown 冒泡路径
  check('首次交互后记录解锁状态', t.isPrimed() === true);
  t.renderTrainTab();
  check('解锁后提示自动消失', !/启用提示音/.test(nodes.view.innerHTML));

  // 问题 2：设置页动作默认可见
  t.renderSetTab();
  const set2 = nodes.view.innerHTML;
  const itemCount = t.DB().days.reduce((a, d) => a + d.items.length, 0);
  check('设置页默认就渲染出动作名（不靠点开）', /data-act="pick"[^>]*>卧推/.test(set2), (set2.match(/data-act="pick"[^>]*>[^<]*/) || [''])[0]);
  check('每个动作都有一个可点的名称按钮', (set2.match(/data-act="pick"/g) || []).length === itemCount, itemCount + ' 个动作');
  check('动作卡片里没有藏起来的内容', !/hidden/.test(set2));
  check('关键字段默认带文字标签', ['组数', '次数', '休息秒'].every(x => set2.includes('<span>' + x + '</span>')));
  check('没有横向滚动', !/overflow-x|nowrap/.test(css));

  // 问题 3：自绘动作选择弹层
  check('选择项字号缩小到 14px', /font-size:14px/.test(rule('.opt')), rule('.opt').slice(0, 40));
  check('选择项行高 ≥ 44px', /min-height:44px/.test(rule('.opt')));
  const vh = parseFloat((rule('.sheetbox').match(/max-height:(\d+)vh/) || [])[1]);
  const rows = vh * 780 / 100 / 44;               // 按 780px 高的手机竖屏估算
  check('一屏至少能看到 6 个动作', rows >= 6, '约 ' + rows.toFixed(1) + ' 个');

  t.openPicker(0, 0);
  const sheetHtml = nodes.view.innerHTML;
  const optCount = (sheetHtml.match(/data-act="pick-set"/g) || []).length;
  check('弹层列出全部动作', /class="sheet"/.test(sheetHtml) && optCount === Object.keys(t.DB().exercises).length, optCount + ' 项');
  check('当前动作被标出来', /class="opt on"[^>]*>卧推/.test(sheetHtml));
  t.setExercise(0, 0, 'squat');
  check('选中后写入训练日并关闭弹层', t.DB().days[0].items[0].ex === 'squat' && t.pickState() === null && !/class="sheet"/.test(nodes.view.innerHTML));
  t.setExercise(0, 0, 'bench');                   // 还原，别影响后面的断言
  t.openPicker(0, 0);
  const snapshotBefore = env1.store.get(t.KEY);
  t.DB().days[0].items = [];                      // 弹层开着时它指向的动作被删掉
  let threw = null;
  try { t.renderSetTab(); } catch (e) { threw = e.message; }
  check('弹层指向的动作被删掉后不再渲染弹层（且不报错）', !threw && !/class="sheet"/.test(nodes.view.innerHTML), threw || (nodes.view.innerHTML.match(/class="sheet"/) ? '仍渲染了弹层' : ''));
  t.setDB(t.migrate(JSON.parse(snapshotBefore)));
  t.renderSetTab();

  let reqs = 0, rels = 0;
  nav.wakeLock = { request: async () => { reqs++; return { release() { rels++; } }; } };
  t.setActiveNull(); t.renderTrainTab();
  t.startWorkout(0); await flush();
  check('训练中申请屏幕常亮', reqs === 1, 'reqs=' + reqs);
  t.startWorkout(0); await flush();
  check('重复申请被忽略', reqs === 1, 'reqs=' + reqs);
  t.setActiveNull(); t.renderTrainTab(); await flush();
  check('训练结束后释放常亮', rels === 1, 'rels=' + rels);

  console.log(results.join('\n'));
  console.log(results.some(r => r.startsWith('FAIL')) ? '\n有失败项' : '\n全部通过');
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
