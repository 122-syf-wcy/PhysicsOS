/** Runtime art direction follows the published experiment standard, not a fixed renderer. */
export const QUESTION_CODE_VISUAL_BRIEF = String.raw`
独立实验视觉与素材制作：以下补充执行方法，风格以最新已发布实验正文为准。
Warm Lab：暖白、柔和日光、自然木材/浅灰石材、真实金属与玻璃器材、灰绿色操作控件。根据题目选真实空间：自由上抛是宽敞实验教学中庭/运动实验场，透镜是木质光学台，电学是整洁电学装置。不要一律深蓝渐变背景加小球，不要旧坐标纸。装置与物理现象占主视野。
先调用physics_generate_experiment_asset，优先生成一张1536×1024高质量本题环境。用具体英文描述摄影机、空间纵深、柔和光影、材质和运动留白；让图片中心约60%为本题装置保留低纹理清晰空间，左右边缘有克制的实验室细节；只有需要地面接触的力学题才对齐背景地板。无文字、刻度、公式、箭头、轨迹、运动球体，动态内容由代码画。不要随意添加会改变题意的发射器、传感器或器械。必要时第二张material用于物体表面，每题总计最多2次，不需要凑满。
把返回的path作为文档相对路径给new Image().src，把cssPath用于CSS背景。它们是私有包内资源，无需fetch/import。图片必须真的加载并用于场景：禁止只返回路径不画图或用CSS盖住素材。可以把静态环境设为底层图片，Canvas透明覆盖真实位置/轨迹；不得重新用纯色画布遮住整张背景。
图片加载放在模块缓存Promise中，设置src之前必须设image.crossOrigin="anonymous"（沙箱图片资源已提供CORS），export async function renderFrame(snapshot)等待image.decode()再画并返回，不注册另一套物理时钟。例：const environment=new Image(); environment.crossOrigin='anonymous'; environment.src='工具返回的path'; const loaded=environment.decode(); renderFrame内await loaded; ctx.drawImage(environment,0,0,w,h)。实际代码须用真实返回路径。器材用高质量原生材质/可用图片，有高光、接触阴影和空间关系；关键装置在手机上仍需清楚辨认。
构图适配当前题目的装置或动态过程：完整装置/轨迹固定边界、x/y等比映射、稳定基准与坐标比例。环境只负责质感，真实物体位置/轨迹来自snapshot.view。不要使用随时间变化的向量端点做缩放边界。手机219×360和桌面都要让装置或现象占画面主要区域，背景裁切保留器材与关键几何。
图内只保留必要标注，不重复外层标题/参数/完整读数卡。若存在起落点，先合并距离8px以内关键点，起点/落点同点只标一次；其他题型保留各自必要的器材/方向标注。标签12px以上，边界12px留白，避免压住主体。数值仅用已有引擎读数，接近零可显示0不改变事实。竖直上抛标题不写斜抛。
输出必须精简到约50–80行renderer、8行以内CSS，每次工具输出只写15–30行，一个短函数，不超过2400字符。高质量环境已由生图提供，代码只负责图片加载/裁切、固定投影、真实装置与本题几何、少量标签；不要重写外层控件、长说明或场景美术。分3–5次physics_write_experiment_code交付：入口与加载→投影→装置与几何→标注/CSS。最后structured_output只含title/summary，不再复制代码，不输出前言。保留真实装置质感、景深和清楚的教学焦点。
`
