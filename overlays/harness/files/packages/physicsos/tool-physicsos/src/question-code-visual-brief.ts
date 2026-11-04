/** Presentation guidance only: these examples contain no scene, solver, or renderer entry. */
export const QUESTION_CODE_VISUAL_BRIEF = String.raw`
独立画面视觉规范（优先于下面公开正文中的视觉建议）：
生成一座深海军蓝 #10182f 的玻璃实验台：紫色 #7966eb 环境光、青色 #64dbef 轨迹、暖金色 #ffc877 主体、浅色 #eef2ff 文字。用渐变、透明材质、边缘高光、接触阴影表现装置；不要米白纸张、棕色地面、大XY网格或整页坐标图。背景渐变不是实验，必须独立绘制真实引擎几何对应的物体、轨迹或装置。
主画面呈现物理现象；外层已有标题、条件、播放和结果。图内至多保留2–3个关键标签，不要重复整套参数面板。只画题目确实存在的装置，不添加改变物理含义的发射器、斜面或测量仪器。title取真实题目名称，风格家族名称只用于匹配数据契约。
219×360手机舞台也必须可读：主物体视觉半径至少10px，文字至少12px，标签距边缘至少12px。同点起点/落点合并；移动主体的标签避开最高点/轨迹文字。窄屏不画长箭头说明、重复刻度或侧边信息卡，宁可留白。先测文字宽度再夹紧标签位置，数据接近零时只在显示格式中写0，不改物理数据。
投影优先采用引擎提供的完整轨迹/装置边界，保留四周留白与底部平台空间；使用同一正比例缩放x/y。不要让竖直上抛沿用很宽的旧坐标范围，也不要每帧追随物体重新缩放造成主体静止。画布CSS铺满#canvas，每帧同步尺寸并用DPR提高清晰度。字体使用系统中文无衬线，避免密集说明。
下列仅为可选材质函数参考，不是完整实验；你仍须编写 export function renderFrame(snapshot)，读取真实snapshot.view几何、完成本题布局和绘制。不得原样只交付这些函数，不得增加依赖或物理计算：
function glass(ctx,x,y,w,h){
  ctx.save();ctx.beginPath();ctx.roundRect(x,y,w,h,14);
  const g=ctx.createLinearGradient(x,y,x+w,y+h);
  g.addColorStop(0,'rgba(173,188,255,0.13)');g.addColorStop(1,'rgba(65,84,135,0.07)');
  ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='rgba(188,205,255,0.22)';ctx.lineWidth=1;ctx.stroke();ctx.restore();
}
function metalSphere(ctx,x,y,r){
  ctx.save();ctx.shadowColor='rgba(255,190,100,0.4)';ctx.shadowBlur=18;
  const g=ctx.createRadialGradient(x-r*.35,y-r*.4,r*.08,x,y,r);
  g.addColorStop(0,'#fff6dc');g.addColorStop(.35,'#ffd48a');g.addColorStop(.78,'#ba782e');g.addColorStop(1,'#60371e');
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();ctx.restore();
}
代码保持紧凑：renderer约100–140行、2500–3500输出tokens；stylesheet仅补少量舞台样式。无需把规范写进输出源码，不要长注释。以一次structured_output交付完整四字段。
`
