# Office 纯合成夹具

全部数据仅含“演示”化名和团队说明，与真实员工或业务材料无关。`python3 tests/fixtures/office/generate.py` 只用 Python 标准库生成固定 ZIP 时间戳的最小 OOXML，不启动 Office、不运行公式、不取外部内容。这些是解析行为夹具，不是官方评审表或生产版式认证。

| 文件                  | 行为证据                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ordered-slides.pptx` | 页面顺序是 slide7、slide2，备注分别为 notesSlide3、notesSlide8；含一份不在页面列表里的 slide99              |
| `cached-values.xlsx`  | `演示个人记录` 稀疏至 AA6；1+1 故意缓存 42，另含缺缓存、0、false、错误；隐藏团队表合并 B2:B3 但只在 B2 存值 |
| `cache-types.xlsx`    | 空/富共享字符串、空文本缓存、字面等号、日期字串、共享公式跟随项、大整数、样式空单元格                       |
| `unsupported.zip`     | 不是 Office 文档                                                                                            |
| `truncated.pptx`      | 有意截断，必须失败                                                                                          |

`parse.test.ts` 另外从这些真实字节修改页列表、关系、工作表/单元格、XML 和预算边界；无宏、活动链接下载、真实身份或模型调用。`example.invalid` 只用于验证外链不会发起 fetch。
