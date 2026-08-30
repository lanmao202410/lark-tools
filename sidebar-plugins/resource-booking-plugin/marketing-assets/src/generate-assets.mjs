import { chromium } from 'playwright';
import { mkdir, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'output');
const videoTempDir = path.join(outDir, 'video-temp');

await mkdir(outDir, { recursive: true });
await rm(videoTempDir, { recursive: true, force: true });
await mkdir(videoTempDir, { recursive: true });

const baseCss = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Inter, "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
    background: #f5f7fb;
    color: #172033;
  }
  .canvas {
    width: 1280px;
    height: 720px;
    overflow: hidden;
    position: relative;
    background:
      linear-gradient(120deg, rgba(26, 95, 255, 0.08), transparent 36%),
      linear-gradient(135deg, #f7fbff 0%, #eef4fb 48%, #f8fafc 100%);
    padding: 46px 58px;
  }
  .kicker { color: #2f6df6; font-size: 22px; font-weight: 800; margin-bottom: 10px; }
  h1 { margin: 0; font-size: 54px; line-height: 1.08; letter-spacing: 0; color: #0f172a; }
  .subtitle { margin-top: 14px; font-size: 24px; line-height: 1.5; color: #475569; max-width: 760px; }
  .panel {
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid #d9e3f3;
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.10);
    border-radius: 8px;
  }
  .mini-window { border-radius: 8px; overflow: hidden; background: #fff; border: 1px solid #d8e2f0; }
  .bar { height: 42px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px; padding: 0 14px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #cbd5e1; }
  .dot:nth-child(1) { background: #ef4444; }
  .dot:nth-child(2) { background: #f59e0b; }
  .dot:nth-child(3) { background: #22c55e; }
  .sheet { display: grid; grid-template-columns: 1.2fr 1fr 1fr 1fr; font-size: 18px; }
  .cell { min-height: 46px; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 12px 14px; background: #fff; }
  .head { background: #eaf2ff; font-weight: 800; color: #1e3a8a; }
  .muted { color: #64748b; }
  .danger { color: #dc2626; font-weight: 800; }
  .ok { color: #047857; font-weight: 800; }
  .plugin {
    width: 360px;
    background: #ffffff;
    border: 1px solid #d9e3f3;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.16);
    border-radius: 8px;
    overflow: hidden;
  }
  .plugin-header { padding: 18px 20px; border-bottom: 1px solid #e2e8f0; }
  .plugin-title { margin: 0; font-size: 24px; font-weight: 900; color: #0f172a; }
  .plugin-copy { margin: 8px 0 0; font-size: 14px; line-height: 1.55; color: #64748b; }
  .tabs { display: flex; gap: 8px; padding: 14px 18px 0; }
  .tab { padding: 8px 14px; border-radius: 8px; background: #edf4ff; color: #1d4ed8; font-size: 14px; font-weight: 800; }
  .section { margin: 14px 18px; padding: 14px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fbfdff; }
  .label { font-size: 13px; color: #475569; font-weight: 800; margin-bottom: 7px; display: block; }
  .input { height: 38px; border: 1px solid #d4dcec; border-radius: 7px; background: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; font-size: 15px; color: #172033; }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .metric { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; text-align: center; }
  .metric strong { display: block; color: #0f172a; font-size: 22px; }
  .metric span { color: #64748b; font-size: 12px; }
  .slots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .slot { padding: 10px 8px; text-align: center; border: 1px solid #dbe6f7; border-radius: 8px; font-weight: 800; font-size: 13px; background: #fff; color: #1e293b; }
  .slot.busy { background: #eef2f7; color: #94a3b8; text-decoration: line-through; }
  .slot.selected { background: #2364e8; color: #fff; border-color: #2364e8; }
  .button { height: 42px; width: 100%; border: none; border-radius: 8px; background: #2364e8; color: #fff; font-weight: 900; font-size: 15px; }
  .callout { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 8px; background: #ecfdf5; color: #047857; font-weight: 900; border: 1px solid #bbf7d0; }
  .badge { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; border-radius: 8px; background: #eff6ff; color: #1d4ed8; font-weight: 900; }
`;

function pluginMock({ selected = false, day = false } = {}) {
  return `
    <div class="plugin">
      <div class="plugin-header">
        <h2 class="plugin-title">资源预约助手</h2>
        <p class="plugin-copy">人员、台架、会议室等资源按小时或按天预约，自动写入多维表格。</p>
      </div>
      <div class="tabs"><div class="tab">预约</div><div class="tab" style="background:#fff;color:#64748b;border:1px solid #e2e8f0;">配置</div></div>
      <div class="section">
        <span class="label">选择资源</span>
        <div class="input">工程师D <span>⌄</span></div>
      </div>
      <div class="section">
        <span class="label">${day ? '按天预约' : '按小时预约'}</span>
        <div class="input">${day ? '2026-09-03 至 2026-09-05' : '2026-09-01'}</div>
      </div>
      <div class="section">
        <div class="metrics">
          <div class="metric"><strong>${day ? 18 : 11}</strong><span>可预约</span></div>
          <div class="metric"><strong>${day ? 4 : 2}</strong><span>已预约</span></div>
          <div class="metric"><strong>${selected ? 2 : 0}</strong><span>已选择</span></div>
        </div>
      </div>
      <div class="section">
        <div class="slots">
          <div class="slot busy">${day ? '9/1' : '09:00'}</div>
          <div class="slot ${selected ? 'selected' : ''}">${day ? '9/3' : '10:00'}</div>
          <div class="slot ${selected ? 'selected' : ''}">${day ? '9/4' : '10:30'}</div>
          <div class="slot">${day ? '9/5' : '11:00'}</div>
        </div>
      </div>
      <div class="section"><button class="button">预约所选时间</button></div>
    </div>
  `;
}

function imageOneHtml() {
  return `
    <!doctype html><html><head><meta charset="utf-8"><style>${baseCss}
    .before-after { position:absolute; left:58px; right:58px; bottom:46px; display:grid; grid-template-columns: 1fr 360px; gap:34px; align-items:end; }
    .left-stack { display:grid; gap:18px; }
    .arrow { position:absolute; left:712px; top:396px; width:118px; height:58px; border-radius:8px; background:#2364e8; color:#fff; display:flex; align-items:center; justify-content:center; font-size:42px; font-weight:900; box-shadow:0 16px 36px rgba(35,100,232,.25); }
    .caption { font-size:22px; font-weight:900; color:#0f172a; margin-bottom:10px; }
    .badges { display:flex; gap:10px; margin-top:16px; }
    .before-after .plugin { transform: scale(.88); transform-origin: bottom right; }
    </style></head><body>
      <main class="canvas">
        <div class="kicker">飞书多维表格插件</div>
        <h1>把“谁占了哪个时间”<br>交给插件自动处理</h1>
        <p class="subtitle">资源、时间、使用人一次写入；已预约时间自动置灰，避免重复预约和人工核对。</p>
        <div class="before-after">
          <div class="left-stack">
            <div>
              <div class="caption">原来：人工看表，容易撞车</div>
              <div class="mini-window">
                <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><strong style="margin-left:10px;color:#64748b;">预约记录表</strong></div>
                <div class="sheet">
                  <div class="cell head">资源</div><div class="cell head">开始</div><div class="cell head">结束</div><div class="cell head">状态</div>
                  <div class="cell">台架A</div><div class="cell">09:00</div><div class="cell">10:00</div><div class="cell ok">已预约</div>
                  <div class="cell">工程师D</div><div class="cell">10:00</div><div class="cell">11:00</div><div class="cell ok">已预约</div>
                  <div class="cell danger">工程师D</div><div class="cell danger">10:30</div><div class="cell danger">11:00</div><div class="cell danger">冲突</div>
                </div>
              </div>
              <div class="badges"><span class="badge">手动筛选</span><span class="badge">反复核对</span><span class="badge">容易重复</span></div>
            </div>
          </div>
          ${pluginMock({ selected: true })}
        </div>
        <div class="arrow">→</div>
      </main>
    </body></html>
  `;
}

function imageTwoHtml() {
  return `
    <!doctype html><html><head><meta charset="utf-8"><style>${baseCss}
    .grid { position:absolute; left:58px; right:58px; top:248px; display:grid; grid-template-columns: 250px 250px 1fr; gap:24px; align-items:start; }
    .grid .plugin { transform: scale(.66); transform-origin: top left; }
    .config { padding:22px; }
    .config h2 { margin:0 0 16px; font-size:30px; color:#0f172a; }
    .config-row { display:grid; grid-template-columns:1fr .85fr .75fr; gap:8px; align-items:center; padding:12px 0; border-bottom:1px solid #e2e8f0; font-size:18px; }
    .config-row:first-of-type { color:#1e3a8a; font-weight:900; }
    .pill { display:inline-flex; justify-content:center; padding:6px 10px; border-radius:8px; background:#ecfdf5; color:#047857; font-weight:900; }
    .pill.off { background:#f1f5f9; color:#94a3b8; }
    .tip { position:absolute; font-size:20px; font-weight:900; color:#1d4ed8; }
    .line { position:absolute; height:3px; background:#1d4ed8; border-radius:999px; }
    </style></head><body>
      <main class="canvas">
        <div class="kicker">一个插件，两类调度</div>
        <h1>按小时抢时间格，按天拖日期段</h1>
        <p class="subtitle">资源规则放在“资源配置表”：是否启用、按小时还是按天、可用时段和时间粒度都能集中维护。</p>
        <div class="grid">
          ${pluginMock({ selected: true })}
          ${pluginMock({ selected: true, day: true })}
          <section class="panel config">
            <h2>资源配置表</h2>
            <div class="config-row"><span>资源名称</span><span>调度类型</span><span>是否启用</span></div>
            <div class="config-row"><span>工程师D</span><span>小时</span><span class="pill">是</span></div>
            <div class="config-row"><span>台架A</span><span>小时</span><span class="pill off">否</span></div>
            <div class="config-row"><span>会议室1</span><span>天</span><span class="pill">是</span></div>
            <p style="font-size:20px;line-height:1.55;color:#475569;margin:20px 0 0;">停用资源不会进入下拉框；已预约时间会自动置灰，删除记录或改为已取消后自动释放。</p>
          </section>
        </div>
      </main>
    </body></html>
  `;
}

function videoHtml() {
  return `
    <!doctype html><html><head><meta charset="utf-8"><style>${baseCss}
      body { background:#eef4fb; }
      .stage { width:720px; height:960px; padding:34px; background:linear-gradient(180deg,#f7fbff,#edf4fb); }
      .stage h1 { font-size:36px; line-height:1.18; margin-bottom:10px; }
      .stage .subtitle { font-size:17px; margin-bottom:18px; }
      .demo-wrap { display:grid; grid-template-columns:360px 1fr; gap:18px; align-items:start; }
      .side-card { padding:16px; }
      .side-card h2 { margin:0 0 12px; font-size:20px; }
      .step { display:flex; gap:10px; align-items:flex-start; padding:11px 0; border-bottom:1px solid #e2e8f0; font-size:15px; color:#475569; }
      .step strong { width:26px; height:26px; border-radius:50%; background:#dbeafe; color:#1d4ed8; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
      .plugin { transform-origin: top left; }
      .toast { position:absolute; left:50px; right:50px; bottom:38px; opacity:0; transform:translateY(12px); transition:.35s; }
      .toast.show { opacity:1; transform:translateY(0); }
      .cursor { position:absolute; width:28px; height:28px; border:3px solid #111827; border-radius:50%; background:rgba(255,255,255,.5); pointer-events:none; transition:.38s ease; z-index:20; }
      #resourceSelect, #dateInput { cursor:pointer; }
      .hidden { display:none; }
    </style></head><body>
      <main class="stage">
        <h1>资源预约助手</h1>
        <p class="subtitle">选择资源和时间，插件自动写入预约记录，并把已预约时间置灰。</p>
        <div class="demo-wrap">
          <div class="plugin">
            <div class="plugin-header">
              <h2 class="plugin-title">资源预约助手</h2>
              <p class="plugin-copy">人员、台架、会议室等资源按小时或按天预约。</p>
            </div>
            <div class="tabs"><div class="tab">预约</div><div class="tab" style="background:#fff;color:#64748b;border:1px solid #e2e8f0;">配置</div></div>
            <div class="section">
              <span class="label">选择资源</span>
              <div id="resourceSelect" class="input">请选择资源 <span>⌄</span></div>
            </div>
            <div class="section">
              <span class="label">按小时预约</span>
              <div id="dateInput" class="input">2026-09-01</div>
            </div>
            <div class="section">
              <div class="metrics">
                <div class="metric"><strong id="available">12</strong><span>可预约</span></div>
                <div class="metric"><strong id="occupied">1</strong><span>已预约</span></div>
                <div class="metric"><strong id="selected">0</strong><span>已选择</span></div>
              </div>
            </div>
            <div class="section">
              <div class="slots">
                <button class="slot busy">09:00<br><small>已预约</small></button>
                <button class="slot pick" data-slot="10:00">10:00<br><small>预约</small></button>
                <button class="slot pick" data-slot="10:30">10:30<br><small>预约</small></button>
                <button class="slot pick" data-slot="11:00">11:00<br><small>预约</small></button>
                <button class="slot pick" data-slot="11:30">11:30<br><small>预约</small></button>
                <button class="slot pick" data-slot="14:00">14:00<br><small>预约</small></button>
              </div>
            </div>
            <div class="section"><button id="bookButton" class="button">预约所选时间</button></div>
          </div>
          <section class="panel side-card">
            <h2>使用流程</h2>
            <div class="step"><strong>1</strong><span>资源来自资源配置表，停用资源不会出现在下拉框。</span></div>
            <div class="step"><strong>2</strong><span>选择一个或多个连续时间格，连续时间会自动合并。</span></div>
            <div class="step"><strong>3</strong><span>点击预约后新增记录：资源、开始、结束、状态、使用人自动写入。</span></div>
          </section>
        </div>
        <div id="toast" class="toast callout">已新增预约：工程师D 10:00-11:00</div>
        <div id="cursor" class="cursor"></div>
      </main>
      <script>
        const resourceSelect = document.querySelector('#resourceSelect');
        const picks = [...document.querySelectorAll('.pick')];
        const selected = document.querySelector('#selected');
        const available = document.querySelector('#available');
        const occupied = document.querySelector('#occupied');
        const toast = document.querySelector('#toast');
        resourceSelect.addEventListener('click', () => {
          resourceSelect.firstChild.textContent = '工程师D ';
        });
        picks.forEach((button) => {
          button.addEventListener('click', () => {
            button.classList.toggle('selected');
            button.querySelector('small').textContent = button.classList.contains('selected') ? '已选择' : '预约';
            selected.textContent = String(document.querySelectorAll('.pick.selected').length);
          });
        });
        document.querySelector('#bookButton').addEventListener('click', () => {
          document.querySelectorAll('.pick.selected').forEach((button) => {
            button.classList.remove('selected');
            button.classList.add('busy');
            button.querySelector('small').textContent = '已预约';
          });
          selected.textContent = '0';
          available.textContent = '10';
          occupied.textContent = '3';
          toast.classList.add('show');
        });
      </script>
    </body></html>
  `;
}

async function screenshotHtml(browser, html, fileName) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outDir, fileName), fullPage: false });
  await page.close();
}

async function recordVideo(browser) {
  const context = await browser.newContext({
    viewport: { width: 720, height: 960 },
    recordVideo: { dir: videoTempDir, size: { width: 720, height: 960 } },
  });
  const page = await context.newPage();
  await page.setContent(videoHtml(), { waitUntil: 'networkidle' });

  async function moveClick(selector, pause = 500) {
    const box = await page.locator(selector).boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.locator('#cursor').evaluate((cursor, point) => {
      cursor.style.left = `${point.x - 14}px`;
      cursor.style.top = `${point.y - 14}px`;
    }, { x, y });
    await page.waitForTimeout(420);
    await page.mouse.click(x, y);
    await page.waitForTimeout(pause);
  }

  await page.waitForTimeout(800);
  await moveClick('#resourceSelect', 700);
  await moveClick('[data-slot="10:00"]', 450);
  await moveClick('[data-slot="10:30"]', 450);
  await moveClick('#bookButton', 1200);
  await page.waitForTimeout(1200);
  const video = page.video();
  await context.close();
  const videoPath = await video.path();
  const finalVideoPath = path.join(outDir, 'resource-booking-plugin-demo.webm');
  await rm(finalVideoPath, { force: true });
  await rename(videoPath, finalVideoPath);
}

const browser = await chromium.launch({ headless: true });
try {
  await screenshotHtml(browser, imageOneHtml(), 'resource-booking-purpose-before-after.png');
  await screenshotHtml(browser, imageTwoHtml(), 'resource-booking-purpose-modes-config.png');
  await recordVideo(browser);
} finally {
  await browser.close();
}

console.log(`Assets written to ${outDir}`);
