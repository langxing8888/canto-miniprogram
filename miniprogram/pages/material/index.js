/**
 * 教材查看页（PDF 批注 Demo 学生端）
 * - 教材 PDF 已在服务端逐页转图；本页 image + canvas 双层渲染
 * - 每 3 秒增量拉取老师批注指令流（stroke/undo/clear），近实时同步笔迹
 * - 「批注」开关：开 = 批注版（叠加老师笔迹），关 = 原版教材
 */
const BASE = 'https://yy.fla.wang';
const edition = require('../../utils/edition');

Page({
  data: {
    id: '',
    name: '',
    pages: 0,
    page: 1,
    imgUrl: '',
    showAnno: true,
    synced: false,
  },

  onLoad(options) {
    if (!edition.guardStudentPage()) return; // 教材为学员专属
    this.strokes = []; // 全量指令流
    this.lastSeq = 0;
    this.canvasReady = false;
    const id = options.id || 'demo';
    this.setData({ id });
    this.fetchMaterial(id);
  },

  onUnload() {
    this.stopped = true; // 终止长轮询循环
  },

  fetchMaterial(id) {
    const tk = encodeURIComponent(wx.getStorageSync('userToken') || '');
    this.tk = tk;
    wx.request({
      url: `${BASE}/api/material?id=${id}&token=${tk}`,
      success: (res) => {
        if (!(res.data && res.data.ok)) {
          wx.showToast({ title: (res.data && res.data.error) || '教材不存在', icon: 'none' });
          return;
        }
        const mat = res.data.data;
        this.base = BASE + mat.base;
        this.setData({ name: mat.name, pages: mat.pages, imgUrl: this.base + 'page-1.jpg' });
        wx.setNavigationBarTitle({ title: mat.name });
        this.initCanvas(() => {
          this.pullOnce(() => this.pollLoop()); // 先全量，再进入长轮询
        });
      },
      fail: () => wx.showToast({ title: '网络异常', icon: 'none' }),
    });
  },

  /* Canvas 2D 初始化（尺寸随图片实际渲染大小设定） */
  initCanvas(cb) {
    wx.createSelectorQuery()
      .in(this)
      .select('#ink')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return;
        this.cv = res[0].node;
        this.ctx = this.cv.getContext('2d');
        this.canvasReady = true;
        cb && cb();
      });
  },

  /* 图片加载完成后，把 canvas 对齐到图片实际显示尺寸 */
  onImgLoad(e) {
    const query = wx.createSelectorQuery().in(this);
    query.select('#pageImg').boundingClientRect();
    query.exec((res) => {
      if (!res || !res[0] || !this.cv) return;
      const { width, height } = res[0];
      const dpr = wx.getSystemInfoSync().pixelRatio || 2;
      this.cv.width = width * dpr;
      this.cv.height = height * dpr;
      this.cssW = width;
      this.cssH = height;
      this.setData({ cvW: width, cvH: height });
      this.redraw();
    });
  },

  /* 首次全量拉取 */
  pullOnce(cb) {
    wx.request({
      url: `${BASE}/api/material/strokes?id=${this.data.id}&since=0&token=${this.tk}`,
      success: (res) => {
        if (res.data && res.data.ok) {
          this.strokes = res.data.data.items;
          this.lastSeq = res.data.data.seq;
          this.redraw();
          this.setData({ synced: true });
        }
        cb && cb();
      },
      fail: () => cb && cb(),
    });
  },

  /* 长轮询循环：服务器有新笔画立即返回（延迟≈网络往返），25s 无动静空转重连 */
  pollLoop() {
    if (this.stopped) return;
    const lr = this.liveRev || 0;
    wx.request({
      url: `${BASE}/api/material/strokes?id=${this.data.id}&since=${this.lastSeq}&wait=1&liverev=${lr}&token=${this.tk}`,
      timeout: 30000,
      success: (res) => {
        if (res.data && res.data.ok) {
          const { seq, items, live } = res.data.data;
          let needDraw = false;
          if (items && items.length) {
            this.strokes = this.strokes.concat(items);
            this.lastSeq = seq;
            needDraw = true;
          } else if (seq > this.lastSeq) {
            this.lastSeq = seq;
          }
          // 实时进行中笔画：老师还没松手，逐段预览（rev 变化即重绘）
          const newRev = live ? live.rev : 0;
          if (newRev !== (this.liveRev || 0)) {
            this.liveRev = newRev;
            this.live = (live && live.pts && live.pts.length) ? live : null;
            needDraw = true;
          } else if (!live && this.live) {
            this.live = null; needDraw = true;
          }
          if (needDraw) this.redraw();
        }
      },
      complete: () => {
        if (!this.stopped) setTimeout(() => this.pollLoop(), 60);
      },
    });
  },

  /* 指令流重放：clear 截断 -> undo 剔除 -> 逐笔绘制 */
  redraw() {
    if (!this.ctx || !this.cv || !this.cv.width) return;
    const ctx = this.ctx;
    const W = this.cv.width;
    const H = this.cv.height;
    ctx.clearRect(0, 0, W, H);
    if (!this.data.showAnno) return;

    const page = this.data.page;
    const undone = {};
    this.strokes.forEach((it) => {
      if (it.type === 'undo') undone[it.target] = true;
    });
    // clearAll：老师撤回该频道全部批注，取其后的指令为准（之前的整体作废）
    let startIdx = 0;
    this.strokes.forEach((it, i) => { if (it.type === 'clearAll') startIdx = i + 1; });
    let list = [];
    this.strokes.slice(startIdx).forEach((it) => {
      if (it.page !== page) return;
      if (it.type === 'clear') list = [];
      if ((it.type === 'stroke' || it.type === 'text') && !undone[it.seq]) list.push(it);
    });

    list.forEach((it) => {
      // 文字批注（老师用粤拼/简拼打的字）
      if (it.type === 'text') {
        const t = it.t;
        if (!t || !t.text) return;
        ctx.save();
        ctx.fillStyle = t.c || '#e5342e';
        const fs = (t.size || 0.032) * W;
        ctx.font = '700 ' + fs + 'px sans-serif';
        ctx.textBaseline = 'top';
        String(t.text).split('\n').forEach((line, i) => ctx.fillText(line, t.x * W, t.y * H + i * fs * 1.3));
        ctx.restore();
        return;
      }
      const s = it.s;
      if (!s || !s.pts || s.pts.length < 2) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.c || '#e5342e';
      ctx.lineWidth = (s.w || 0.004) * W;
      ctx.beginPath();
      const p = s.pts;
      if (p.length < 3) {
        p.forEach((pt, i) => { const x = pt[0] * W, y = pt[1] * H; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      } else {
        // 二次贝塞尔平滑，与老师批注端笔迹一致圆润
        ctx.moveTo(p[0][0] * W, p[0][1] * H);
        for (let k = 1; k < p.length - 1; k++) {
          const mx = (p[k][0] + p[k + 1][0]) / 2 * W;
          const my = (p[k][1] + p[k + 1][1]) / 2 * H;
          ctx.quadraticCurveTo(p[k][0] * W, p[k][1] * H, mx, my);
        }
        const last = p[p.length - 1];
        ctx.quadraticCurveTo(p[p.length - 2][0] * W, p[p.length - 2][1] * H, last[0] * W, last[1] * H);
      }
      ctx.stroke();
      ctx.restore();
    });

    // 实时进行中笔画（老师还没松手的这一笔），画在最上层，逐段预览
    const lv = this.live;
    if (lv && lv.page === page && lv.pts && lv.pts.length >= 2) {
      const q = lv.pts;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = lv.mode === 'erase' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = lv.c || '#e5342e';
      ctx.lineWidth = (lv.w || 0.004) * W;
      ctx.beginPath();
      if (q.length < 3) {
        q.forEach((pt, i) => { const x = pt[0] * W, y = pt[1] * H; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      } else {
        ctx.moveTo(q[0][0] * W, q[0][1] * H);
        for (let k = 1; k < q.length - 1; k++) {
          ctx.quadraticCurveTo(q[k][0] * W, q[k][1] * H, (q[k][0] + q[k + 1][0]) / 2 * W, (q[k][1] + q[k + 1][1]) / 2 * H);
        }
        const lp = q[q.length - 1];
        ctx.quadraticCurveTo(q[q.length - 2][0] * W, q[q.length - 2][1] * H, lp[0] * W, lp[1] * H);
      }
      ctx.stroke();
      ctx.restore();
    }
  },

  onPrev() {
    if (this.data.page <= 1) return;
    this.switchPage(this.data.page - 1);
  },

  onNext() {
    if (this.data.page >= this.data.pages) return;
    this.switchPage(this.data.page + 1);
  },

  switchPage(n) {
    this.setData({ page: n, imgUrl: this.base + 'page-' + n + '.jpg' });
    // 图片 onLoad 后会 redraw
  },

  onToggleAnno(e) {
    this.setData({ showAnno: e.detail.value }, () => this.redraw());
  },

  /* 保存本页（底图 + 批注合成）到相册 */
  onSavePage() {
    wx.showLoading({ title: '生成中…' });
    const dpr = wx.getSystemInfoSync().pixelRatio || 2;
    const off = wx.createOffscreenCanvas({ type: '2d', width: this.cssW * dpr, height: this.cssH * dpr });
    const octx = off.getContext('2d');
    const img = off.createImage();
    img.onload = () => {
      const W = off.width, H = off.height;
      octx.drawImage(img, 0, 0, W, H);
      // 重放当前页批注（与 redraw 同逻辑）
      if (this.data.showAnno) {
        const page = this.data.page;
        const undone = {};
        this.strokes.forEach((it) => { if (it.type === 'undo') undone[it.target] = true; });
        let startIdx = 0;
        this.strokes.forEach((it, i) => { if (it.type === 'clearAll') startIdx = i + 1; });
        let list = [];
        this.strokes.slice(startIdx).forEach((it) => {
          if (it.page !== page) return;
          if (it.type === 'clear') list = [];
          if ((it.type === 'stroke' || it.type === 'text') && !undone[it.seq]) list.push(it);
        });
        list.forEach((it) => {
          if (it.type === 'text') {
            const t = it.t;
            if (!t || !t.text) return;
            octx.save();
            octx.fillStyle = t.c || '#e5342e';
            const fs = (t.size || 0.032) * W;
            octx.font = '700 ' + fs + 'px sans-serif';
            octx.textBaseline = 'top';
            String(t.text).split('\n').forEach((line, i) => octx.fillText(line, t.x * W, t.y * H + i * fs * 1.3));
            octx.restore();
            return;
          }
          const s = it.s;
          if (!s || !s.pts || s.pts.length < 2) return;
          octx.save();
          octx.lineCap = 'round'; octx.lineJoin = 'round';
          octx.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : 'source-over';
          octx.strokeStyle = s.c || '#e5342e';
          octx.lineWidth = (s.w || 0.004) * W;
          octx.beginPath();
          const q = s.pts;
          if (q.length < 3) {
            q.forEach((pt, i) => { const x = pt[0] * W, y = pt[1] * H; i === 0 ? octx.moveTo(x, y) : octx.lineTo(x, y); });
          } else {
            octx.moveTo(q[0][0] * W, q[0][1] * H);
            for (let k = 1; k < q.length - 1; k++) {
              octx.quadraticCurveTo(q[k][0] * W, q[k][1] * H, (q[k][0] + q[k + 1][0]) / 2 * W, (q[k][1] + q[k + 1][1]) / 2 * H);
            }
            const lp = q[q.length - 1];
            octx.quadraticCurveTo(q[q.length - 2][0] * W, q[q.length - 2][1] * H, lp[0] * W, lp[1] * H);
          }
          octx.stroke();
          octx.restore();
        });
      }
      wx.canvasToTempFilePath({
        canvas: off,
        success: (r) => {
          wx.saveImageToPhotosAlbum({
            filePath: r.tempFilePath,
            success: () => { wx.hideLoading(); wx.showToast({ title: '已保存到相册', icon: 'success' }); },
            fail: (err) => {
              wx.hideLoading();
              if (String(err.errMsg).includes('auth')) {
                wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存到相册', confirmText: '去设置', success: (m) => { if (m.confirm) wx.openSetting(); } });
              } else {
                wx.showToast({ title: '保存失败', icon: 'none' });
              }
            },
          });
        },
        fail: () => { wx.hideLoading(); wx.showToast({ title: '生成失败', icon: 'none' }); },
      });
    };
    img.onerror = () => { wx.hideLoading(); wx.showToast({ title: '图片加载失败', icon: 'none' }); };
    img.src = this.base + 'page-' + this.data.page + '.jpg';
  },
});
