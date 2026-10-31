export class VirtualList {
  constructor(scroller, canvas, opts) {
    this.scroller = scroller;
    this.canvas = canvas;
    this.opts = opts;
    this.rowHeight = opts.rowHeight;
    this.overscan = opts.overscan ?? 8;
    this.items = [];
    this.active = new Map();
    this.free = [];
    this.viewport = scroller.clientHeight;
    this.height = -1;
    this.frame = 0;
    this.onScroll = () => {
      this.render();
      this.opts.onScroll?.();
    };
    scroller.addEventListener("scroll", this.onScroll, { passive: true });
    this.resize = new ResizeObserver(() => {
      const next = this.scroller.clientHeight;
      if (next === this.viewport) return;
      this.viewport = next;
      this.render();
    });
    this.resize.observe(scroller);
  }

  setItems(items) {
    this.items = items;
    this.render();
  }

  invalidate() {
    for (const el of this.active.values()) el._sig = null;
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render() {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    const { items, rowHeight, opts } = this;
    const count = items.length;
    const height = count * rowHeight;
    if (height !== this.height) {
      this.height = height;
      this.canvas.style.height = `${height}px`;
    }
    const top = this.scroller.scrollTop;
    const first = Math.max(0, Math.floor(top / rowHeight) - this.overscan);
    const last = Math.min(count - 1, Math.ceil((top + this.viewport) / rowHeight) + this.overscan);
    const next = new Map();
    for (let i = first; i <= last; i += 1) {
      const key = opts.key(items[i]);
      const el = this.active.get(key);
      if (el) {
        next.set(key, el);
        this.active.delete(key);
      }
    }
    for (const el of this.active.values()) {
      el.hidden = true;
      el._key = null;
      this.free.push(el);
    }
    for (let i = first; i <= last; i += 1) {
      const item = items[i];
      const key = opts.key(item);
      let el = next.get(key);
      if (!el) {
        el = this.free.pop() ?? this.adopt(opts.create());
        el._sig = null;
        el._key = key;
        next.set(key, el);
      }
      if (el.hidden) el.hidden = false;
      if (el._index !== i) {
        el._index = i;
        el.style.transform = `translateY(${i * rowHeight}px)`;
      }
      const sig = opts.signature(item, i);
      if (el._sig !== sig || el._item !== item) {
        el._sig = sig;
        el._item = item;
        opts.update(el, item, i);
      }
    }
    this.active = next;
  }

  adopt(el) {
    el._index = -1;
    this.canvas.appendChild(el);
    return el;
  }

  elementFor(key) {
    return this.active.get(key) ?? null;
  }

  nearBottom(threshold = 200) {
    return this.scroller.scrollTop + this.viewport >= this.height - threshold;
  }

  scrollToIndex(index) {
    if (index < 0 || index >= this.items.length) return;
    const top = index * this.rowHeight;
    const bottom = top + this.rowHeight;
    const viewTop = this.scroller.scrollTop;
    if (top < viewTop) this.scroller.scrollTop = top;
    else if (bottom > viewTop + this.viewport) this.scroller.scrollTop = bottom - this.viewport;
    else return;
    this.render();
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.scroller.removeEventListener("scroll", this.onScroll);
    this.resize.disconnect();
  }
}
