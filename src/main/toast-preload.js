'use strict';
/**
 * src/main/toast-preload.js —— 加成提示小窗的安全桥
 * ---------------------------------------------------------------------------
 * 只用两个能力：收文本、回报实测宽度。不做通用 IPC 转发。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toastApi', {
  /** 主进程推来一条提示：{ main, sub, tone } */
  onToast: cb => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('toast', handler);
    return () => ipcRenderer.removeListener('toast', handler);
  },
  /** 把内容实测宽度回报给主进程（主进程据此把窗口收窄到刚好包住文字） */
  reportSize: w => ipcRenderer.send('toast:size', Math.round(Number(w) || 0)),
});
