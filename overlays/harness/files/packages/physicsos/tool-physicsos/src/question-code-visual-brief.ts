/** Compact visual direction; domain-specific geometry is supplied separately. */
export const QUESTION_CODE_VISUAL_BRIEF = String.raw`
独立实验视觉与素材制作：Warm Lab暖白、自然木/浅石材、金属与玻璃、灰绿控件；主题是物理现象和精细器材，不是空背景加小球。只参考物理、教学与包契约，不复制旧renderer。
只生成一张本题环境或材质；图片不含文字、公式、箭头、轨迹、动态物体或读数，不能添加题目不存在的器械。低纹理留白服务完整装置；电磁场不要强加有地板的抛体场景。中文标注由代码绘制。
图片必须加载并实际显示：path给Image.src，cssPath给CSS背景；先设crossOrigin='anonymous'，模块缓存decode Promise，在renderFrame内等待后绘图。不要让不透明Canvas覆盖背景。素材失败如实报告，不伪造路径。
主体占舞台约60%–80%，精细轮廓、高光、接触阴影和稳定空间关系；x/y等比，取完整轨迹和装置边界，缩放不随当前运动位置变化。保留题目需要的受力、场方向、光路及可见性开关。
手机219×360不保留宽侧栏；标签至少12px、边界12px留白，合并重叠点（起点/落点同点只标一次），读数不重复铺满画面。标题中文且准确，最高点仅在实际有apex时标注。
代码直接、精简：只负责图片、投影、器材、轨迹和必要标签；不重写外层控件、长解答与物理求解器。普通命名函数分段交付，每段<=2400字符，最后只提交title/summary。
`
