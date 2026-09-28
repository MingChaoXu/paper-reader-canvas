# Paper Reader Canvas

在 GitHub Copilot App 侧栏阅读本地英文 PDF，划选单词、句子或段落后，可以点击 **翻译选中内容** 将原文发送到当前会话，或者直接对会话说“翻译我刚划选的文字”。只有主动点击翻译才会发起翻译消息；普通划词只更新可由会话读取的选区。

**安装：** 在 Copilot App 里从以下 GitHub 文件夹 URL 安装，选择 **User / 个人级**，然后重新加载扩展：

```text
https://github.com/MingChaoXu/paper-reader-canvas/tree/main/paper-reader-canvas
```

也可将仓库中的 [`paper-reader-canvas/`](paper-reader-canvas/) 文件夹复制到 `~/.copilot/extensions/`。

打开方式：告诉 Copilot“用 Paper Reader 打开 `doc/paper.pdf`”，或打开 Paper Reader 画布后输入本地 PDF 路径、选择本机 PDF。扫描版图片 PDF 暂不支持 OCR。

PDF 不会由扩展上传到外部服务；只有用户选择的文字和少量邻近上下文在发起翻译时进入 Copilot 会话。完整使用说明、隐私说明、开发和许可信息请阅读 [扩展文档](paper-reader-canvas/README.md)。
