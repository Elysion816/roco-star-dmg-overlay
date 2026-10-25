'use strict';
/**
 * src/main/preload.js —— 安全桥
 * ---------------------------------------------------------------------------
 * 渲染层没有 Node 权限（nodeIntegration:false + contextIsolation:true），
 * 所有能力都通过这里显式暴露。只暴露必要的方法，不做通用 IPC 转发。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /** 启动时读取持久化状态 + 当前模式 */
  getState: () => ipcRenderer.invoke('state:get'),
  /** 保存业务状态（渲染层改动后节流调用） */
  saveUI: ui => ipcRenderer.invoke('state:set', ui),

  /** 窗口：小条 / 穿透 */
  setCollapsed: v => ipcRenderer.invoke('win:collapse', v),
  /** 收起/展开 小条：由主进程翻转状态，避免前后端状态不同步 */
  toggleCollapse: () => ipcRenderer.invoke('win:toggle-collapse'),
  /** 小条里临时把窗口撑开指定高度（放小菜单用）；false 时还原成小条矩形 */
  tempExpand: (on, height) => ipcRenderer.invoke('win:temp-expand', !!on, height),
  /** 展开态：把内容实际高度交给主进程（主进程决定是否采纳，用户拖过就尊重用户） */
  autoHeight: height => ipcRenderer.invoke('win:auto-height', Math.round(Number(height) || 0)),
  /** 诊断：把渲染层矩形报给主进程（仅 XY_DEBUG/XY_DIAG 时主进程会落盘） */
  debugRects: payload => ipcRenderer.send('debug:rect', payload),
  setPassthrough: v => ipcRenderer.invoke('win:passthrough', v),
  togglePassthrough: () => ipcRenderer.invoke('win:toggle-passthrough'),
  close: () => ipcRenderer.invoke('win:close'),

  /** 在线数据 */
  getOnlineData: () => ipcRenderer.invoke('data:online'),
  getDataStatus: () => ipcRenderer.invoke('data:status'),
  refreshData: () => ipcRenderer.invoke('data:refresh'),

  /** 事件订阅（返回取消订阅函数） */
  onOnlineData: cb => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('data:online', handler);
    return () => ipcRenderer.removeListener('data:online', handler);
  },
  onDataStatus: cb => {
    const handler = (_e, st) => cb(st);
    ipcRenderer.on('data:status', handler);
    return () => ipcRenderer.removeListener('data:status', handler);
  },
  /** 主进程要求收起小条菜单（窗口失焦 / 展开态切换时） */
  onMiniMenuClose: cb => {
    const handler = () => cb();
    ipcRenderer.on('mini-menu:close', handler);
    return () => ipcRenderer.removeListener('mini-menu:close', handler);
  },
  onMode: cb => {
    const handler = (_e, mode) => cb(mode);
    ipcRenderer.on('mode', handler);
    return () => ipcRenderer.removeListener('mode', handler);
  },

  info: () => ipcRenderer.invoke('app:info'),
  openUrl: url => ipcRenderer.invoke('app:open-url', url),
});
