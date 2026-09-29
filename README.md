# Paper Reader Canvas

在侧栏阅读本地英文 PDF，划选单词、句子或段落后，可以点击 **翻译选中内容** 将原文发送到当前 AI 会话，或者直接说“翻译我刚划选的文字”。只有主动点击翻译才会发起翻译消息；普通划词只更新会话可读取的选区。

## 当前接入方式

目前提供 **GitHub Copilot App 的 Canvas 适配器**。在 App 中从以下 GitHub 文件夹 URL 安装，选择 **User / 个人级**，然后重新加载扩展：

```text
https://github.com/MingChaoXu/paper-reader-canvas/tree/main/paper-reader-canvas
```

也可将仓库中的 [`paper-reader-canvas/`](paper-reader-canvas/) 文件夹复制到 `~/.copilot/extensions/`。

打开方式：说“用 Paper Reader 打开 `doc/paper.pdf`”，或打开画布后输入本地 PDF 路径、选择本机 PDF。扫描版图片 PDF 暂不支持 OCR。

在 PDF 上滚动鼠标滚轮，可围绕鼠标位置放大或缩小；按住 **Shift** 滚轮翻页。顶部 **− / +** 按钮则以阅读区中心缩放。

阅读器的 PDF 渲染和划词逻辑可以复用到其他 AI 工具。Codex 支持通过 MCP 接入本地工具，但本仓库**尚未提供 Codex/MCP 适配器**，不能直接将此 Canvas 扩展安装到 Codex。

PDF 不会由扩展上传到外部服务；点击翻译或主动询问选区时，仅选中的文字和少量邻近上下文进入当前 AI 会话。完整使用说明、隐私说明、开发和许可信息请阅读 [扩展文档](paper-reader-canvas/README.md)。
