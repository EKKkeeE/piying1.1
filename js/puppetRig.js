import { smoothAngle } from "./utils.js";

/**
 * 层级骨骼：子部件挂在躯干上，肩/髋孔始终对齐；各件绕自身枢轴旋转。
 */
export class PuppetRig {
  /**
   * @param {HTMLElement} container
   * @param {object} rigData
   */
  constructor(container, rigData) {
    this.rigData = rigData;
    this.scale = rigData.scale ?? 0.42;
    this.flipX = rigData.flipX ?? false;
    this.parts = rigData.parts ?? {};
    this.links = rigData.links ?? [];
    this.rootAnchor = rigData.rootAnchor ?? [0, 0];
    this.rootExtra = { x: 0, y: 0, rotation: 0 };
    this.idleTime = 0;
    this.displayRotations = {};
    this.targetRotations = {};
    this.partEls = new Map();
    /** @type {Record<string, object>} */
    this._linkByChild = {};
    /** @type {Record<string, string | null>} */
    this._parent = { torso: null };
    /** @type {Record<string, string[]>} */
    this._chainCache = {};

    for (const link of this.links) {
      this._linkByChild[link.child] = link;
      this._parent[link.child] = link.parent;
    }

    for (const name of Object.keys(this.parts)) {
      this.displayRotations[name] = 0;
      this.targetRotations[name] = 0;
    }

    this.wrapper = document.createElement("div");
    this.wrapper.className = "puppet-wrapper";
    if (this.flipX) {
      this.wrapper.dataset.flipX = "true";
    }
    container.appendChild(this.wrapper);

    this.assembly = document.createElement("div");
    this.assembly.className = "puppet-assembly";
    this.wrapper.appendChild(this.assembly);

    this._createPart("torso");
    const order = rigData.drawOrder ?? Object.keys(this.parts);
    for (const name of order) {
      if (name === "torso") continue;
      this._createPart(name);
    }

    this._mountHierarchy();
    this._layoutAttachments();
  }

  /**
   * @param {string} name
   */
  _createPart(name) {
    const part = this.parts[name];
    const el = document.createElement("div");
    el.className = `puppet-part puppet-part-${name}`;
    el.dataset.part = name;

    const img = document.createElement("img");
    img.src = part.path;
    img.alt = name;
    img.draggable = false;
    img.style.width = `${part.width}px`;
    img.style.height = `${part.height}px`;

    const marker = document.createElement("span");
    marker.className = "joint-marker";
    marker.dataset.joint = part.rotateJoint ?? "hip";
    if (part.zIndex != null) {
      el.style.zIndex = String(part.zIndex);
    }
    el.appendChild(img);
    el.appendChild(marker);
    this.partEls.set(name, { el, img, marker, part });
  }

  /** 按 rig links 挂载任意多级骨骼，孔对孔对齐 */
  _mountHierarchy() {
    const order = this.rigData.drawOrder ?? Object.keys(this.parts);
    const roots = order.filter((name) => this._parent[name] == null);

    for (const name of roots) {
      const entry = this.partEls.get(name);
      if (!entry) continue;
      this.assembly.appendChild(entry.el);
      entry.el.style.position = "absolute";
      entry.el.style.overflow = "visible";
    }

    for (const link of this.links) {
      const parentEntry = this.partEls.get(link.parent);
      const childEntry = this.partEls.get(link.child);
      if (!parentEntry || !childEntry) continue;
      parentEntry.el.appendChild(childEntry.el);
      parentEntry.el.style.overflow = "visible";
      childEntry.el.style.position = "absolute";
    }
  }

  _layoutAttachments() {
    const torsoEntry = this.partEls.get("torso");
    if (torsoEntry) {
      torsoEntry.el.style.width = `${torsoEntry.part.width}px`;
      torsoEntry.el.style.height = `${torsoEntry.part.height}px`;
      torsoEntry.pos = { x: 0, y: 0 };
    }

    for (const link of this.links) {
      const childEntry = this.partEls.get(link.child);
      const parentPart = this.parts[link.parent];
      const childPart = this.parts[link.child];
      if (!childEntry || !parentPart || !childPart) continue;

      const pJoint = parentPart.joints[link.parentJoint];
      const cJoint = childPart.joints[link.childJoint];
      childEntry.pos = {
        x: pJoint[0] - cJoint[0],
        y: pJoint[1] - cJoint[1],
      };
      childEntry.el.style.width = `${childPart.width}px`;
      childEntry.el.style.height = `${childPart.height}px`;
    }
  }

  /** @param {string} partName */
  _getChain(partName) {
    if (this._chainCache[partName]) return this._chainCache[partName];
    const chain = [];
    let n = partName;
    while (n) {
      chain.unshift(n);
      n = this._parent[n] ?? null;
    }
    this._chainCache[partName] = chain;
    return chain;
  }

  /**
   * 部件局部坐标 → 装配空间（累计父级旋转，孔对孔对齐）
   * @param {string} partName
   * @param {number} lx
   * @param {number} ly
   */
  getJointAssembly(partName, lx, ly) {
    const chain = this._getChain(partName);
    let x = lx;
    let y = ly;

    for (let i = chain.length - 1; i >= 0; i--) {
      const name = chain[i];
      const part = this.parts[name];
      const rot = this.displayRotations[name] ?? 0;
      const pivotKey = part.rotateJoint ?? Object.keys(part.joints)[0];
      const [px, py] = part.joints[pivotKey];
      const rad = (rot * Math.PI) / 180;
      const rx = x - px;
      const ry = y - py;
      x = px + rx * Math.cos(rad) - ry * Math.sin(rad);
      y = py + rx * Math.sin(rad) + ry * Math.cos(rad);

      if (i > 0) {
        const parent = chain[i - 1];
        const link = this._linkByChild[name];
        const pJ = this.parts[parent].joints[link.parentJoint];
        const cJ = part.joints[link.childJoint];
        x += pJ[0] - cJ[0];
        y += pJ[1] - cJ[1];
      }
    }

    return { x, y };
  }

  /**
   * @param {string} partName
   * @param {string} jointKey
   */
  getJointAssemblyByKey(partName, jointKey) {
    const part = this.parts[partName];
    const j = part?.joints?.[jointKey];
    if (!j) return null;
    return this.getJointAssembly(partName, j[0], j[1]);
  }

  assemblyToClient(pt) {
    const wrap = this.wrapper.getBoundingClientRect();
    const [ax, ay] = this.rootAnchor;
    const cx = wrap.left + wrap.width / 2 + this.rootExtra.x;
    const cy = wrap.top + wrap.height / 2 + this.rootExtra.y;
    return {
      x: cx + (pt.x - ax) * this.scale,
      y: cy + (pt.y - ay) * this.scale,
    };
  }

  clientToAssembly(client) {
    const wrap = this.wrapper.getBoundingClientRect();
    const [ax, ay] = this.rootAnchor;
    const cx = wrap.left + wrap.width / 2 + this.rootExtra.x;
    const cy = wrap.top + wrap.height / 2 + this.rootExtra.y;
    return {
      x: ax + (client.x - cx) / this.scale,
      y: ay + (client.y - cy) / this.scale,
    };
  }

  /**
   * 从 DOM 读取关节孔屏幕坐标（与画面一致，用于提线端点）
   * @param {string} partName
   * @param {string} jointKey
   */
  getJointClientDom(partName, jointKey) {
    const entry = this.partEls.get(partName);
    const joint = entry?.part?.joints?.[jointKey];
    if (!entry || !joint) return null;

    const [jx, jy] = joint;
    entry.marker.style.left = `${jx - 3}px`;
    entry.marker.style.top = `${jy - 3}px`;
    const r = entry.marker.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  }

  /**
   * @param {string} partName
   * @param {string} jointKey
   * @param {DOMRect} stageRect
   */
  getJointStage(partName, jointKey, stageRect) {
    const client = this.getJointClientDom(partName, jointKey);
    if (!client) return null;
    return {
      x: client.x - stageRect.left,
      y: client.y - stageRect.top,
    };
  }

  /**
   * @param {string} partName
   * @param {number} localX
   * @param {number} localY
   * @param {DOMRect} stageRect
   */
  getLocalPointStage(partName, localX, localY, stageRect) {
    const client = this.getLocalPointClientDom(partName, localX, localY);
    if (!client) return null;
    return {
      x: client.x - stageRect.left,
      y: client.y - stageRect.top,
    };
  }

  /**
   * 部件贴图局部像素 → 视口 client 坐标（读 DOM，与提线端点一致）
   * @param {string} partName
   * @param {number} localX
   * @param {number} localY
   */
  getLocalPointClientDom(partName, localX, localY) {
    const entry = this.partEls.get(partName);
    if (!entry) return null;

    entry.marker.style.left = `${localX - 3}px`;
    entry.marker.style.top = `${localY - 3}px`;
    const r = entry.marker.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  }

  /**
   * @param {string} partName
   * @param {string} jointKey
   * @param {DOMRect} stageRect
   * @param {{ x: number, y: number }} [offsetAssembly] assembly-space offset from joint
   */
  getHitPoint(partName, jointKey, stageRect, offsetLocal = { x: 0, y: 0 }) {
    const part = this.parts[partName];
    const j = part?.joints?.[jointKey];
    if (!j) return null;
    const pt = this.getJointAssembly(
      partName,
      j[0] + offsetLocal.x,
      j[1] + offsetLocal.y
    );
    const client = this.assemblyToClient(pt);
    return {
      x: client.x - stageRect.left,
      y: client.y - stageRect.top,
    };
  }

  /** @param {DOMRect} stageRect */
  getRootStage(stageRect) {
    const wrap = this.wrapper.getBoundingClientRect();
    return {
      x: wrap.left + wrap.width / 2 - stageRect.left,
      y: wrap.top + wrap.height / 2 - stageRect.top,
    };
  }

  /** @param {number} durationSec */
  flashHit(durationSec = 0.2) {
    this.wrapper.classList.add("puppet-hit");
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => {
      this.wrapper.classList.remove("puppet-hit");
    }, durationSec * 1000);
  }

  getArmRotation(partName) {
    return this.displayRotations[partName] ?? 0;
  }

  getJointClient(partName, jointKey) {
    return this.getJointClientDom(partName, jointKey);
  }

  _applyPartTransform(name) {
    const entry = this.partEls.get(name);
    if (!entry) return;

    const part = entry.part;
    const jointName = part.rotateJoint ?? Object.keys(part.joints)[0];
    const [jx, jy] = part.joints[jointName];
    const rot = this.displayRotations[name] ?? 0;

    if (name !== "torso" && entry.pos) {
      entry.el.style.left = `${entry.pos.x}px`;
      entry.el.style.top = `${entry.pos.y}px`;
    } else {
      entry.el.style.left = "0px";
      entry.el.style.top = "0px";
    }

    entry.el.style.transformOrigin = `${jx}px ${jy}px`;
    entry.el.style.transform = `rotate(${rot}deg)`;
  }

  setBoneRotation(name, rotationDeg) {
    if (!this.parts[name]) return;
    const base = this.rigData.defaults?.[name]?.rotation ?? 0;
    this.targetRotations[name] = base + (rotationDeg ?? 0);
  }

  setRootTransform(x, y, rotationDeg) {
    this.rootExtra = { x, y, rotation: rotationDeg };
  }

  /**
   * 立即应用关节角与 root（供提线 root 网格搜索等，不做平滑）
   * @param {Record<string, number>} angles
   */
  applyKinematicSnapshot(angles, rootX, rootY, rotationDeg = 0) {
    this.setRootTransform(rootX, rootY, rotationDeg);
    this.syncDisplayRotations(angles);
    const [ax, ay] = this.rootAnchor;
    for (const name of Object.keys(this.parts)) {
      this._applyPartTransform(name);
    }
    this.assembly.style.transform = `translate(${-ax}px, ${-ay}px)`;
    const flip = this.flipX ? " scaleX(-1)" : "";
    this.wrapper.style.transform = `translate(calc(-50% + ${this.rootExtra.x}px), calc(-50% + ${this.rootExtra.y}px)) rotate(${this.rootExtra.rotation}deg) scale(${this.scale})${flip}`;
  }

  /**
   * 物理步进前：用当前模拟角更新 FK（孔位与枢轴一致）
   * @param {Record<string, number>} angles
   */
  syncDisplayRotations(angles) {
    for (const [name, deg] of Object.entries(angles)) {
      if (this.parts[name] != null) {
        this.displayRotations[name] = deg;
      }
    }
  }

  update(dt, opts = {}) {
    const idle = opts.idle ?? false;
    const direct = opts.direct ?? false;
    const alpha = opts.alpha ?? (idle ? 0.1 : 0.18);
    const maxDelta = idle ? 14 : 22;

    this.idleTime += dt;

    for (const name of Object.keys(this.parts)) {
      const tgt = this.targetRotations[name] ?? 0;
      if (direct) {
        this.displayRotations[name] = tgt;
      } else {
        const cur = this.displayRotations[name] ?? 0;
        this.displayRotations[name] = smoothAngle(cur, tgt, alpha, maxDelta);
      }
    }

    const [ax, ay] = this.rootAnchor;

    for (const name of Object.keys(this.parts)) {
      this._applyPartTransform(name);
    }

    this.assembly.style.transform = `translate(${-ax}px, ${-ay}px)`;
    const flip = this.flipX ? " scaleX(-1)" : "";
    this.wrapper.style.transform = `translate(calc(-50% + ${this.rootExtra.x}px), calc(-50% + ${this.rootExtra.y}px)) rotate(${this.rootExtra.rotation}deg) scale(${this.scale})${flip}`;
  }

  resetToDefault() {
    for (const name of Object.keys(this.parts)) {
      this.targetRotations[name] = this.rigData.defaults?.[name]?.rotation ?? 0;
    }
    this.rootExtra = { x: 0, y: 0, rotation: 0 };
  }
}
