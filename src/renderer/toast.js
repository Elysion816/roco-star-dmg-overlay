'use strict';
/**
 * src/renderer/toast.js —— 加成提示小窗的渲染逻辑
 * ---------------------------------------------------------------------------
 * 只做两件事：把主进程推来的文本画出来、把实测宽度回报回去。
 * 窗口尺寸完全由主进程掌握（这里不碰 setBounds）。
 */
(function () {
  var toastEl = document.getElementById('toast');
  var mainEl = document.getElementById('tMain');
  var subEl = document.getElementById('tSub');

  /**
   * 内容实际宽度（含内边距与边框）。
   * 必须用 scrollWidth：窗口宽度被上一次的测量结果收窄过，此时
   * getBoundingClientRect().width 会返回"被裁后的可见宽度"，
   * 长文案（如「攻击 已到上限 +300%」）会永远撑不开。
   */
  function reportSize() {
    var w = Math.ceil(Math.max(toastEl.scrollWidth, toastEl.getBoundingClientRect().width)) + 2;
    window.toastApi.reportSize(w);
  }

  window.toastApi.onToast(function (payload) {
    payload = payload || {};
    mainEl.textContent = payload.main || '';
    subEl.textContent = payload.sub || '';
    subEl.classList.toggle('is-hidden', !payload.sub);
    toastEl.classList.toggle('is-danger', payload.tone === 'danger');
    // 重放淡入动画（连续按键时每次都重新出现一下）
    document.body.classList.remove('is-on');
    void document.body.offsetWidth;
    document.body.classList.add('is-on');
    reportSize();
    // 字体回退可能改变宽度，下一帧再量一次
    if (window.requestAnimationFrame) {
      requestAnimationFrame(reportSize);
    }
  });
})();
