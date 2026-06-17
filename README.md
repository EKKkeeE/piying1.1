# 手势皮影戏 · 孙悟空

基于摄像头左手追踪的皮影戏互动网页。举起左手，以提线木偶方式控制孙悟空在皮影舞台上表演。

## 运行方式（Windows 推荐）

**方式一（最简单）**：双击项目根目录的 **`start.bat`**。

**方式二**：在项目根目录打开终端，执行：

```bash
node tools/serve.js
```

浏览器打开 **http://localhost:5173**。**不要使用 `file://` 直接打开**。

> 若 `npx serve .` 报错「禁止运行脚本」，这是 PowerShell 执行策略限制，请改用上面的 `start.bat` 或 `node tools/serve.js`，不要依赖 `npx`。

**方式三（已安装 Python）**：

```bash
python -m http.server 5173
```

然后访问 http://localhost:5173 。

## 摄像头「Device in use / 被占用」

1. 关闭占用摄像头的程序：视频会议、其他浏览器标签、**Cursor 内置 Simple Browser 预览** 等。
2. 在 **Chrome 或 Edge** 地址栏打开 `http://localhost:5173`（不要用 IDE 内嵌预览）。
3. 点击「重试」；仍失败则重启浏览器后再试。

## 操作说明

1. 点击「举起左手，开始演出」并授权摄像头。
2. 将**左手**举到画面可见区域；五指结点会显示在皮影舞台上。
3. **提线木偶**：五指吊住各孔控头与四肢（中指→头 · 食指→右手腕 · 无名指→左手腕 · 小指→左脚腕 · 拇指→右脚腕）。人物在舞台上的位置由**中指提线**自然下垂的头部孔位决定（非掌心）。

## 调试模式

```
http://localhost:5173/?debug
```

可在摄像头预览上显示手部骨架连线。

## 性能与手感

- **60fps 摄像头 + 手部检测**：请求 60fps 视频流，MediaPipe 同步 60 次/秒推理（320×240 检测画布）。GPU 优先，失败回退 CPU；可加 `?cpu` 强制 CPU。
- **显示插值**：指尖、根节点与关节仍用帧率无关指数平滑，过渡更顺。
- **低分辨率检测**：320×240 画布 + 布局缓存，减轻主线程压力。

## 资源说明

| 路径 | 说明 |
|------|------|
| `assets/wukong/*.png` | 切分并抠图后的孙悟空部件 |
| `assets/wukong/rig.json` | 孙悟空骨骼层级与枢轴配置 |
| `assets/bg/piyingxi_bg.png` | 皮影舞台背景 |
| `tools/process_assets.py` | 从合图重新生成部件与 rig |

重新处理合图：

```bash
python tools/process_assets.py --character wukong
```

## 技术栈

- HTML / CSS / JavaScript（无构建）
- MediaPipe Hand Landmarker（CDN）
- DOM + CSS Transform 骨骼动画
