// A fixed-row-height virtual list. Only the rows in (or near) the viewport
// exist in the DOM; each is an absolutely positioned element moved with a
// transform. Elements are keyed by item key, so a row that stays on screen
// keeps its node (a click in flight is never orphaned by a re-render), and a
// row's contents are rebuilt only when its signature changes.

export class VirtualList {
  /**
   * @param {HTMLElement} scroller  the scrolling element
   * @param {HTMLElement} canvas    a child sized to the full content height
   * @param {object} opts
   * @param {number} opts.rowHeight
   * @param {(item: any) => string} opts.key
   * @param {(item: any, index: number) => string} opts.signature
   * @param {() => HTMLElement} opts.create
   * @param {(el: HTMLElement, item: any, index: number) => void} opts.update
   * @param {(el: HTMLElement) => void} [opts.release]  called when a row leaves the screen
   * @param {string} [opts.idPrefix]
   */
  constructor(scroller, canvas, opts) {
    this.scroller = scroller;
    this.canvas = canvas;
    this.opts = opts;
    this.rowHeight = opts.rowHeight;
    this.overscan = opts.overscan ?? 6;
    this.items = [];
    this.active = new Map();
    this.free = [];
    this.viewport = scroller.clientHeight;
    this.height = -1;
    this.frame = 0;
    this.onScroll = () => this.render();
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

  /** Forces every visible row to re-run `update` on the next render. */
  invalidate() {
    for (const el of this.active.values()) el._sig = null;
  }

  /** Coalesces renders requested from event handlers into one per frame. */
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
      opts.release?.(el);
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
        if (opts.idPrefix) el.id = `${opts.idPrefix}${i}`;
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

  /** The rendered element for `key`, if it is on screen. */
  elementFor(key) {
    return this.active.get(key) ?? null;
  }

  indexAtClientY(clientY) {
    const rect = this.scroller.getBoundingClientRect();
    const index = Math.floor((clientY - rect.top + this.scroller.scrollTop) / this.rowHeight);
    return index >= 0 && index < this.items.length ? index : -1;
  }

  /** Scrolls so row `index` is visible; `center` re-centers when it is far. */
  scrollToIndex(index, { center = false } = {}) {
    if (index < 0 || index >= this.items.length) return;
    const top = index * this.rowHeight;
    const bottom = top + this.rowHeight;
    const viewTop = this.scroller.scrollTop;
    const viewBottom = viewTop + this.viewport;
    let target = null;
    if (center && (top < viewTop || bottom > viewBottom)) target = top - (this.viewport - this.rowHeight) / 2;
    else if (top < viewTop) target = top;
    else if (bottom > viewBottom) target = bottom - this.viewport;
    if (target === null) return;
    this.scroller.scrollTop = Math.max(0, target);
    this.render();
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.scroller.removeEventListener("scroll", this.onScroll);
    this.resize.disconnect();
  }
}
