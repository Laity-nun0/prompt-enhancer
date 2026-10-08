export const cases = [
  { draft: '给它加个任务系统', forbidden: /创建|查询|切换|删除|编辑|截止|优先级|projectId|任务.{0,6}id\s*字段|接口|测试/, required: /任务/ },
  { draft: '把这里优化一下', forbidden: /性能|重构|毫秒|缓存|算法|分页|测试/, required: /优化/ },
  { draft: '加个搜索', forbidden: /模糊|全文|分页|排序|筛选|Elasticsearch|索引|关键词高亮|测试/, required: /搜索/ },
  { draft: '这个页面在手机上有问题', forbidden: /溢出|遮挡|横向滚动|断点|768|Tailwind|媒体查询|测试/, required: /手机|移动/ },
  { draft: '给这里加缓存', forbidden: /Redis|TTL|过期|失效|LRU|内存缓存|本地存储|localStorage|测试/, required: /缓存/ },
  { draft: '请将 src/projects.ts 中 Project 类型的 name 字段重命名为 title，其他字段不变。', forbidden: /数据库|重构|缓存|接口|测试/, required: /name.*title/s, maxLength: 110 },
  { draft: '给任务系统增加创建任务、查询任务和切换完成状态三个功能。', forbidden: /删除|截止|优先级|Redis/, required: /创建.*查询.*切换/s }
];
