/** Local labels for the class surfaces; the shared locale registry is wired by the controller. */
export interface ClassWorkspaceLabels {
  readonly studentTitle: string
  readonly teacherTitle: string
  readonly classPicker: string
  readonly noClasses: string
  readonly assignments: string
  readonly noAssignments: string
  readonly members: string
  readonly studentKey: string
  readonly addMember: string
  readonly removeMember: string
  readonly createClass: string
  readonly className: string
  readonly assignmentTitle: string
  readonly targetKind: string
  readonly targetId: string
  readonly dueAt: string
  readonly assignAssignment: string
  readonly paper: string
  readonly experiment: string
  readonly instructions: string
  readonly submissionContent: string
  readonly submit: string
  readonly resubmit: string
  readonly submitted: string
  readonly accepted: string
  readonly returned: string
  readonly pending: string
  readonly late: string
  readonly completion: string
  readonly submittedCount: string
  readonly reviewedCount: string
  readonly outstandingCount: string
  readonly reviewComment: string
  readonly score: string
  readonly accept: string
  readonly returnForRevision: string
}

export const DEFAULT_CLASS_WORKSPACE_LABELS: ClassWorkspaceLabels = {
  studentTitle: '我的班级',
  teacherTitle: '班级教学',
  classPicker: '选择班级',
  noClasses: '还没有班级。',
  assignments: '班级作业',
  noAssignments: '当前班级还没有作业。',
  members: '学生成员',
  studentKey: '学生 userKey',
  addMember: '添加成员',
  removeMember: '移出班级',
  createClass: '创建班级',
  className: '新班级名称',
  assignmentTitle: '作业标题',
  targetKind: '关联类型',
  targetId: '资源 ID',
  dueAt: '截止时间',
  assignAssignment: '布置作业',
  paper: '试卷',
  experiment: '实验',
  instructions: '作业说明',
  submissionContent: '作业内容',
  submit: '提交作业',
  resubmit: '重新提交',
  submitted: '已提交',
  accepted: '已通过',
  returned: '已退回',
  pending: '待批改',
  late: '逾期提交',
  completion: '完成率',
  submittedCount: '已交',
  reviewedCount: '已批改',
  outstandingCount: '未交',
  reviewComment: '批语',
  score: '分数',
  accept: '通过',
  returnForRevision: '退回修改',
}
