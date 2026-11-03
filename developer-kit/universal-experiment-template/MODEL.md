# 模型与计算责任

本包是平台物理引擎的可替换渲染器。它不包含物理求解器，不重算平台返回的轨迹、力、光线、读数或验证结果。

source=platform-engine 的协议 3 快照包含 experimentId、revision、domain、title、view、inspector、clock、table、charts、verification、events、trajectoryTimes 和 ariaLabel。默认 PhysicsCanvas 将 view 投影到屏幕并绘制装置。图形比例计算是绘制过程，物理量始终使用平台快照。

开发预览使用下载时生成的固定平台快照，不能用于验证参数变化后的物理结果。上传后的私有预览连接实际平台运行时，只有该运行时处理参数、选择项、显示项与播放意图。每个实验的假设和模型范围以平台说明和 verification 为准。

cases.json 仅声明平台已注册的输入；作者不能通过 expected 字段覆盖平台事实。
